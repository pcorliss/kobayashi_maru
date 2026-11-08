# Star Trek: Kobayashi Maru — offline restoration

An offline restoration of the now-defunct 2021 web game. The original announcement,
[The Kobayashi Maru Hits the Web](https://www.startrek.com/en-un/news/the-kobayashi-maru-hits-the-web),
has more background.

Originally developed by [Scopely](https://www.scopely.com/), the game stopped working after a
few months when its Facebook login broke. Years later the site was taken offline, and
`www.kobayashimaru.com` no longer resolves. I rebuilt it from a
[Wayback Machine capture](https://web.archive.org/web/20240713090225/https://www.kobayashimaru.com/)
with help from a local LLM, replacing the Facebook login and the missing game API with a local
stand-in. I hope you enjoy it.

## Run it

```
python3 -m http.server 8080   # or any other port
```

Then navigate to http://localhost:8080/

Do **not** open `index.html` from the filesystem: the game fetches `assets/data/story.txt` and
`offline/share-texts.json` at runtime, and browsers block those fetches under `file://`.

## Restoration

The game was built against services that no longer exist: Facebook login and share, and
`api.kobayashimaru.com` for run tracking, the leaderboard, and the contest. `offline/kit.js`
supplies local replacements by patching the runtime (`window.FB`, `fetch`) rather than the
bundle:

- Cadet registration replaces Facebook login, using the game's own login dialog.
- Run tracking, leaderboard, and contest entries are kept in `localStorage`.
- The share buttons show the game's original share text, for you to copy by hand.

## Licensing

All content belongs to its original owners — [Scopely](https://www.scopely.com/), 
Paramount, and any other rights holders. I do not claim ownership of any of this content.
