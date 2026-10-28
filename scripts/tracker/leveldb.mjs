/**
 * ats-fill — scripts/tracker/leveldb.mjs
 * Read ats-fill's chrome.storage.local straight from disk, no Chrome needed.
 *
 * Chrome keeps each extension's storage.local in a LevelDB directory:
 *   <User Data>/<Profile>/Local Extension Settings/<extension id>/
 * Keys are the storage keys ("applications") and values are JSON text.
 * This is a small, dependency-free, read-only LevelDB reader: it copies the
 * directory first (Chrome holds a lock on the live one) and merges the sorted
 * tables (.ldb) with the write-ahead log (.log), newest sequence number wins.
 */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

export const STORE_EXTENSION_ID = 'amofaeopfmaicbiijgjaojenedkkadmn';

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [result, pos];
    shift += 7;
  }
}

/** Snappy block decompression (the only codec LevelDB tables use). */
export function snappyUncompress(src) {
  let [length, pos] = readVarint(src, 0);
  const out = Buffer.alloc(length);
  let op = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = src.readUIntLE(pos, bytes);
        pos += bytes;
      }
      len += 1;
      src.copy(out, op, pos, pos + len);
      pos += len;
      op += len;
      continue;
    }
    let len;
    let offset;
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | src[pos++];
    } else if (kind === 2) {
      len = (tag >> 2) + 1;
      offset = src.readUInt16LE(pos);
      pos += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = src.readUInt32LE(pos);
      pos += 4;
    }
    // Copies may overlap their own output (run-length style), so go byte by byte.
    for (let i = 0; i < len; i += 1) out[op + i] = out[op - offset + i];
    op += len;
  }
  return out;
}

function readBlock(file, offset, size) {
  const raw = file.subarray(offset, offset + size);
  const type = file[offset + size];
  if (type === 0) return raw;
  if (type === 1) return snappyUncompress(raw);
  throw new Error(`Unsupported LevelDB block compression ${type}`);
}

function* blockEntries(block) {
  const numRestarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - numRestarts * 4;
  let pos = 0;
  let key = Buffer.alloc(0);
  while (pos < end) {
    let shared; let nonShared; let valueLen;
    [shared, pos] = readVarint(block, pos);
    [nonShared, pos] = readVarint(block, pos);
    [valueLen, pos] = readVarint(block, pos);
    key = Buffer.concat([key.subarray(0, shared), block.subarray(pos, pos + nonShared)]);
    pos += nonShared;
    yield [key, block.subarray(pos, pos + valueLen)];
    pos += valueLen;
  }
}

function splitInternalKey(ikey) {
  const trailer = ikey.readBigUInt64LE(ikey.length - 8);
  return { userKey: ikey.subarray(0, ikey.length - 8).toString('utf8'), seq: trailer >> 8n, type: Number(trailer & 0xffn) };
}

/** Yield {userKey, seq, type, value} from one .ldb / .sst table. */
export function* readTable(file) {
  const footer = file.subarray(file.length - 48);
  let pos = 0;
  [, pos] = readVarint(footer, pos); // metaindex offset
  [, pos] = readVarint(footer, pos); // metaindex size
  let indexOffset; let indexSize;
  [indexOffset, pos] = readVarint(footer, pos);
  [indexSize] = readVarint(footer, pos);
  for (const [, handle] of blockEntries(readBlock(file, indexOffset, indexSize))) {
    const [offset, p] = readVarint(handle, 0);
    const [size] = readVarint(handle, p);
    for (const [ikey, value] of blockEntries(readBlock(file, offset, size))) {
      yield { ...splitInternalKey(ikey), value };
    }
  }
}

/** Yield {userKey, seq, type, value} from a write-ahead .log file. */
export function* readLog(file) {
  const BLOCK = 32768;
  let pos = 0;
  let pending = [];
  while (pos + 7 <= file.length) {
    const left = BLOCK - (pos % BLOCK);
    if (left < 7) { pos += left; continue; }
    const len = file.readUInt16LE(pos + 4);
    const type = file[pos + 6];
    if (type === 0 && len === 0) { pos += left; continue; } // zero padding / preallocated tail
    const data = file.subarray(pos + 7, pos + 7 + len);
    pos += 7 + len;
    if (type === 1) pending = [data];
    else if (type === 2) { pending = [data]; continue; } else if (type === 3) { pending.push(data); continue; } else if (type === 4) pending.push(data);
    else break;

    const batch = Buffer.concat(pending);
    pending = [];
    if (batch.length < 12) continue;
    let seq = batch.readBigUInt64LE(0);
    const count = batch.readUInt32LE(8);
    let p = 12;
    for (let i = 0; i < count && p < batch.length; i += 1) {
      const tag = batch[p++];
      let keyLen; let valueLen = 0;
      [keyLen, p] = readVarint(batch, p);
      const userKey = batch.subarray(p, p + keyLen).toString('utf8');
      p += keyLen;
      let value = null;
      if (tag === 1) {
        [valueLen, p] = readVarint(batch, p);
        value = batch.subarray(p, p + valueLen);
        p += valueLen;
      }
      yield { userKey, seq, type: tag, value };
      seq += 1n;
    }
  }
}

/** Merge every table and log in a LevelDB directory into a plain key → Buffer map. */
export function readLevelDb(dir) {
  const latest = new Map();
  const consider = (entry) => {
    const prev = latest.get(entry.userKey);
    if (!prev || entry.seq > prev.seq) latest.set(entry.userKey, entry);
  };
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (/\.(ldb|sst)$/.test(name)) for (const e of readTable(readFileSync(path))) consider(e);
    else if (/\.log$/.test(name)) for (const e of readLog(readFileSync(path))) consider(e);
  }
  const out = new Map();
  for (const [key, entry] of latest) if (entry.type === 1) out.set(key, entry.value);
  return out;
}

function chromeUserDataDirs(env) {
  if (env.CHROME_USER_DATA_DIR) return [env.CHROME_USER_DATA_DIR];
  const home = homedir();
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return ['Google/Chrome', 'Google/Chrome Beta', 'Chromium'].map((p) => join(local, p, 'User Data'));
  }
  if (process.platform === 'darwin') {
    return ['Google/Chrome', 'Google/Chrome Beta', 'Chromium'].map((p) => join(home, 'Library', 'Application Support', p));
  }
  return ['google-chrome', 'google-chrome-beta', 'chromium'].map((p) => join(home, '.config', p));
}

/**
 * Locate ats-fill's storage directory. With several profiles holding it, the
 * most recently written one wins unless ATS_FILL_STORAGE_DIR / ATS_FILL_PROFILE say otherwise.
 */
export function findStorageDir(env = process.env) {
  if (env.ATS_FILL_STORAGE_DIR) return env.ATS_FILL_STORAGE_DIR;
  const id = env.ATS_FILL_EXTENSION_ID || STORE_EXTENSION_ID;
  const found = [];
  for (const root of chromeUserDataDirs(env)) {
    if (!existsSync(root)) continue;
    for (const profile of readdirSync(root)) {
      if (env.ATS_FILL_PROFILE && profile !== env.ATS_FILL_PROFILE) continue;
      const dir = join(root, profile, 'Local Extension Settings', id);
      if (existsSync(dir)) found.push({ dir, mtime: Math.max(...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs)) });
    }
  }
  if (!found.length) {
    throw new Error(`No ats-fill storage found for extension ${id}. Set ATS_FILL_EXTENSION_ID (unpacked build), ATS_FILL_PROFILE, or ATS_FILL_STORAGE_DIR.`);
  }
  return found.sort((a, b) => b.mtime - a.mtime)[0].dir;
}

/** Snapshot the live directory (Chrome may hold it open) and read it. */
export function readExtensionStorage(env = process.env) {
  const dir = findStorageDir(env);
  const snap = mkdtempSync(join(tmpdir(), 'ats-fill-ldb-'));
  try {
    for (const name of readdirSync(dir)) {
      if (name === 'lost') continue;
      if (name === 'LOCK') continue;
      copyFileSync(join(dir, name), join(snap, name));
    }
    const raw = readLevelDb(snap);
    const parsed = {};
    for (const [key, value] of raw) {
      try { parsed[key] = JSON.parse(value.toString('utf8')); } catch { parsed[key] = value.toString('utf8'); }
    }
    return { dir, data: parsed };
  } finally {
    rmSync(snap, { recursive: true, force: true });
  }
}
