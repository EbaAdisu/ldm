import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'

const DATA_DIR = join(homedir(), '.ldm')
mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(join(DATA_DIR, 'ldm.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    title       TEXT,
    filename    TEXT,
    filepath    TEXT,
    size        INTEGER DEFAULT 0,
    downloaded  INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'pending',
    engine      TEXT DEFAULT 'aria2',
    aria2_gid   TEXT,
    error       TEXT,
    thumbnail   TEXT,
    category    TEXT DEFAULT 'General',
    created_at  INTEGER DEFAULT (strftime('%s','now')),
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// Ensure the default download dir exists
const DEFAULT_DOWNLOAD_DIR = join(homedir(), 'Downloads', 'ldm')
mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true })

// Insert defaults without overwriting user values
const defaults = {
  downloadDir:         DEFAULT_DOWNLOAD_DIR,
  segments:            '16',   // aria2 --split
  connectionsPerServer:'4',    // aria2 --max-connection-per-server
  maxConcurrent:       '3',    // aria2 --max-concurrent-downloads
  speedLimit:          '0',    // KB/s, 0 = unlimited
  minInterceptSize:    '1048576', // bytes — ignore files smaller than this (1 MB)
  interceptTypes:      'mp4,mkv,webm,avi,mov,flv,wmv,ts,mp3,wav,ogg,aac,flac,m4a,zip,rar,7z,iso,pdf,exe,deb,rpm',
  theme:               'dark',
}
for (const [key, value] of Object.entries(defaults)) {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
}

export default db
