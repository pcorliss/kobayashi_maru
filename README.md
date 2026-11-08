# Star Trek: Kobayashi Maru - offline restoration

Built by `restore/build.mjs` on 2026-11-07T21:38:29.137Z from `kobayashi1.wacz` plus
independently fetched `id_` captures in `work/pristine/`. See
`offline/provenance.json` for the per-file source and sha-256 of everything here.

## run it

    cd build/offline
    python3 -m http.server 8080      # or any static server
    open http://localhost:8080/

Do **not** open `index.html` from the filesystem: the game fetches
`assets/data/story.txt` and `offline/share-texts.json` at runtime, and browsers block
those fetches under `file://`.

## what is original

`main.js`, `main.css`, `assets/data/story.txt` and every `assets/*` file are the archived
bytes. `main.js` is **not modified by this restoration at all** - its recorded sha-256
matches what the archive holds, so you can verify it yourself:

    node -e 'const c=require("crypto"),f=require("fs");console.log(c.createHash("sha256").update(f.readFileSync("build/offline/main.js")).digest("hex"))'
    # compare against files["main.js"].sha256 in offline/provenance.json

`index.html` is the archived page as the site served it (from the identity capture),
with the Google Analytics tag, the Facebook Pixel and the Facebook/Twitter SDK loaders
removed and two kit files added.

## what the kit replaces

The game was built against services that no longer exist: Facebook login/share, and
`api.kobayashimaru.com` for run tracking, the leaderboard and the contest.
`offline/kit.js` supplies local replacements by patching the runtime
(`window.FB`, `fetch`) rather than the bundle:

- cadet registration replaces Facebook login, using the game's own login dialog
- run tracking, leaderboard and contest entries are kept in `localStorage`
- share buttons show the game's original share copy to save by hand

Flags: `?kmhud=on` adds a small badge showing the registered cadet (off by default),
`?kmshare=off` leaves the original share buttons alone, `?kmname=Ada` pre-fills the
cadet name. `KM_OFFLINE.stats()` and `KM_OFFLINE.reset()` are in the console.

## 30 suspiciously small assets

These are shipped exactly as archived (their digests match the archive index), but they are so small they may have been 404 pages at capture time rather than real art:

- `assets/images/enterprise/lights/light-1.png` (383B, capture 20240301125840)
- `assets/images/enterprise/lights/light-2.png` (239B, capture 20240301125949)
- `assets/images/enterprise/lights/light-3.png` (383B, capture 20240301125951)
- `assets/images/enterprise/lights/light-4.png` (290B, capture 20240301130109)
- `assets/images/enterprise/lights/light-8.png` (288B, capture 20240301125824)
- `assets/images/enterprise/panel/screen-name-panel.png` (232B, capture 20240301130046)
- `assets/images/orion-merchant-cabin/screen-1/0.png` (285B, capture 20240301130043)
- `assets/images/orion-merchant-cabin/screen-1/1.png` (302B, capture 20240301130006)
- `assets/images/orion-merchant-cabin/screen-1/2.png` (313B, capture 20240301125822)
- `assets/images/orion-merchant-cabin/screen-1/3.png` (313B, capture 20240301125916)
- `assets/images/orion-merchant-cabin/screen-2/0.png` (396B, capture 20240301130025)
- `assets/images/orion-merchant-cabin/screen-3/0.png` (296B, capture 20240301130006)
- `assets/images/orion-merchant-cabin/screen-3/1.png` (294B, capture 20240301130012)
- `assets/images/orion-merchant-cabin/screen-3/2.png` (287B, capture 20240301130032)
- `assets/images/orion-merchant-cabin/screen-3/3.png` (285B, capture 20240301125845)
- `assets/images/orion-merchant-cabin/screen-4/0.png` (273B, capture 20240301125858)
- `assets/images/orion-merchant-cabin/screen-4/1.png` (277B, capture 20240301130013)
- `assets/images/orion-merchant-cabin/screen-4/2.png` (278B, capture 20240301130031)
- `assets/images/orion-merchant-cabin/screen-4/3.png` (277B, capture 20240301130013)
- `assets/images/orion-merchant-cabin/screen-6/0.png` (257B, capture 20240301130005)
- `assets/images/orion-merchant-cabin/screen-6/1.png` (273B, capture 20240301130106)
- `assets/images/orion-merchant-cabin/screen-6/2.png` (272B, capture 20240301130102)
- `assets/images/orion-merchant-cabin/screen-6/3.png` (258B, capture 20240301125829)
- `assets/images/orion-merchant-cabin/screen-7/0.png` (231B, capture 20240301130106)
- `assets/images/orion-merchant-cabin/screen-7/1.png` (298B, capture 20240301125914)
- `assets/images/orion-merchant-cabin/screen-7/2.png` (290B, capture 20240301130039)
- `assets/images/orion-merchant-cabin/screen-8/0.png` (302B, capture 20240301125952)
- `assets/images/orion-merchant-cabin/screen-8/1.png` (296B, capture 20240301125915)
- `assets/images/orion-merchant-cabin/screen-8/2.png` (295B, capture 20240301130029)
- `assets/images/orion-merchant-cabin/screen-8/3.png` (291B, capture 20240301130023)
## the DEATHS counter

This one needed no repair, and an earlier revision of this kit broke it by "fixing" it.

The counter is implemented in the archived **story data**, not in the bundle and not in the
kit:

- passage `Start` — `<<set $death to -1>>`
- passage `Sim Spinup` — `<<if $devnotes is "true">> … <<else>> <<set $death += 1>>`, i.e. it only counts when developer notes are off
- the unmodified bundle reads it — `getDeathCount()` is `parseInt(state.data.variables.death)`, then `isNaN ? 0 : Math.max(0, e)`

So the number is **trips back through the simulator**, deliberately offset by -1 so the first
attempt reads 0, and it is shown on the defeat screen via `setFails(getDeathCount())`. That
means a single death is scored by the following spin-up, not by the death passage itself.

The `DEATHS = <<print $death>>` readout itself sits in `Sim Spinup`, inside the dev-notes
branch, which is why it is easy to mistake for an unwritten variable.

Separately, the story tags 12 passages with
`<defeat>death</defeat>` and 3 with
`<defeat>fail</defeat>`, and sets 4 one-way
booleans on the "go on" link of certain deaths ($death_daggerpox, $death_merchantpoison, $death_orionpirate, $death_planetoid). That is real story metadata, listed in
`offline/provenance.json` under `story.deathNodes`, but it is **not** what drives the
readout. (Counting those tags instead - which is what an earlier revision did - double
counts: the story's own `+= 1` fires as well. It also mis-scores chains like
`Garra Fire Phasers Dead 2 -> 3 -> 4` as three deaths.) The kit now reads the game's number
for the local leaderboard and never writes it; `build.mjs` asserts both facts on every build.
