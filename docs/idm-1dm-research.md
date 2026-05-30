# IDM & 1DM — How They Work (Research)

## Why Study These

IDM (Internet Download Manager, Windows) and 1DM (1Downloader, Android) are the gold standard
for browser-integrated download managers. Understanding their exact mechanics lets us build
something that feels equally instant and trustworthy rather than reinventing the wheel badly.

---

## IDM — Internet Download Manager (Windows)

### Architecture

IDM is a **two-part system**:
- A **desktop application** that manages downloads, queue, speed limits, scheduling
- A **browser extension** that detects content and passes URLs to the desktop app via a local
  integration interface (localhost socket/named pipe)

This is why IDM works even on sites that try to block it — the browser extension only needs to
capture the URL; the actual downloading happens in the desktop app at the OS network level.

### Video Detection — How It Actually Works

IDM uses **two layers simultaneously**:

**Layer 1 — Network request interception (webRequest API)**
The extension watches every outgoing network request. When the browser makes a request for a URL
with a video MIME type (`video/mp4`, `video/x-flv`) or a streaming manifest (`.m3u8`, `.mpd`),
IDM captures that URL immediately — before the browser even finishes loading it.

**Layer 2 — DOM fingerprinting**
IDM stamps every detected `<video>` element with a custom attribute: `idm_id="..."`.
This lets it track elements through re-renders and SPA route changes. If the same video element
gets new content, IDM knows because it owns the `idm_id` reference.

**Trigger:** The floating panel appears the moment a video request is intercepted or a `<video>`
element with a valid src is found. It does not wait for the user to interact.

### The Floating Panel

- Appears as a small overlay **directly on top of the video player**
- Positioned top-right or bottom-right of the video element
- Contains: a video icon + "Download" text + a quality/format dropdown arrow
- If only one quality: clicking "Download" starts immediately, no dialog
- If multiple qualities: clicking the dropdown arrow expands an inline list

**Key design choice:** Everything happens inline on the page. No popups. No new windows.
The overlay is injected into `document.body` with `position: fixed` calculated from the
video's `getBoundingClientRect()` — exactly so YouTube/player overlays can't block it.

### Quality Selection

When multiple qualities exist, IDM shows an **inline dropdown** from the panel:

```
[ ▶ Download this video ▾ ]
  ├── 1080p MP4  —  892 MB   ← highest quality, pre-selected
  ├── 720p MP4   —  348 MB
  ├── 480p MP4   —  156 MB
  └── 360p MP4   —   89 MB
```

**Critical detail:** IDM shows **file size next to each quality**. It does this by sending a
quick `HEAD` request to each quality URL and reading the `Content-Length` response header.
Users see exactly what they're committing to before clicking. This is what makes it feel
trustworthy. Without sizes, users are guessing.

**Pre-selection logic:** IDM pre-selects the highest available quality, not the currently-playing
one. (YouTube defaults to adaptive; IDM ignores that and offers all static options.)

### Filename Generation

Priority order IDM uses:
1. `Content-Disposition: attachment; filename="..."` header from server response
2. Last path segment of the URL (e.g. `/video.mp4` → `video.mp4`)
3. Page `<title>` tag, cleaned for filesystem (strips special chars)
4. Generic fallback: `videoplayback.mp4`

**Known IDM weakness:** When CDNs serve files through endpoints like `/getvid?evid=...` with no
file extension and no Content-Disposition header, IDM names the file `getvid` — the same problem
we had. IDM doesn't parse page slugs. We can do better with Option B slug parsing.

### What Makes IDM Feel Fast

1. **Detection is passive** — always listening, not triggered by user action
2. **No confirmation dialog for single-quality downloads** — one click, starts immediately
3. **Inline UI** — no context switching, no new window to find
4. **File sizes shown upfront** — eliminates doubt

---

## 1DM — 1Downloader (Android)

### Architecture

1DM is fundamentally different from IDM: **it IS the browser**. There is no separate
extension to install. The app contains a full browser engine with download detection baked in.

This eliminates the entire "extension talks to desktop app" complexity. The browser and the
download manager share the same process.

### Video Detection

Because 1DM controls the browser, it can intercept at the network level internally — no webRequest
API needed. Every outgoing request passes through its download detection filter.

Additionally:
- **Clipboard monitoring**: 1DM watches the clipboard for video URLs. Copy a URL anywhere → 1DM
  offers to download it
- **Share intent**: Any app can share a URL to 1DM (YouTube, Twitter, etc.) and it handles detection
- **Social media integration**: Direct detection on YouTube, Facebook, Instagram, Twitter/X

### Quality Selection

```
[Detected: video.mp4]
  ● 1080p   892 MB    ← pre-selected (highest)
    720p    348 MB
    480p    156 MB
    360p     89 MB
  [Download]  [Cancel]
```

Same pattern as IDM: sizes shown, highest pre-selected. The bottom sheet slides up from the bottom
of the screen (standard Android UX). No separate window.

### Key Differences from IDM

| Aspect | IDM (Windows) | 1DM (Android) |
|---|---|---|
| Browser relationship | Separate app + extension | Same app IS the browser |
| Detection method | webRequest API + DOM | Internal network filter |
| UI pattern | Floating overlay on video | Bottom sheet slide-up |
| Quality display | Inline dropdown on overlay | Bottom sheet list |
| File sizes shown | Yes (HEAD request) | Yes |
| Pre-selected quality | Highest available | Highest available |
| Filename source | Content-Disposition > URL > title | Same |
| Clipboard integration | No | Yes |

---

## Open-Source References Worth Studying

### Persepolis WebExtension
**https://github.com/persepolisdm/Persepolis-WebExtension**

Most relevant open-source project to LDM. Same architecture: browser extension talks to a local
download manager server. Key things to learn from their code:
- How they catch download URLs from the browser
- How they pass metadata (filename, referrer, cookies) to the backend
- Their settings UI pattern

### DownThemAll
**https://github.com/downthemall/downthemall**

Mature, well-tested MV3 extension. Good for learning:
- Stable webRequest patterns
- How to handle the MV3 service worker sleep problem
- Link and media detection from page DOM

### pyIDM
**https://github.com/P3NG3R/pyIDM**

Python open-source IDM alternative. Uses youtube-dl/yt-dlp for video extraction (same as us).
Good for seeing how they handle the download queue, segments, and file assembly.

---

## What to Adopt for LDM

### Immediately actionable

| IDM/1DM practice | LDM status | Action |
|---|---|---|
| File size next to quality | Missing | HEAD request per quality URL → show MB |
| Inline quality dropdown on button | Missing | Expand button instead of separate modal |
| Highest quality pre-selected | Missing | Sort quality list, pre-select top |
| DOM fingerprinting with data attribute | Missing | Replace WeakSet with `data-ldm-id` |
| Content-Disposition filename first | Partial (aria2 reads it) | Verify it's being stored |
| Page slug as filename fallback | Planned | Implement Option B |

### Architectural insight

IDM's floating button uses `position: fixed` calculated from `getBoundingClientRect()` and is
appended to `document.body` — exactly what we already do. This confirms our current approach
is correct. The gap is the quality picker and the file sizes.

### The one thing that makes both feel magic

Neither IDM nor 1DM asks you to do anything. You visit a page with a video → the button appears.
You click it → if one quality, download starts. If multiple, you see sizes and pick. Done.
**Zero friction between "I want this" and "downloading".**

Our current flow adds friction at the quality step because we don't show options at all yet.
