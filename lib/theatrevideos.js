"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {logText} = require("./logtext.js");
const config = require("../config.js");

// video files kept on this server, for staff to play on the theatre's screen
// (the "xtv" handler in lib/world.js) in place of a YouTube link: they type
// the video's name in the game's theatre box. everyone in the room sees it
// from the same point, and whoever comes in later joins it where it is.
//
// the files are data/theatre-videos/<name>.mp4 (or .webm): uploaded in the
// admin panel, or copied there on the machine (as the user the server runs
// as). the file's name, without its extension, is the video's name. each has
// an id made from its name, size and time, so the address it is served at
// (/theatre/<id>) changes whenever the file does.

const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_NAME = 60;
const ID = /^[0-9a-f]{16}$/;
const TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm"};
const FOLDER = () => path.join(config.dataDir, "theatre-videos");
const LIST_FOR_MS = 2000;

// a name staff may give one: no "%" (the game's messages are cut at it),
// no path, nothing hidden.
const cleanName = text => String(text || "").replace(/[\u0000-\u001f\u007f%\/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();

// every video in the folder: [{id, name, file, type, bytes, addedAt}],
// read again at most every LIST_FOR_MS (a video being watched asks for
// its file piece by piece).
let listed = null;
let listedAt = 0;
const videos = () => {
  if (listed && Date.now() - listedAt < LIST_FOR_MS) {
    return listed;
  }
  const found = [];
  for (const entry of fs.existsSync(FOLDER()) ? fs.readdirSync(FOLDER(), {withFileTypes: true}) : []) {
    const type = TYPES[path.extname(entry.name).toLowerCase()];
    if (!entry.isFile() || !type || entry.name.startsWith("new-")) {
      continue;
    }
    const file = path.join(FOLDER(), entry.name);
    const stat = fs.statSync(file);
    const id = crypto.createHash("sha256").update(`${entry.name}\0${stat.size}\0${stat.mtimeMs}`).digest("hex").slice(0, 16);
    found.push({id, name: path.basename(entry.name, path.extname(entry.name)), file, type, bytes: stat.size, addedAt: stat.mtimeMs});
  }
  listed = found.sort((a, b) => b.addedAt - a.addedAt);
  listedAt = Date.now();
  return listed;
};
const forget = () => {
  listed = null;
};

const byId = id => ID.test(String(id)) ? videos().find(video => video.id === id) || null : null;

// how long an MP4 is, in ms: from its movie header ("mvhd", in "moov",
// which may be at the end of the file), or null.
const mp4Length = (fd, size) => {
  const head = Buffer.alloc(16);
  const walk = (from, to, inMovie) => {
    for (let at = from; at + 8 <= to;) {
      fs.readSync(fd, head, 0, 16, at);
      let length = head.readUInt32BE(0);
      let body = at + 8;
      if (length === 1) {
        length = Number(head.readBigUInt64BE(8));
        body = at + 16;
      }
      else if (length === 0) {
        length = to - at;
      }
      if (length < 8) {
        return null;
      }
      const type = head.toString("latin1", 4, 8);
      if (type === "moov") {
        return walk(body, Math.min(at + length, to), true);
      }
      if (inMovie && type === "mvhd") {
        const box = Buffer.alloc(32);
        fs.readSync(fd, box, 0, 32, body);
        const wide = box[0] === 1; // version 1: 64-bit times
        const scale = box.readUInt32BE(wide ? 20 : 12);
        const duration = wide ? Number(box.readBigUInt64BE(24)) : box.readUInt32BE(16);
        return scale ? Math.round(duration / scale * 1000) : null;
      }
      at += length;
    }
    return null;
  };
  return walk(0, size, false);
};

// how long a WebM is, in ms: from its Segment's Info (Duration, in
// TimecodeScale ns), which comes before the first Cluster; or null.
const WEBM = {segment: 0x18538067, info: 0x1549A966, scale: 0x2AD7B1, duration: 0x4489, cluster: 0x1F43B675};
const webmLength = (fd, size) => {
  const data = Buffer.alloc(Math.min(size, 1024 * 1024));
  fs.readSync(fd, data, 0, data.length, 0);
  // an EBML number: its first byte's leading zeroes say how many bytes it has
  const number = (at, keepMarker) => {
    if (at >= data.length || data[at] === 0) {
      return null;
    }
    const length = Math.clz32(data[at]) - 23;
    let value = keepMarker ? data[at] : data[at] & (0xFF >> length);
    for (let i = 1; i < length; i++) {
      value = value * 256 + (data[at + i] || 0);
    }
    return {value, length, unknown: !keepMarker && value === 2 ** (7 * length) - 1};
  };
  let scale = 1000000;
  let duration = null;
  let done = false;
  const walk = (from, to) => {
    for (let at = from; at < Math.min(to, data.length) && !done;) {
      const id = number(at, true);
      const length = id && number(at + id.length, false);
      if (!length) {
        done = true;
        return;
      }
      const body = at + id.length + length.length;
      const end = length.unknown ? to : body + length.value;
      if (id.value === WEBM.segment || id.value === WEBM.info) {
        walk(body, end);
        done = done || id.value === WEBM.info;
      }
      else if (id.value === WEBM.scale && body + length.value <= data.length) {
        scale = data.readUIntBE(body, Math.min(length.value, 6));
      }
      else if (id.value === WEBM.duration && body + length.value <= data.length && (length.value === 4 || length.value === 8)) {
        duration = length.value === 4 ? data.readFloatBE(body) : data.readDoubleBE(body);
      }
      else if (id.value === WEBM.cluster) {
        done = true;
      }
      at = end;
    }
  };
  walk(0, Infinity);
  return duration ? Math.round(duration * scale / 1e6) : null;
};

// a video's length in ms, or null when its file does not say; kept by id
const lengths = new Map();
const lengthOf = id => {
  const video = byId(id);
  if (!video) {
    return null;
  }
  if (!lengths.has(id)) {
    let length = null;
    try {
      const fd = fs.openSync(video.file, "r");
      try {
        length = video.type === "video/webm" ? webmLength(fd, video.bytes) : mp4Length(fd, video.bytes);
      }
      finally {
        fs.closeSync(fd);
      }
    }
    catch (err) {
      length = null;
    }
    lengths.set(id, Number.isFinite(length) && length > 0 ? length : null);
  }
  return lengths.get(id);
};

// the video staff mean by what they typed: its name, any case, with or
// without its extension.
const find = text => {
  const wanted = String(text || "").trim().toLowerCase();
  return wanted ? videos().find(video => video.name.toLowerCase() === wanted
    || path.basename(video.file).toLowerCase() === wanted) || null : null;
};

// for the admin panel: newest first
const list = () => videos().map(({id, name, bytes, addedAt}) => ({id, name, bytes, addedAt, lengthMs: lengthOf(id)}));

// the file's extension from its first bytes, or null for one no player plays
const kindOf = head => {
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp") {
    return ".mp4";
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1A45DFA3) {
    return ".webm";
  }
  return null;
};

// an upload, the request's body written straight to the folder (a video is
// too big to hold): {video} or {error}.
const add = (req, name, by) => new Promise(resolve => {
  const clean = cleanName(name);
  if (!clean) {
    resolve({error: "Give the video a name."});
    return;
  }
  if (find(clean)) {
    resolve({error: `There is already a video called "${clean}".`});
    return;
  }
  fs.mkdirSync(FOLDER(), {recursive: true, mode: 0o700});
  const waiting = path.join(FOLDER(), `new-${crypto.randomBytes(6).toString("hex")}`);
  const out = fs.createWriteStream(waiting, {mode: 0o600});
  let size = 0;
  let head = Buffer.alloc(0);
  let failed = null;
  const fail = error => {
    if (!failed) {
      failed = error;
      req.unpipe(out);
      req.resume();
      out.destroy();
      fs.rm(waiting, {force: true}, () => resolve({error}));
    }
  };
  req.on("data", chunk => {
    size += chunk.length;
    if (head.length < 12) {
      head = Buffer.concat([head, chunk]).subarray(0, 12);
    }
    if (size > MAX_BYTES) {
      fail(`That file is too big: ${MAX_BYTES / 1024 / 1024 / 1024} GB at most.`);
    }
  });
  req.on("error", () => fail("The upload was cut short."));
  out.on("error", () => fail("The server could not save it."));
  out.on("finish", () => {
    if (failed) {
      return;
    }
    const ext = kindOf(head);
    if (!ext) {
      fail("That is not a video the game can play: an MP4 (H.264) or a WebM.");
      return;
    }
    const file = path.join(FOLDER(), `${clean}${ext}`);
    if (fs.existsSync(file)) {
      fail(`There is already a video called "${clean}".`);
      return;
    }
    fs.renameSync(waiting, file);
    forget();
    console.log(`[theatre videos] ${logText(by)} uploaded "${logText(clean)}" (${logText(size)} bytes)`);
    resolve({video: find(clean)});
  });
  req.pipe(out);
});

// another name for one: {video, before} or {error}.
const rename = (id, name) => {
  const video = byId(id);
  const clean = cleanName(name);
  if (!video) {
    return {error: "No such video."};
  }
  if (!clean) {
    return {error: "Give the video a name."};
  }
  const other = find(clean);
  if (other && other.id !== video.id) {
    return {error: `There is already a video called "${clean}".`};
  }
  fs.renameSync(video.file, path.join(FOLDER(), `${clean}${path.extname(video.file)}`));
  forget();
  console.log(`[theatre videos] "${logText(video.name)}" renamed to "${logText(clean)}"`);
  return {video: find(clean), before: video.name};
};

// one deleted: the video it was, or null.
const remove = id => {
  const video = byId(id);
  if (!video) {
    return null;
  }
  fs.rmSync(video.file, {force: true});
  forget();
  console.log(`[theatre videos] "${logText(video.name)}" deleted`);
  return video;
};

// a video's file, or the part of it a Range header asks for: a player
// that seeks asks for the part from there on.
const serve = (req, res, id) => {
  const video = byId(id);
  if (!video) {
    res.writeHead(404, {"Content-Type": "text/plain", "Content-Length": 9});
    res.end("Not found");
    return;
  }
  const headers = {"Content-Type": video.type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
    // its address changes with the file, so it may be kept
    "Cache-Control": "public, max-age=86400"};
  let start = 0;
  let end = video.bytes - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
    }
    else {
      start = Math.max(0, video.bytes - Number(range[2]));
    }
    if (start > end || start >= video.bytes) {
      res.writeHead(416, {"Content-Range": `bytes */${video.bytes}`, "Content-Length": 0});
      res.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${video.bytes}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || video.bytes === 0) {
    res.end();
    return;
  }
  const input = fs.createReadStream(video.file, {start, end});
  input.on("error", () => res.destroy());
  res.on("close", () => input.destroy());
  input.pipe(res);
};

// at start: uploads cut short go.
const load = () => {
  let gone = 0;
  for (const name of fs.existsSync(FOLDER()) ? fs.readdirSync(FOLDER()) : []) {
    if (name.startsWith("new-")) {
      fs.rmSync(path.join(FOLDER(), name), {force: true});
      gone++;
    }
  }
  console.log(`[theatre videos] ${logText(videos().length)} videos${gone ? `, ${logText(gone)} unfinished uploads removed` : ""}`);
};

module.exports = {MAX_BYTES, ID, list, find, byId, lengthOf, add, rename, remove, serve, load};
