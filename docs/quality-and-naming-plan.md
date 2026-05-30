# Plan: Filename (Option B) + Multi-Quality Selection

## Lessons from IDM & 1DM Research

Three things that make IDM feel instant and trustworthy that we currently lack:

1. **File sizes next to quality options** — IDM sends a HEAD request per quality URL, reads
   `Content-Length`, shows `1080p — 892 MB` before you click. Users know what they're getting.

2. **Inline quality picker on the button** — not a modal, not a new window. The floating button
   expands into a compact list directly on the video. Click → list → click quality → done.

3. **DOM fingerprinting** — IDM stamps each `<video>` with a custom attribute (`idm_id="..."`)
   so it tracks elements even when the page's own JS re-renders them (common in SPAs).
   We use WeakSet which loses tracking on element replacement.

Open-source reference worth reading: **Persepolis WebExtension**
https://github.com/persepolisdm/Persepolis-WebExtension
Same architecture split: auto-catch for downloads, on-demand button for video extraction.

---

## Part 1 — Slug to Clean Name

Extension sends `pageUrl` (parent page, not embed). Backend parses the slug.

```
Input:  https://www.wco.tv/one-piece-episode-1163-english-subbed
Slug:   one-piece-episode-1163-english-subbed

Rules:
  1. Split on "-"
  2. Episode number → prefix with "Episode"
  3. "english-subbed" / "english-dubbed" → "(English Subbed)"
  4. "season-X" → "Season X"
  5. Title-case remaining words
  6. Append [quality] if known

Output: One Piece - Episode 1163 (English Subbed) [1080p].flv
```

### Examples

| Slug | Output |
|---|---|
| `one-piece-episode-1163-english-subbed` | `One Piece - Episode 1163 (English Subbed) [1080p].flv` |
| `attack-on-titan-season-4-episode-28-dubbed` | `Attack on Titan - Season 4 Episode 28 (Dubbed) [1080p].flv` |
| `demon-slayer-episode-5` | `Demon Slayer - Episode 5 [1080p].flv` |
| `naruto-shippuden-episode-500-english-subbed` | `Naruto Shippuden - Episode 500 (English Subbed) [1080p].flv` |

---

## Part 2 — Multi-Quality Detection

### How qualities appear on sites

**Type A — Multiple `<source>` elements**
```html
<video>
  <source src="cdn.com/ep.360p.mp4"  label="360p">
  <source src="cdn.com/ep.720p.mp4"  label="720p">
  <source src="cdn.com/ep.1080p.mp4" label="1080p">
</video>
```

**Type B — VideoJS player sources** (wco.tv)
```js
videojs.players['video-js'].currentSources()
// → [{ src: '...720p...', label: '720p' }, { src: '...1080p...', label: '1080p' }]
```

**Type C — HLS master playlist**
Background intercepts `.m3u8`. Parses `RESOLUTION=` from `EXT-X-STREAM-INF` tags.

**Type D — URL pattern matching (fallback)**
Background groups intercepted URLs by tab. Detects quality via `fullhd=1`, `_1080p`, `?res=720`.

### Detection Priority

```
1. VideoJS player API     → exact quality labels + URLs  (best for wco.tv)
2. <source> elements      → direct from HTML
3. HLS master playlist    → parse BANDWIDTH/RESOLUTION
4. URL pattern matching   → fullhd=1, _1080p, ?res=720
```

---

## Part 3 — Quality Picker UI

**Single source:** button stays as `⬇ LDM`

**Multiple sources detected:** button expands inline

```
┌─────────────────────────┐
│ ⬇ LDM  ▾               │  ← single source
└─────────────────────────┘

Expanded (multiple sources):
┌─────────────────────────┐
│ ● 1080p  HD             │  ← currently playing (pre-selected)
│   720p                  │
│   480p                  │
│   360p                  │
└─────────────────────────┘
```

Each option downloads that URL with quality in filename:
```
One Piece - Episode 1163 (English Subbed) [1080p].flv
One Piece - Episode 1163 (English Subbed) [720p].flv
```

---

## Files to Change

| File | What changes |
|---|---|
| `extension/content.js` | Send `pageUrl` + read VideoJS/source quality list at click time |
| `extension/background.js` | Group intercepted URLs by tab + quality detection from URL patterns |
| `src/downloader.js` | `buildFilename(slug, quality, ext)` + pass `out:` to aria2 |
| `frontend/.../DownloadItem.jsx` | Quality badge on each download item |

---

## wco.tv Specific

VideoJS stores all quality sources in its player object. Read before user clicks:
```js
const sources = window.videojs?.players?.['video-js']?.currentSources?.()
```
Near-instant quality detection — no network interception needed.
