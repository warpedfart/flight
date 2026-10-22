#!/usr/bin/env node
'use strict';
/*
 * mirror-ajcontent.js - resumable mirror of the public bucket listing at
 * https://ajcontent.akamaized.net/  (zero dependencies, Node 18+)
 *
 * Usage:
 *   node mirror-ajcontent.js --list-builds
 *   node mirror-ajcontent.js --prefix 1636/ --dry-run
 *   node mirror-ajcontent.js --prefix 1636/ --out ./cache
 *   node mirror-ajcontent.js --out ./cache            (everything: could be huge)
 *
 * Options:
 *   --prefix P        only keys starting with P (e.g. a build number "1636/")
 *   --out DIR         output directory (default ./ajcontent-mirror)
 *   --concurrency N   parallel downloads (default 4)
 *   --delay MS        pause after each download per worker (default 100)
 *   --dry-run         list + total size only, download nothing
 *   --list-builds     show top-level folders (build numbers) and exit
 *   --marker KEY      start listing after KEY (resume a long run)
 *   --no-verify       skip MD5 check against the listing's ETag
 *
 * Re-running is safe: files that already exist with the right size are skipped.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const BASE = 'https://ajcontent.akamaized.net/';
const UA = 'burrow-mirror/1.0';

// ---- args -------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PREFIX = opt('--prefix', '');
const OUT = path.resolve(opt('--out', './ajcontent-mirror'));
const CONCURRENCY = Math.max(1, parseInt(opt('--concurrency', '4'), 10));
const DELAY = parseInt(opt('--delay', '100'), 10);
const MARKER = opt('--marker', '');
const DRY = flag('--dry-run');
const VERIFY = !flag('--no-verify');

// ---- helpers ----------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

async function withRetry(fn, label, tries = 2) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries) throw e;
      const wait = 500 * 2 ** i;
      console.error(`retry ${i}/${tries - 1} ${label}: ${e.message} (wait ${wait}ms)`);
      await sleep(wait);
    }
  }
}

async function getText(url) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, String(url));
}

// ---- listing ----------------------------------------------------------
// One listing page. Retries add a throwaway query param so that an error cached
// at the CDN edge for the exact same URL doesn't keep getting served back.
async function fetchListPage(prefix, marker) {
  let lastErr;
  const MAX_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const u = new URL(BASE);
    if (prefix) u.searchParams.set('prefix', prefix);
    if (marker) u.searchParams.set('marker', marker);
    if (attempt > 0) u.searchParams.set('cb', `${Date.now()}${attempt}`);
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.error(`list attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (marker=${marker || 'start'}): ${e.message}`);
      if (attempt < MAX_ATTEMPTS - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

async function* listKeys(prefix, startMarker = '') {
  let marker = startMarker;
  let skips = 0;
  for (;;) {
    let xml;
    try {
      xml = await fetchListPage(prefix, marker);
    } catch (e) {
      // Last resort: nudge the marker forward one character and carry on.
      // Keys here are fixed-length hex hashes, so this skips at most a key
      // that sorts between the two markers (normally none).
      if (!marker || skips >= 20) {
        console.error(`Listing failed at marker "${marker}". Resume later with: --marker "${marker}"`);
        throw e;
      }
      const bumped = marker.slice(0, -1) + String.fromCharCode(marker.charCodeAt(marker.length - 1) + 1);
      console.error(`WARNING: listing failed at "${marker}", skipping ahead to "${bumped}"`);
      marker = bumped;
      skips++;
      continue;
    }
    let last = '';
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = tag(m[1], 'Key');
      last = key;
      if (key.endsWith('/')) continue; // folder placeholder objects
      yield { key, size: Number(tag(m[1], 'Size')), etag: tag(m[1], 'ETag').replace(/"/g, '') };
    }
    if (tag(xml, 'IsTruncated') !== 'true') return;
    marker = tag(xml, 'NextMarker') || last;
    if (!marker) return;
  }
}

async function listBuilds() {
  const u = new URL(BASE);
  u.searchParams.set('delimiter', '/');
  let marker = '';
  const out = [];
  for (;;) {
    if (marker) u.searchParams.set('marker', marker);
    const xml = await getText(u);
    for (const m of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) out.push(tag(m[1], 'Prefix'));
    if (tag(xml, 'IsTruncated') !== 'true') break;
    marker = tag(xml, 'NextMarker');
    if (!marker) break;
  }
  return out;
}

// ---- download ---------------------------------------------------------
function safeDest(key) {
  if (key.startsWith('/') || key.split('/').includes('..')) throw new Error('unsafe key');
  const dest = path.join(OUT, ...key.split('/'));
  if (!dest.startsWith(OUT + path.sep)) throw new Error('unsafe key');
  return dest;
}

async function downloadOne(item) {
  const dest = safeDest(item.key);
  try {
    if (fs.statSync(dest).size === item.size) return 'skipped';
  } catch { /* not there yet */ }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = BASE + item.key.split('/').map(encodeURIComponent).join('/');
  const tmp = `${dest}.${process.pid}.tmp`;
  const checkMd5 = VERIFY && /^[0-9a-f]{32}$/.test(item.etag);

  await withRetry(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hash = crypto.createHash('md5');
    let bytes = 0;
    const tap = new Transform({
      transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(tmp));
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    if (bytes !== item.size) { fs.rmSync(tmp, { force: true }); throw new Error(`size ${bytes} != ${item.size}`); }
    if (checkMd5 && hash.digest('hex') !== item.etag) { fs.rmSync(tmp, { force: true }); throw new Error('md5 mismatch'); }
    fs.renameSync(tmp, dest);
  }, item.key);
  return 'downloaded';
}

// ---- main -------------------------------------------------------------
(async () => {
  if (flag('--list-builds')) {
    for (const p of await listBuilds()) console.log(p);
    return;
  }

  const stats = { downloaded: 0, skipped: 0, failed: 0, bytes: 0, seen: 0 };
  const failed = [];
  const it = listKeys(PREFIX, MARKER);
  const started = Date.now();

  const report = () => {
    const mb = (stats.bytes / 1048576).toFixed(1);
    const secs = Math.max(1, (Date.now() - started) / 1000);
    console.log(`[${secs.toFixed(0)}s] seen ${stats.seen} | new ${stats.downloaded} | skipped ${stats.skipped} | failed ${stats.failed} | ${mb} MB (${(stats.bytes / 1048576 / secs).toFixed(1)} MB/s)`);
  };

  if (DRY) {
    let total = 0, n = 0;
    for await (const item of it) {
      n++; total += item.size;
      if (n % 5000 === 0) console.log(`${n} keys, ${(total / 1073741824).toFixed(2)} GB so far...`);
    }
    console.log(`DRY RUN: ${n} objects, ${(total / 1073741824).toFixed(2)} GB under prefix "${PREFIX}"`);
    return;
  }

  console.log(`Mirroring "${PREFIX}" -> ${OUT} (concurrency ${CONCURRENCY})`);
  const worker = async () => {
    for (;;) {
      const { value: item, done } = await it.next();
      if (done) return;
      stats.seen++;
      try {
        const r = await downloadOne(item);
        stats[r]++;
        if (r === 'downloaded') stats.bytes += item.size;
      } catch (e) {
        stats.failed++;
        failed.push(item.key);
        console.error(`FAIL ${item.key}: ${e.message}`);
      }
      if (DELAY) await sleep(DELAY);
    }
  };
  const ticker = setInterval(report, 5000);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(ticker);

  report();
  if (failed.length) {
    fs.writeFileSync(path.join(OUT, 'failed-keys.txt'), failed.join('\n') + '\n');
    console.log(`Wrote ${failed.length} failed keys to failed-keys.txt (just re-run to retry them).`);
  }
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
