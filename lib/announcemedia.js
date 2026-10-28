"use strict";

const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const path = require("path");
const {logText} = require("./logtext.js");
const config = require("../config.js");

// pictures and GIFs shown with an announcement (the admin panel's
// Announcement box, lib/panel.js). the admin gives a link; the server fetches
// it once and keeps a copy, served from here (/announce-media/<id>.<ext>),
// so every player's game loads it from this server, not from the site it
// came from (which then sees no player's address, and may take it down).
//
// a link to a picture (PNG, JPEG, GIF, WebP) or a short video (MP4, WebM:
// what GIF sites send "GIFs" as now, shown looping and silent) is taken as
// it is. a link to a page (a Tenor, Giphy or Imgur page, say) is followed to
// the picture the page names for previews (its "og:video" or "og:image").
// what a file is goes by its first bytes, never by its name or its type.
//
// the files are data/announce-media/<id>.<ext>, the id from what is in
// them; the newest KEEP stay.

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 4;
const MAX_PAGES = 3; // pages followed on from one to the next
const TIMEOUT_MS = 20000;
const KEEP = 200;
const FOLDER = () => path.join(config.dataDir, "announce-media");
const TYPES = {png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm"};
const PATH = /^\/announce-media\/([0-9a-f]{16}\.(?:png|jpg|gif|webp|mp4|webm))$/;
// the tags a page names its preview in, the best first: a video before a
// picture, as a GIF site's video is its GIF, moving.
const PREVIEW_TAGS = ["og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream", "og:image:secure_url", "og:image:url", "og:image", "twitter:image"];

// what the first bytes say a file is: its extension here, or null
const kindOf = bytes => {
  const at = (offset, text) => bytes.length >= offset + text.length && bytes.toString("latin1", offset, offset + text.length) === text;
  if (at(0, "\x89PNG")) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (at(0, "GIF87a") || at(0, "GIF89a")) {
    return "gif";
  }
  if (at(0, "RIFF") && at(8, "WEBP")) {
    return "webp";
  }
  if (at(4, "ftyp")) {
    return "mp4";
  }
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) {
    return "webm";
  }
  return null;
};

// no address on this machine or its network: the server fetches what the
// link says, so a link must not reach what only the server can.
const privateAddress = address => {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) {
    return privateAddress(mapped[1]);
  }
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
};

// the link as a URL this server may fetch, or {error}
const checkLink = async text => {
  let url;
  try {
    url = new URL(String(text).trim());
  }
  catch {
    return {error: "That is not a link. Paste the whole address, starting with https://"};
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    return {error: "Only http:// and https:// links can be used."};
  }
  let addresses;
  try {
    addresses = await dns.promises.lookup(url.hostname.replace(/^\[|\]$/g, ""), {all: true});
  }
  catch {
    return {error: `${url.hostname} could not be found.`};
  }
  if (addresses.some(entry => privateAddress(entry.address))) {
    return {error: "That link is to a private address, which cannot be used."};
  }
  return {url};
};

// fetches `text` (following redirects, each checked as the first link was)
// and reads at most `limit` bytes: {bytes, type, url} or {error}
const download = async (text, limit) => {
  let link = text;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkLink(link);
    if (checked.error) {
      return checked;
    }
    let response;
    try {
      response = await fetch(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {"User-Agent": "Mozilla/5.0 (compatible; announcement picture fetcher)", "Accept": "image/*, video/mp4, video/webm, text/html;q=0.5, */*;q=0.1"},
      });
    }
    catch (err) {
      return {error: err.name === "TimeoutError" ? "The site took too long to answer." : "The site could not be reached."};
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      link = new URL(response.headers.get("location"), checked.url).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return {error: `The site answered ${response.status}: the picture is not there, or not public.`};
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel();
      return {error: `That is bigger than ${Math.round(MAX_BYTES / 1048576)} MB.`};
    }
    const parts = [];
    let size = 0;
    try {
      for await (const part of response.body) {
        size += part.length;
        if (size > limit) {
          return {error: `That is bigger than ${Math.round(MAX_BYTES / 1048576)} MB.`};
        }
        parts.push(part);
      }
    }
    catch {
      return {error: "The download was cut off. Try again."};
    }
    return {bytes: Buffer.concat(parts.map(part => Buffer.from(part))), type: String(response.headers.get("content-type") || ""), url: checked.url};
  }
  return {error: "That link sends you on too many times."};
};

// the preview a web page names (PREVIEW_TAGS), or where it sends you on to,
// as a whole link; or null
const previewOf = (html, base) => {
  const found = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (name && content && !found[name[1].toLowerCase()]) {
      found[name[1].toLowerCase()] = content[1].replace(/&amp;/g, "&");
    }
  }
  // else a page that sends you on at once (<meta http-equiv="refresh">)
  const refresh = /<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/i.exec(html);
  const onTo = refresh && /\bcontent\s*=\s*["']\s*\d+\s*;\s*url\s*=\s*([^"']+)["']/i.exec(refresh[0]);
  for (const link of [...PREVIEW_TAGS.map(tag => found[tag]), onTo && onTo[1].trim()]) {
    if (link) {
      try {
        return new URL(link, base).href;
      }
      catch {
        // not a link: the next
      }
    }
  }
  return null;
};

// the newest KEEP stay
const prune = () => {
  const files = fs.readdirSync(FOLDER())
    .filter(name => PATH.test(`/announce-media/${name}`))
    .map(name => ({name, at: fs.statSync(path.join(FOLDER(), name)).mtimeMs}))
    .sort((a, b) => b.at - a.at);
  for (const old of files.slice(KEEP)) {
    fs.rmSync(path.join(FOLDER(), old.name), {force: true});
  }
};

// a link the admin gave: {path} (where the game loads it from) or {error}
const fetchLink = async text => {
  if (!String(text || "").trim()) {
    return {error: "There is no link."};
  }
  let got = await download(text, MAX_BYTES);
  if (got.error) {
    return got;
  }
  let kind = kindOf(got.bytes);
  // a page: on to the picture it names, or to where it sends you on to
  for (let page = 0; page < MAX_PAGES && !kind && (/html/i.test(got.type) || /^\s*</.test(got.bytes.toString("latin1", 0, 200))); page++) {
    const preview = previewOf(got.bytes.toString("utf8", 0, MAX_PAGE_BYTES), got.url);
    if (!preview) {
      return {error: "That is a web page with no picture in it. Use the picture's own link (right-click it, Copy image address)."};
    }
    got = await download(preview, MAX_BYTES);
    if (got.error) {
      return got;
    }
    kind = kindOf(got.bytes);
  }
  if (!kind) {
    return {error: "That is not a picture: PNG, JPEG, GIF, WebP, MP4 or WebM."};
  }
  const name = `${crypto.createHash("sha256").update(got.bytes).digest("hex").slice(0, 16)}.${kind}`;
  fs.mkdirSync(FOLDER(), {recursive: true});
  const file = path.join(FOLDER(), name);
  if (fs.existsSync(file)) {
    // the same again: newest now, so it is kept
    const now = new Date();
    fs.utimesSync(file, now, now);
  }
  else {
    const waiting = path.join(FOLDER(), `new-${crypto.randomBytes(6).toString("hex")}`);
    fs.writeFileSync(waiting, got.bytes);
    fs.renameSync(waiting, file);
    prune();
  }
  console.log(`[announce] picture ${logText(name)}, ${logText(got.bytes.length)} bytes`);
  return {path: `/announce-media/${name}`};
};

// GET /announce-media/<id>.<ext>; false when the address is not one of these
const serve = (req, res, pathname) => {
  const match = PATH.exec(pathname);
  if (!match) {
    return false;
  }
  const file = path.join(FOLDER(), match[1]);
  let stat;
  try {
    stat = fs.statSync(file);
  }
  catch {
    res.writeHead(404, {"Content-Type": "text/plain", "Content-Length": 9});
    res.end("Not found");
    return true;
  }
  const headers = {"Content-Type": TYPES[path.extname(file).slice(1)], "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // its name is made from what is in it: it never changes
    "Cache-Control": "public, max-age=31536000, immutable"};
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  // a video is asked for in pieces
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
    }
    else {
      start = Math.max(0, stat.size - Number(range[2]));
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, {"Content-Range": `bytes */${stat.size}`, "Content-Length": 0});
      res.end();
      return true;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || stat.size === 0) {
    res.end();
    return true;
  }
  const input = fs.createReadStream(file, {start, end});
  input.on("error", () => res.destroy());
  res.on("close", () => input.destroy());
  input.pipe(res);
  return true;
};

module.exports = {fetchLink, serve, kindOf, previewOf, privateAddress};
