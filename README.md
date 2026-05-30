# LDM — Linux Download Manager

A fast, browser-integrated download manager for Ubuntu/Linux. Works like IDM:
- Detects downloadable files on **any website** automatically
- Splits files into multiple parallel segments for maximum speed
- Adds a download button directly on video players
- Manages all downloads from a clean web UI at `localhost:6543`

---

## Prerequisites

Install these two tools before running LDM. Both are checked on startup and LDM tells you if either is missing.

### aria2 — multi-segment download engine
```bash
sudo apt install aria2
```
> Without aria2, downloads fall back to single-connection mode (slower). Everything still works.

### yt-dlp — video site extractor (YouTube, Vimeo, TikTok, etc.)
```bash
pip3 install yt-dlp
```
> LDM will try to auto-install yt-dlp via pip3 on first run. If that fails, run the command above manually.

---

## Quick Start

### Option A — Install from the project folder (local / development)

```bash
git clone https://github.com/EbaAdisu/ldm.git
cd ldm
sudo npm install -g .
ldm
```

> The `.` installs the local folder as a global package. `sudo` is required because npm's global directory is owned by root on standard Ubuntu installs.

### Option B — Install from npm (once published)

```bash
npm install -g ldm-dl
ldm
```

Once running, LDM checks for dependencies and opens `http://localhost:6543` automatically.

---

## How It Works — Full Picture

```
┌────────────────────────────────────────────────────────────────┐
│  Your Browser                                                   │
│                                                                 │
│  ┌──────────────────────────┐   ┌───────────────────────────┐  │
│  │   Browser Extension       │   │  Web UI (localhost:6543)  │  │
│  │                           │   │                           │  │
│  │  • Watches ALL network    │   │  • Download queue         │  │
│  │    responses for files    │   │  • Live progress bars     │  │
│  │  • Injects ⬇ button on   │   │  • Pause / Resume         │  │
│  │    video players          │   │  • History                │  │
│  │  • Adds LDM link next to  │   │  • Settings               │  │
│  │    download links         │   │  • Extension install guide│  │
│  └────────────┬─────────────┘   └────────────┬──────────────┘  │
└───────────────┼──────────────────────────────┼─────────────────┘
                │  HTTP POST /api/downloads      │  WebSocket
                ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│  LDM Backend  (Node.js + Express, port 6543)                  │
│                                                               │
│  • REST API  — add, pause, resume, cancel, delete             │
│  • WebSocket — real-time speed and progress to the UI         │
│  • SQLite    — download history and settings (~/.ldm/ldm.db)  │
│  • Auto-detects best download engine per URL                  │
└──────────┬──────────────────────────┬────────────────────────┘
           │                          │
           ▼                          ▼
┌─────────────────────┐   ┌─────────────────────────────────────┐
│  aria2c daemon       │   │  yt-dlp (subprocess)                │
│  (port 6800)         │   │                                     │
│                      │   │  Handles: YouTube, Vimeo, Twitter,  │
│  Handles: direct     │   │  Instagram, TikTok, Facebook,       │
│  HTTP/FTP/HTTPS      │   │  Reddit, and 1000+ other sites      │
│  files               │   │                                     │
│                      │   │  Auto-selects best quality          │
│  Splits file into    │   │  Merges video+audio streams         │
│  N segments and      │   │                                     │
│  downloads all in    └───┘                                     │
│  parallel            Auto-detection picks the right engine     │
└─────────────────────┘                                          │
```

---

## How Downloads Are Detected (No Website List Needed)

Unlike a simple URL-based blocklist, LDM uses three detection layers that work on **any website**:

### Layer 1 — Network Response Sniffing (most powerful)
The browser extension watches every network response. When a response has a media or file Content-Type header like:
- `video/mp4`, `video/webm`, `audio/mpeg`
- `application/octet-stream` (generic binary)
- `application/zip`, `application/pdf`

…LDM automatically offers to intercept it. This is exactly how IDM works — it doesn't care which site you're on, it cares what the server is sending.

### Layer 2 — Link Detection (content script)
The extension scans all `<a href>` links on every page. If a link points to a file with a known extension (`.mp4`, `.mkv`, `.zip`, `.iso`, `.pdf`, `.mp3`, etc.), it adds a small **⬇ LDM** button next to that link.

### Layer 3 — Video Player Injection
For embedded video players (`<video>` HTML elements), the extension injects a download button directly on the player — visible over the video while you watch. Click it and the URL is sent to LDM.

---

## Auto Engine Selection

When you add a URL, LDM does a quick `HEAD` request to figure out what the URL actually is:

```
URL added
   │
   ├─ HEAD request → Content-Type: video/* or audio/*
   │                  → Use aria2 (fast multi-segment download)
   │
   ├─ HEAD request → Content-Type: text/html
   │                  → It's a webpage, use yt-dlp to extract embedded media
   │
   ├─ URL ends in .mp4 / .zip / .mkv / etc.
   │                  → Use aria2
   │
   └─ HEAD request fails or unclear
                      → Try yt-dlp first, fall back to aria2
```

You can also override the engine manually in the "New Download" dialog.

---

## How Segmented (Fast) Downloading Works

When aria2 downloads a file, it:

1. Makes a `HEAD` request to check if the server supports `Range` headers
2. If yes, splits the file into N segments (default: 16)
3. Opens N parallel connections and downloads each segment simultaneously
4. Reassembles the file when all segments finish

**Example:** A 1GB file with 16 segments = each connection downloads ~64MB.
If your internet is 100 Mbps and the server supports it, you get close to full speed regardless of any single-connection throttling the server applies.

You can tune this in Settings:
- **Segments**: how many pieces to split into (more = faster on fast connections, diminishing returns after ~16)
- **Connections per segment**: extra TCP connections per segment
- **Speed limit**: cap total bandwidth LDM uses

---

## Installing the Browser Extension

The extension is included in the LDM package at `~/.ldm/extension/` (or `./extension/` if running from source).
The Web UI at `http://localhost:6543` has a step-by-step guide under the **Extension** tab.

### Chrome / Brave / Edge / Chromium

1. Open `chrome://extensions` in your browser
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder inside the LDM directory
5. Done — the extension icon appears in your toolbar

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Navigate to the `extension/` folder and select `manifest.json`

> **Note:** Firefox's temporary add-on is removed when the browser closes. For permanent install, the extension would need to be signed by Mozilla. For now, reload it after each browser restart.

---

## Settings Reference

All settings are at `http://localhost:6543` → Settings tab, and stored in `~/.ldm/ldm.db`.

| Setting | Default | Description |
|---|---|---|
| Download folder | `~/Downloads` | Where files are saved |
| Segments per file | 16 | How many parallel chunks aria2 splits the file into |
| Connections per segment | 4 | Extra TCP connections per segment |
| Max concurrent downloads | 3 | How many files download at the same time |
| Speed limit (KB/s) | 0 (unlimited) | Global cap. Set to e.g. 5000 to limit to ~5 MB/s |
| Min intercept size | 1 MB | Files smaller than this are ignored by auto-intercept |
| File types to intercept | mp4,mkv,webm,mp3,zip,iso,pdf,... | What extensions trigger LDM in the browser |

---

## Dependencies

LDM needs two external tools. It checks for them on startup and tells you how to install them if missing.

| Tool | What it's for | Install |
|---|---|---|
| `aria2c` | Fast multi-segment downloads for direct files | `sudo apt install aria2` |
| `yt-dlp` | Video extraction from YouTube, Vimeo, social media, etc. | Auto-installed via `pip3 install yt-dlp`, or manually |

If `aria2c` is not installed, LDM falls back to single-connection HTTP downloads (still works, just slower).
If `yt-dlp` is not installed, video site extraction is unavailable (direct file downloads still work fine).

---

## CLI Options

```bash
ldm                    # Start, open browser automatically
ldm --no-browser       # Start without opening browser (headless/server mode)

LDM_PORT=8080 ldm      # Use a custom port (default: 6543)
```

---

## Data & Storage

```
~/.ldm/
└── ldm.db               # SQLite database — download history + settings

~/Downloads/ldm/         # Default download folder (configurable in Settings)
├── completed-file.mp4   # Finished downloads land here
├── another-file.zip
└── .temp/               # In-progress downloads (auto-created, auto-cleaned)
    ├── <download-id>/
    │   ├── video.mp4        # aria2 writes segments directly into this file
    │   └── video.mp4.aria2  # aria2 control file (deleted on completion)
    └── <download-id>/
        └── video.mp4        # yt-dlp merges streams here before moving
```

Files move from `.temp/<id>/` to the final folder automatically on completion.
Cancelled or failed downloads clean up their temp folder immediately.
You can change the download folder in **Settings** — the `.temp/` subfolder always lives inside whatever folder you set.

---

## Architecture Summary

| Component | Technology | Role |
|---|---|---|
| Backend | Node.js + Express | REST API, WebSocket, serves the UI |
| Database | SQLite (better-sqlite3) | Download history, settings, state |
| Download engine | aria2 (daemon) | Multi-segment HTTP/FTP downloads |
| Video extractor | yt-dlp (subprocess) | YouTube and 1000+ video sites |
| Web UI | React + Vite | Download manager interface |
| Browser extension | Manifest V3 (Chrome/Firefox) | Intercepts files, injects download buttons |

---

## FAQ

**Q: Does LDM work on any website?**
A: Yes. The extension detects downloads based on Content-Type headers and file extensions — not a list of allowed sites. Any site that serves a downloadable file will be detected.

**Q: Why is my download slow even with 16 segments?**
A: The server must support HTTP Range requests for segmented downloads to work. Most file hosts (direct downloads, CDNs) support it. Some servers disable it, in which case aria2 falls back to a single connection. Also check your speed limit setting isn't set too low.

**Q: Can I download YouTube videos?**
A: Yes, via yt-dlp. Paste the YouTube URL in the "New Download" dialog or click the ⬇ button on a YouTube video. LDM picks the best available quality and merges video+audio into an MP4.

**Q: Where is the download saved?**
A: To the folder set in Settings → Download folder. Default is `~/Downloads`.

**Q: Is the extension safe? Does it send my data anywhere?**
A: No. The extension only communicates with `localhost:6543` (your local LDM server). Nothing is sent to external servers.

**Q: How do I update LDM?**
A: `npm update -g ldm-dl`
