# Star Trek: Kobayashi Maru - offline restoration

Offline restoration of the now defunct 2021 web-based game.
See the original announcement [The Kobayashi Maru Hits the Web](https://www.startrek.com/en-un/news/the-kobayashi-maru-hits-the-web) for more info.
Originally developed by [Scopely Games](https://www.scopely.com/) the game stopped working after a few months due to a Facebook login issue. After a few years the site was taken offline and `www.kobayashimaru.com` no longer resolves over DNS. I used a a local LLM and the archive from the [Wayback Machine](https://web.archive.org/web/20240713090225*/http://www.kobayashimaru.com:80/) to reconstruct it and disable the Facebook login. I hope you enjoy.

## Run it

```
python3 -m http.server 8080 # Or any other port
```
Navigate to http://localhost:8080

Do **not** open `index.html` from the filesystem: the game fetches
`assets/data/story.txt` and `offline/share-texts.json` at runtime, and browsers block
those fetches under `file://`.

## Restoration

The game was built against services that no longer exist: Facebook login/share, and
`api.kobayashimaru.com` for run tracking, the leaderboard and the contest.
`offline/kit.js` supplies local replacements by patching the runtime
(`window.FB`, `fetch`) rather than the bundle:

- cadet registration replaces Facebook login, using the game's own login dialog
- run tracking, leaderboard and contest entries are kept in `localStorage`
- share buttons show the game's original share copy to save by hand

## Licensing

All content belongs to their original owners, [Scopely Games](https://www.scopely.com/), likely Paramount, and all other rights holders. I do not claim ownership over any of this content.
