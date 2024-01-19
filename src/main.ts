import { once } from "node:events";

import clipboardy from "clipboardy";
import * as zx from "zx";
import { decodeXML } from "entities";
import dayjs from "dayjs";
import {
  command,
  run,
  string,
  option,
  extendType,
  boolean,
  flag,
} from "cmd-ts";
import { getItunesTracks } from "@johnpaulvaughan/itunes-music-library-tracks";

import customParseFormat from "dayjs/plugin/customParseFormat.js";
import duration from "dayjs/plugin/duration.js";

dayjs.extend(customParseFormat);
dayjs.extend(duration);

const supportedFieldsToRecover = ["Album", "Artist"] as const;

type SupportedFieldToRecover = (typeof supportedFieldsToRecover)[number];

const tabPresses = {
  Artist: 6,
  Album: 7,
} as const satisfies Record<SupportedFieldToRecover, number>;

const allTabPressesSorted = Object.entries(tabPresses).sort(
  (a, b) => a[1] - b[1]
) as [SupportedFieldToRecover, number][];

type Track = {
  "Track ID": string;
  Name: string;
  Artist: string;
  "Album Artist": string;
  Composer: string;
  Album: string;
  Genre: string;
  Kind: string;
  Size: string; // "10789787"
  "Total Time": string; // duration in milliseconds
  "Disc Number": string;
  "Disc Count": string;
  "Track Number": string;
  "Track Count": string;
  Year: string;
  "Date Modified": string; // "2023-11-10T01:30:05Z"
  "Date Added": string; // "2023-11-10T01:30:05Z"
  "Bit Rate": string; //"256"
  "Sample Rate": string; // "44100"
  "Release Date": string; // "2011-05-27T12:00:00Z"
  Favorited: string;
  Loved: string;
  "Artwork Count": string; // "1"
  "Sort Album": string;
  "Sort Artist": string;
  "Sort Name": string;
  "Persistent ID": string; // "deadbeefdeadbeef"
  "Track Type": string; // "Remote"
  "Apple Music": string;
  "Library Persistent ID": string; // "deadbeefdeadbeef"
};

async function processXmls(
  inputOk: string,
  inputCorrupted: string,
  dateTime: dayjs.OptionType,
  dateTimeFormat: dayjs.OptionType,
  fieldsToRecover: SupportedFieldToRecover[],
  dryRun: boolean
) {
  let tracksOk: Track[] = [];
  let tracksCorrupted: Track[] = [];

  await once(parseXml(inputOk, tracksOk), "end");
  await once(parseXml(inputCorrupted, tracksCorrupted), "end");

  const tracksOkMap = new Map<Track["Persistent ID"], Track>(
    tracksOk.map((tr) => [tr["Persistent ID"], tr])
  );
  const tracksCorruptedMap = new Map<Track["Persistent ID"], Track>(
    tracksCorrupted.map((tr) => [tr["Persistent ID"], tr])
  );

  console.log("Tracks OK imported", tracksOk.length);
  console.log("Tracks OK after deduplication", tracksOkMap.size);
  console.log("Tracks corrupted imported", tracksCorrupted.length);
  console.log("Tracks corrupted after deduplication", tracksCorruptedMap.size);

  await zx.$`sendkeys --application-name "Music" --characters "<c:c:command><p:0.1>"`;

  const allSelectedTracksFingerprints = await clipboardy.read();

  const tracks = allSelectedTracksFingerprints
    .split("\r")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  console.log(
    "Copied these tracks to clipboard: ",
    JSON.stringify(tracks, null, 2)
  );

  // remove selection and position cursor on first track
  await zx.$`sendkeys --application-name "Music" --characters "<c:up><c:down>"`;

  const stats = {
    success: 0,
    "fingerprint-changed": 0,
    "ambiguous-match": 0,
    "missing-in-old-library": 0,
  } satisfies Record<FixTrackResult, number>;

  for (const trackFingerprint of tracks) {
    const trackCorrupted = findTrackByFingerprint(
      tracksCorrupted,
      trackFingerprint,
      dateTime,
      dateTimeFormat
    );

    if (trackCorrupted === undefined) {
      stats["ambiguous-match"] += 1;
    } else {
      // TODO this will probably fail if one of the library XMLs was export after
      // Apple Music was initialised with a new library (e. g. when you Option+Click'ed Apple Music)
      // then we need another interlibrary match mechanism not based on Persistent ID
      const trackOk = tracksOkMap.get(trackCorrupted["Persistent ID"]);
      if (trackOk === undefined) {
        console.log(
          zx.chalk.red(
            `Will skip, trackOk not found ${trackCorrupted["Persistent ID"]}`
          )
        );
        stats["missing-in-old-library"] += 1;
      } else {
        console.log(
          zx.chalk.grey(
            `Will fix track ${trackOk["Persistent ID"]} ${trackOk["Name"]}:`
          )
        );
        // TODO no Artist/Album hardcode, take from args
        console.log(
          zx.chalk.grey(
            `  ${trackCorrupted["Artist"]} - ${trackCorrupted["Album"]}`
          )
        );
        console.log(
          zx.chalk.grey(`  ${trackOk["Artist"]} - ${trackOk["Album"]}`)
        );
        const result = await fixTrack(
          trackCorrupted,
          trackOk,
          trackFingerprint,
          fieldsToRecover,
          dryRun
        );
        stats[result] += 1;
      }
    }
    await zx.$`sendkeys --application-name "Music" --characters "<c:down>"`;
  }

  console.log("stats", JSON.stringify(stats, null, 2));
}

type FixTrackResult =
  | "success"
  | "fingerprint-changed"
  | "ambiguous-match"
  | "missing-in-old-library";

async function fixTrack(
  trackCorrupted: Track,
  trackOk: Track,
  trackCorruptedFingerprint: string,
  fieldsToRecover: SupportedFieldToRecover[],
  dryRun: boolean
): Promise<FixTrackResult> {
  await zx.$`sendkeys --application-name "Music" --characters "<c:c:command><p:0.1>"`;
  const latestFingerprint = (await clipboardy.read()).trim();
  const fingerPrintsMatch = latestFingerprint === trackCorruptedFingerprint;
  console.log("Fingerprints match", fingerPrintsMatch);
  if (!fingerPrintsMatch) {
    console.log(`curr: ${latestFingerprint}`);
    console.log(`prev: ${trackCorruptedFingerprint}`);
    return "fingerprint-changed";
  }

  for (const [idx, [field, tabPress]] of allTabPressesSorted.entries()) {
    const updatedMetadataItem = trackOk[field];
    await clipboardy.write(updatedMetadataItem);
    const shouldPaste = fieldsToRecover.includes(field);

    const keyPresses = `<c:i:command>${"<c:tab>".repeat(
      idx === 0 ? tabPress : tabPress - allTabPressesSorted[idx - 1][1]
    )}${shouldPaste ? "<c:v:command>" : ""}`;
    await zx.$`sendkeys --application-name "Music" --characters ${keyPresses}`;
  }

  const itemCommitAction = dryRun ? "<c:escape>" : "<c:enter>";
  await zx.$`sendkeys --application-name "Music" --characters ${itemCommitAction}`;

  return "success";
}

function findTrackByFingerprint(
  tracks: Track[],
  trackFingerprint: string,
  dateTime: dayjs.OptionType,
  dateTimeFormat: dayjs.OptionType
): Track | undefined {
  const spl = trackFingerprint.split("\t");

  const fpDateAdded = dayjs(spl[0], dateTimeFormat);
  const fpDateModified = dayjs(spl[1], dateTimeFormat);
  const fpReleaseDate = dayjs(spl[2], dateTime);
  const fpTrackNumber = parseInt(spl[3], 10);
  const fpTitle = spl[4];
  const fpArtist = spl[5];
  const fpAlbum = spl[6];

  const tracksFound = tracks.filter((tr) => {
    const curDateAdded = dayjs(tr["Date Added"], "YYYY-MM-DDTHH:mm:ssZ");
    const curDateModified = dayjs(tr["Date Modified"], "YYYY-MM-DDTHH:mm:ssZ");
    const curReleaseDate = dayjs(tr["Release Date"], "YYYY-MM-DD");

    return (
      (spl[0] ? fpDateAdded.isSame(curDateAdded, "minute") : true) &&
      (spl[1] ? fpDateModified.isSame(curDateModified, "minute") : true) &&
      (spl[2] ? fpReleaseDate.isSame(curReleaseDate, "day") : true) &&
      (spl[3] ? fpTrackNumber === parseInt(tr["Track Number"], 10) : true) &&
      (spl[4] ? fpTitle === tr["Name"] : true) &&
      (spl[5] ? fpArtist === tr["Artist"] : true) &&
      (spl[6] ? fpAlbum === tr["Album"] : true)
    );
  });

  if (tracksFound.length === 0) {
    console.log(`Did not found track by fingerprint` + trackFingerprint);
    return undefined;
  }
  if (tracksFound.length > 1) {
    const trackIDs = JSON.stringify(
      tracksFound.map((t) => t["Track ID"]),
      null,
      0
    );
    console.log(
      `Found ${tracksFound.length} tracks (track IDs ${trackIDs}) by fingerprint`
    );
    console.log(trackFingerprint);
    return undefined;
  }
  return tracksFound[0];
}

/**
 * Use this in case you need to fingerprint track time.
 *
 * Parses human readable time to milliseconds.
 * @param time in format 2:44, 1:23:44, 0:00:44
 * @returns
 */
function convertToMillis(time: string): number {
  const durationParts = time.split(":");
  return dayjs
    .duration({
      hours: Number(durationParts[durationParts.length - 3]),
      minutes: Number(durationParts[durationParts.length - 2]),
      seconds: Number(durationParts[durationParts.length - 1]),
    })
    .asMilliseconds();
}

function parseXml(filePath: string, tracks: Track[]) {
  const trackStream = getItunesTracks(filePath);

  console.log(`Start parsing Apple Music library from ${filePath}`);

  trackStream.on("data", function (trackString: any) {
    const track = JSON.parse(trackString) as Track;

    Object.entries(track).forEach(([key, value]) => {
      track[key as keyof Track] = decodeXML(value);
    });

    tracks.push(track);
  });

  trackStream.on("error", function (err: any) {
    console.log(err);
    throw new Error("Error parsing xml stream");
  });

  trackStream.on("end", () => {
    console.log(`Finished parsing Apple Music library from ${filePath}`);
  });

  return trackStream;
}

const ArgAppleMusicFields = extendType(string, {
  async from(fields) {
    const normalizedFields = fields
      .split(",")
      .map((f) => f.trim()) as SupportedFieldToRecover[];

    const notSupportedFields = normalizedFields.filter(
      (f) => !supportedFieldsToRecover.includes(f as any)
    );

    if (notSupportedFields.length !== 0) {
      throw new Error(
        `These fields are not supported: ${notSupportedFields}. Please use only these fields: ${supportedFieldsToRecover.join(
          `, `
        )}`
      );
    }

    return normalizedFields;
  },
});

const defaultDryRun = true;

const cmd = command({
  name: "apple-music-metadata-fixer",
  version: "0.0.1",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      short: "d",
      description: `Dry run, do everything except actual changes. The last step will be to press ESC instead of Enter.`,
    }),
    inputOk: option({
      long: "input-ok",
      type: string,
      description: "Input file with proper metadata",
    }),
    inputCorrupted: option({
      long: "input-corrupted",
      type: string,
      description: "Input file with corrupted metadata",
    }),
    dateTimeFormat: option({
      long: "date-time-format",
      type: string,
      description:
        "Date time format as provided by Apple Music. https://day.js.org/docs/en/parse/string-format",
    }),
    dateTime: option({
      long: "date-format",
      type: string,
      description:
        "Date format as provided by Apple Music https://day.js.org/docs/en/parse/string-format",
    }),
    fieldsToRecover: option({
      long: "fields-to-recover",
      type: ArgAppleMusicFields,
      description: `Comma separated fields to recover: ${supportedFieldsToRecover.join(
        ","
      )}`,
    }),
  },
  handler: async (args) => {
    console.log("dryRun", JSON.stringify(args, null, 2));
    const {
      dryRun,
      inputOk,
      inputCorrupted,
      dateTime,
      dateTimeFormat,
      fieldsToRecover,
    } = args;
    await processXmls(
      inputOk,
      inputCorrupted,
      dateTime,
      dateTimeFormat,
      fieldsToRecover,
      dryRun
    );
  },
});

run(cmd, Deno.args);
