# Summary

Recovers metadata from Apple Music XML library backup to actual Apple Music
application. Uses fingerprinting based on date added/modified/track duration
to match tracks between actual Apple Music app, it's lateset (corrupted) export and then uses PermanentID to match with old (non corrupted) export. Then sync designated fields from old backup into actual Apple Music app so that it syncs correctly to the cloud.

# Steps

## Preliminary step, preparing 2 XMLs

1. You've found that Apple Music corrupted some metadata. In my case `CMD+A` somehow selected not only tracks in the current view but all tracks in the library. So I've changed every single album and artist in my media library to a single string.
2. First step is to export current state of the library into `library-corrupted.xml` (see [Test run](https://github.com/kompot/apple-music-metadata-fixer/blob/main/README.md#test-run) below).
3. Then you need to find old library backup. I had it in my Apple Music folder in `Previous Libraries.localized`. You may also have Time Machine backups or something else. If you have it in a form of `xml` export — great, skip the next step.
4. Disconnect from the internet and import that old media library into Apple Music. Option click Apple Music icon and it will ask you to import library. Choose the one you think might have non-corrupted metadata from step above. If you don't disconnect then Apple Music will start immediately sync everything corrupted back from the cloud to your local library.
5. Repeat step 2 and export your old non corrupted library into `library-ok.xml`.
6. You may now enable your internet connection. Apple Music will start syncing bad data into your library. Yikes.

## Actual fixing

1. Create a [smart playlist](https://support.apple.com/et-ee/guide/music/mus1712973f4/mac) that will contain all your bad tracks. Disable auto-updating it. You can create a regular one. Doesn't matter. I guess it's just easier to track down all the corrupted metadata with a smart one.
2. Set 7 first fields of this playlist to these (order matters):
  - date added
  - date modified
  - release date
  - track #
  - title
  - artist
  - album
3. Select some/all tracks in it. These are the tracks that will be tried for a fix.
  **Important!** Tracks must be in sequence. No blanks in selection. It will fail at best. I advise to start with just one.
4. Right now this script supports _only_ these `fields-to-recover` that are set in [this variable](https://github.com/kompot/apple-music-metadata-fixer/blob/main/src/main.ts#L28-L31). The number in the value of each entry is the number of `tab` presses required to get to the field in Apple Music's meta info popup (which appears when `CMD+I` is pressed). If you need to fix other field it should be trivial. Just add these 2 values to the variable above. But if fields that need to be fixed are on another page of metadata info popup then it's not that trivial. Feel free to make a PR.
5. Make a [test run](https://github.com/kompot/apple-music-metadata-fixer/blob/main/README.md#test-run). If everything goes as expected then remove `--dry-run` parameter. Be sure to set correct date/time formats as it depends on macOS system preferences and I couldn't find an (easy) way to get this from OS.

# Prerequisites

macOS (tested only on Sonoma 14.2.1 (23C71)), Apple Music (tested only on 1.4.2.83).

[deno](https://deno.com/) and [sendkeys](https://github.com/socsieng/sendkeys)

You can another NodeJS runtime but I think Deno is just what the doctor ordered for such cases.

```
brew install deno
brew install socsieng/tap/sendkeys
```

# Run

## Options

```console
apple-music-metadata-fixer 0.0.1

FLAGS:
  --dry-run, -d - Dry run, do everything except actual changes. The last step will be to press ESC instead of Enter.
  --help, -h    - show help
  --version, -v - print the version

OPTIONS:
  --input-ok <str>          - Input file with proper metadata
  --input-corrupted <str>   - Input file with corrupted metadata
  --date-time-format <str>  - Date time format as provided by Apple Music. https://day.js.org/docs/en/parse/string-format
  --date-format <str>       - Date format as provided by Apple Music https://day.js.org/docs/en/parse/string-format
  --fields-to-recover <str> - Comma separated fields to recover: Album,Artist
```

## Test run

Start with `dry-run` option which differs only in one aspect — instead of sending `Enter` key in Apple Metadata popup it sends `Escape` and closes it without saving anything. So that you could control everything until the last moment. It's recommended to make a full run with `--dry-run`, inspect console output and only then run without `--dry-run`.

```console
deno run --allow-read --allow-env --allow-sys --allow-run ./src/main.ts \
  --input-ok ./library-ok.xml \
  --input-corrupted=./library-corrupted.xml \
  --date-time-format "DD.MM.YYYY, HH:mm" \
  --date-format "DD.MM.YYYY" \
  --fields-to-recover "Album,Artist" \
  --dry-run
```
