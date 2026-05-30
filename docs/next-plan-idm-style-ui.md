# Next Plan: IDM-Style Floating Dropdown + Option B Naming

## What We're Building

Exactly what IDM does. A floating button appears on any video. When you tap it, it expands
into a dropdown showing the video title (clean, from the page URL) and each available quality
with its file size. Tap a quality and it downloads immediately. That's it.

---

## The Full Flow

```
1. Extension detects video on page
        ↓
2. Small floating button appears on video: [ ⬇ LDM ]
        ↓
3. User taps the button
        ↓
4. Button expands into dropdown:

   ┌─────────────────────────────────────────┐
   │  One Piece - Episode 1163 (Eng Subbed)  │  ← title from page URL slug
   ├─────────────────────────────────────────┤
   │  ● 1080p  HD          892 MB            │  ← currently streaming, pre-selected
   │    720p               348 MB            │
   │    480p               156 MB            │
   │    360p                89 MB            │
   └─────────────────────────────────────────┘

5. User taps a quality row
        ↓
6. Download starts → button shows [ ✓ Added ]
        ↓
7. File saved as: One Piece - Episode 1163 (English Subbed) [1080p].flv
```

---

## Part 1 — Quality Detection (Extension, content.js)

When the button is injected on a video, immediately scan for all quality sources.
Three strategies tried in order:

### Strategy A — VideoJS Player API (wco.tv and most anime sites)
```js
const player = window.videojs?.players?.['video-js']
const sources = player?.currentSources?.()
// Returns: [{ src: 'url', label: '1080p', type: 'video/mp4' }, ...]
```
Best result — gives exact quality labels and URLs directly from the player.

### Strategy B — `<source>` elements inside `<video>`
```js
video.querySelectorAll('source').forEach(s => {
  // s.src, s.getAttribute('label'), s.getAttribute('res'), s.type
})
```
Works on sites that list multiple sources directly in HTML.

### Strategy C — Network-intercepted URLs (background already collects these)
Background already tracks all intercepted media URLs per tab. If multiple were
collected for the same tab, group them and infer quality from URL patterns:
- `fullhd=1` → 1080p,  `fullhd=0` → SD
- `_1080p.mp4`, `_720p.mp4` in filename → obvious
- `?quality=720` parameter → obvious

If only one quality is found from all three strategies → simple button, download immediately.
If multiple → show dropdown.

---

## Part 2 — File Sizes (Background, background.js)

When dropdown is about to open, send all quality URLs to the background:
```
content → background: { type: 'get_quality_sizes', sources: [{url, label}] }
background → HEAD request to each URL → read Content-Length
background → content: [{ url, label, size: 935772160, sizeStr: '892 MB' }]
```

HEAD requests are fast (no body downloaded). If a URL returns no Content-Length
(streaming, or server blocks HEAD) → show `—` for that row, still show the row.

---

## Part 3 — Dropdown UI (content.js + content.css)

### Button states

```
Default (1 quality):          [ ⬇ LDM ]  → tap → download immediately

Default (multiple qualities): [ ⬇ LDM ▾ ]  → tap → expand dropdown

Loading sizes:                [ ⬇ LDM … ]  → fetching sizes

After download:               [ ✓ Added ]   → 3s → back to normal
```

### Dropdown layout

```
┌─────────────────────────────────────────────┐
│  One Piece - Episode 1163 (English Subbed)  │  ← title, not clickable
├─────────────────────────────────────────────┤
│  ●  1080p  HD          892 MB               │  ← dot = currently playing
│     720p               348 MB               │
│     480p               156 MB               │
│     360p                89 MB               │
└─────────────────────────────────────────────┘
```

- Dropdown appears BELOW the button (or above if button is near bottom of screen)
- Position: `fixed`, coordinates calculated from button's `getBoundingClientRect()`
- Closes on: click outside, Escape key, scroll
- Each row: hover darkens it, tap → download that quality → dropdown closes

---

## Part 4 — Option B Naming (Backend, downloader.js)

Extension sends `pageUrl` (the parent wco.tv page, not the embed URL) and `quality` label.
Backend parses the slug into a clean filename.

### Parsing rules

```
Slug: one-piece-episode-1163-english-subbed

Step 1 — Find "episode N" → "Episode 1163", remove from slug
Step 2 — Find "season N"  → "Season 4",    remove from slug
Step 3 — Find "subbed"/"dubbed" with optional "english"/"japanese" prefix
          → "(English Subbed)", remove from slug
Step 4 — Title-case what remains → "One Piece"
Step 5 — Assemble: Title [- Season N] [Episode N] [(Sub/Dub)] [[Quality]].[ext]
```

### Output examples

| Page URL slug | Quality | Output filename |
|---|---|---|
| `one-piece-episode-1163-english-subbed` | 1080p | `One Piece - Episode 1163 (English Subbed) [1080p].flv` |
| `attack-on-titan-season-4-episode-28-dubbed` | 720p | `Attack on Titan - Season 4 Episode 28 (Dubbed) [720p].mp4` |
| `demon-slayer-episode-5` | 1080p | `Demon Slayer - Episode 5 [1080p].mp4` |
| `naruto-shippuden-episode-500-english-subbed` | 480p | `Naruto Shippuden - Episode 500 (English Subbed) [480p].flv` |
| (no page URL) | 1080p | `download [1080p].mp4` ← graceful fallback |

### Pass to aria2

```js
// aria2 addUri option — overrides the output filename
opts.out = 'One Piece - Episode 1163 (English Subbed) [1080p].flv'
```

---

## Part 5 — What Gets Sent / What the Backend Receives

Extension sends to backend on download click:
```json
{
  "url":     "https://e14.wcostream.com/getvid?evid=...",
  "engine":  "aria2",
  "referer": "https://embed.wcostream.com/...",
  "cookies": "session=abc; token=xyz",
  "pageUrl": "https://www.wco.tv/one-piece-episode-1163-english-subbed",
  "quality": "1080p"
}
```

Backend uses `pageUrl` + `quality` to build the filename. Everything else was already there.

---

## Files to Change

| File | What changes |
|---|---|
| `extension/content.js` | Quality detection (VideoJS, source elements), dropdown render, send pageUrl+quality |
| `extension/background.js` | `get_quality_sizes` handler — HEAD requests per quality URL |
| `extension/content.css` | Dropdown styles, hover states, animation |
| `src/downloader.js` | `buildFilename(slug, quality, ext)` function, pass `out:` to aria2 |
| `src/server.js` | Accept `pageUrl` and `quality` in POST /api/downloads body |

---

## Implementation Order (Recommended)

1. **Naming first (backend only)** — no UI work, immediately improves every download
   - `buildFilename()` in downloader.js
   - Accept `pageUrl` + `quality` in server.js
   - Extension sends `pageUrl` on every click (trivial, already have `document.referrer`)

2. **Dropdown UI (no sizes yet)** — show quality list, make it clickable, no sizes shown
   - VideoJS + source element detection
   - Dropdown CSS + render logic
   - Each row sends download with that URL + quality label

3. **File sizes** — add HEAD requests, populate sizes into the dropdown
   - `get_quality_sizes` in background.js
   - Wire into dropdown display

4. **Polish** — pre-select currently playing quality, close on outside click, handle edge cases

---

## Edge Cases to Handle

| Case | Handling |
|---|---|
| VideoJS not available | Fall through to source elements → network URLs |
| HEAD request fails or no Content-Length | Show `—` for size, still show the row |
| Only 1 quality found | No dropdown, download immediately on button tap |
| pageUrl not available (e.g. opened embed directly) | Skip naming, use Content-Disposition or `download [quality].ext` |
| Quality label not in URL pattern | Label as "Default" or show URL domain |
| Dropdown goes off-screen bottom | Render above the button instead |
