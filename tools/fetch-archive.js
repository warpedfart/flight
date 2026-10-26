"use strict";

// fills cache/ (and data/emoji/) with every game file in a list, straight
// from the official CDN, so the server can later run with AJ_OFFLINE=1 and
// no outside address at all. made for the VPS: the list is the archive kept
// on another machine (files.txt.gz, one path per line: "1830/imageArrays/
// <hash>" for a game file, "emoji/<name>.png" for an emoji), so the files
// themselves never have to be carried over.
//
//   node tools/fetch-archive.js files.txt.gz [--concurrency 128]
//
// run it as the user the server runs as, so the files are theirs. the server
// can keep running meanwhile. it can be stopped and started again: a file
// already kept is not fetched again. files are kept as lib/cdn.js keeps
// them (cachePath: a hashed name one folder down, under its first two
// characters). anything that could not be fetched is listed in
// cache/fetch-failures.tsv. players' own data (masterpieces/, ABSU/) is
// never on the list and could not be fetched with it: every game path
// starts with a build number.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");
const config = require("../config.js");

const args = process.argv.slice(2);
const LIST = args.find(arg => !arg.startsWith("--") && !/^\d+$/.test(arg));
const at = args.indexOf("--concurrency");
const CONCURRENCY = at >= 0 ? Number(args[at + 1]) : 128;
const RETRIES = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const GAME = /^\d+\/[A-Za-z0-9_.\-\/]{1,200}$/;
const EMOJI = /^emoji\/([0-9a-f]{2,6}(?:-[0-9a-f]{2,6}){0,9}\.png)$/;
const HASHED = /^[0-9a-f]{32}$/;

// the same as cachePath in lib/cdn.js
const cachePath = relPath => {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1];
  return HASHED.test(name) ? [...parts.slice(0, -1), name.slice(0, 2), name].join("/") : relPath;
};

// [url, file, check] for a line of the list, or null for one that is not a
// plain game or emoji path
const job = line => {
  const emoji = EMOJI.exec(line);
  if (emoji) {
    return [`${config.emojiUpstream}${emoji[1]}`, path.join(config.dataDir, "emoji", emoji[1]), body => body.subarray(0, 8).equals(PNG_SIGNATURE)];
  }
  if (GAME.test(line) && !line.split("/").some(part => part === "" || part === "." || part === "..")) {
    const url = new URL(line, config.upstreamContent);
    url.searchParams.set("v", config.upstreamBuildVersion);
    return [url, path.join(config.cacheDir, ...cachePath(line).split("/")), () => true];
  }
  return null;
};

const failures = [];
let done = 0, fetched = 0, kept = 0;
const started = Date.now();

const fetchOne = async (line, url, file, check) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0"}, signal: AbortSignal.timeout(60000)});
      if (res.status === 404 || res.status === 403) {
        failures.push([line, res.status]);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (!check(body)) {
        failures.push([line, "not the expected kind of file"]);
        return;
      }
      await fs.promises.mkdir(path.dirname(file), {recursive: true});
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, body);
      await fs.promises.rename(tmp, file);
      fetched++;
      return;
    }
    catch (err) {
      if (attempt >= RETRIES) {
        failures.push([line, err.message]);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt * attempt));
    }
  }
};

const handle = async line => {
  const target = job(line);
  if (!target) {
    failures.push([line, "not a game or emoji path"]);
  }
  else if ((await fs.promises.stat(target[1]).catch(() => null))?.size > 0) {
    kept++;
  }
  else {
    await fetchOne(line, ...target);
  }
  if (++done % 20000 === 0) {
    const perSecond = done / ((Date.now() - started) / 1000);
    console.log(`[fetch] ${done} done (fetched ${fetched}, already kept ${kept}, failed ${failures.length}), ${perSecond.toFixed(0)}/s`);
  }
};

const main = async () => {
  if (!LIST || !fs.existsSync(LIST)) {
    console.error("usage: node tools/fetch-archive.js files.txt.gz [--concurrency 128]");
    process.exit(1);
  }
  console.log(`[fetch] ${LIST} into ${config.cacheDir} and ${path.join(config.dataDir, "emoji")}, ${CONCURRENCY} at a time`);
  let input = fs.createReadStream(LIST);
  if (LIST.endsWith(".gz")) {
    input = input.pipe(zlib.createGunzip());
  }
  // the list is read as it goes, never held whole: a million lines is a lot
  // for a 1 GB machine
  const running = new Set();
  for await (const raw of readline.createInterface({input, crlfDelay: Infinity})) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const task = handle(line).finally(() => running.delete(task));
    running.add(task);
    if (running.size >= CONCURRENCY) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);
  fs.mkdirSync(config.cacheDir, {recursive: true});
  const report = path.join(config.cacheDir, "fetch-failures.tsv");
  fs.writeFileSync(report, failures.map(row => row.join("\t")).join("\n") + (failures.length ? "\n" : ""));
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[fetch] ${done} files in ${minutes} min: fetched ${fetched}, already kept ${kept}, failed ${failures.length}`);
  if (failures.length) {
    console.log(`[fetch] the failed ones are in ${report}; run this again to retry them`);
    process.exit(1);
  }
  console.log("[fetch] every file on the list is here");
};

main().catch(err => {
  console.error(`[fetch] ${err.stack}`);
  process.exit(1);
});
