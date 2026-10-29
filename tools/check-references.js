"use strict";

// looks for connections that lead nowhere, in the code and in the game's
// data, and prints what it found as Markdown (docs/broken-references.md
// says what each one should point at, and is kept by hand from this).
//
//   node tools/check-references.js [--files] [--list <file list>] [--out report.md]
//
// in the code:
//   - files of the repository a comment, a page or a script names, that are
//     not there (a path under lib/, tools/ and so on, or a NAME.md)
//   - classes in swf-src/ that tools/build-client.sh does not compile, and
//     ones it names that are not there
//   - calls the web pages make to the server that no route answers
//   - files config.js points the server at that are not there
//   - the theme list's room files (config.themes) the cache does not have
//
// in the game's data (lib/gamefiles.js):
//   - defs that name something no def pack has: a party's room, a shop's
//     item, a diamond row's pet
//   - with --files, files the defs name that the cache does not have. on a
//     machine whose cache is not the whole archive most are "missing", so
//     give --list, a list of the files the CDN has, or a folder of such
//     lists: unhashed.tsv ("media/<hash>\t1233" per line), fetch-archive's
//     files.txt(.gz) ("1830/media/<hash>" per line), or lists of addresses.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const config = require("../config.js");
const cdn = require("../lib/cdn.js");
const defpacks = require("../lib/defpacks.js");
const gamefiles = require("../lib/gamefiles.js");

const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const WITH_FILES = args.includes("--files") || Boolean(option("--list"));
const LIST = option("--list");
const OUT = option("--out");
const SHOWN = 40; // of a long list, how many lines to print

const lines = [];
const say = (text = "") => lines.push(text);

// the repository's own text files, not the decompiled client or the cache
const SKIP = new Set(["node_modules", "cache", "data", "decompiled", "ffdec", ".git", "client-updates"]);
const walk = (folder, found = []) => {
  for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    }
    else if (/\.(js|as|md|html|sh|py|ps1|json)$/.test(entry.name)) {
      found.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  }
  return found;
};

const section = (title, problems, explain) => {
  say(`## ${title}`);
  say();
  if (explain) {
    say(explain);
    say();
  }
  if (!problems.length) {
    say("Nothing found.");
  }
  for (const problem of problems.slice(0, SHOWN)) {
    say(`- ${problem}`);
  }
  if (problems.length > SHOWN) {
    say(`- ...and ${problems.length - SHOWN} more`);
  }
  say();
};

const codeChecks = () => {
  const files = walk(ROOT);
  const texts = new Map(files.map(file => [file, fs.readFileSync(file, "utf8")]));

  // repository files named that are not there
  const named = new Map(); // name -> the places it is named
  const nameAt = (name, place) => named.set(name, [...(named.get(name) || []), place]);
  const mdNames = new Set(files.filter(file => file.endsWith(".md")).map(file => path.basename(file)));
  for (const [file, text] of texts) {
    // the docs that report these name them on purpose, and the pages
    // tools/make-docs.js writes repeat the code's own comments
    if (["tools/check-references.js", "docs/broken-references.md", "docs/server.md", "docs/client.md", "docs/web.md", "docs/tools.md"].includes(file)) {
      continue;
    }
    text.split(/\r?\n/).forEach((line, n) => {
      for (const match of line.matchAll(/\b((?:lib|tools|public|swf-src|docs|deploy|test|swf)\/[A-Za-z0-9_./-]+\.[a-z]{1,5})\b/g)) {
        if (!fs.existsSync(match[1])) {
          nameAt(match[1], `${file}:${n + 1}`);
        }
      }
      for (const match of line.matchAll(/(?<![\w-])([A-Z][A-Z_-]{2,}\.md)\b/g)) {
        if (!mdNames.has(match[1])) {
          nameAt(match[1], `${file}:${n + 1}`);
        }
      }
    });
  }
  section("Files named that are not in the repository",
    [...named].map(([name, places]) => `\`${name}\`, named in ${places.map(place => `\`${place}\``).join(", ")}`),
    "A comment, a page or a script names a file that is not here. Some belong to another repository (the launcher's own `tools/make-update.js` and `BUILDING.md`); the rest were never added, or were moved.");

  // swf-src and the build list
  const build = texts.get("tools/build-client.sh") || "";
  const listed = new Map([...build.matchAll(/^\s+([\w.]+)\s+(\S+\.(?:as|pcode))\s*\\?$/gm)].map(match => [match[2], match[1]]));
  const sources = fs.readdirSync("swf-src").filter(file => /\.(as|pcode)$/.test(file));
  const swf = [];
  for (const file of sources) {
    if (!listed.has(file) && !build.includes(file)) {
      swf.push(`\`swf-src/${file}\` is not compiled: tools/build-client.sh does not name it`);
    }
  }
  for (const [file, cls] of listed) {
    if (!fs.existsSync(path.join("swf-src", file))) {
      swf.push(`tools/build-client.sh compiles \`${cls}\` from \`${file}\`, which is not there`);
    }
  }
  section("Client classes and the build", swf);

  // what the pages ask of the server, and the routes there are
  const server = files.filter(file => file.startsWith("lib/") && file.endsWith(".js")).map(file => texts.get(file)).join("\n");
  const pages = {"public/admin.html": "/admin/api/", "public/mod.html": "/mod/api/", "public/account.html": "/account/api/"};
  const calls = [];
  for (const [page, prefix] of Object.entries(pages)) {
    const called = new Set([...(texts.get(page) || "").matchAll(/\bapi\(\s*["'`]([a-z0-9/_-]+)/gi)].map(match => match[1].replace(/\/$/, "")));
    for (const call of [...called].sort()) {
      // the dashboards' item pages share routes (modpanel.itemRoutes: "GET items/find")
      if (!server.includes(prefix + call) && !new RegExp(`"(GET|POST|DELETE) ${call}"`).test(server)) {
        calls.push(`\`${page}\` calls \`${prefix}${call}\`, which no route answers`);
      }
    }
  }
  section("Pages calling the server", calls);

  // what config.js points at
  const paths = [];
  for (const [key, about] of [
    ["clientSwf", "the game client"], ["sharedFontsSwf", "the shared fonts"], ["hudAssetsSwf", "the HUD artwork"],
    ["publicDir", "the web pages"], ["clientUpdatesDir", "updates for installed launchers (/client/)"], ["downloadsDir", "the launcher installers (/download)"],
  ]) {
    if (config[key] && !fs.existsSync(config[key])) {
      paths.push(`\`config.${key}\` (${about}) is \`${path.relative(ROOT, config[key]).split(path.sep).join("/")}\`, which is not there`);
    }
  }
  section("Files config.js points the server at", paths);
};

// the CDN's files, from a list or a folder of lists. a line may be a path
// ("1830/media/<hash>"), a path and a name (unhashed.tsv), an address
// ("https://.../media/<hash>"), or a file of a cache ("cache/1830/media/da/
// <hash>", as `tar -tzf` lists the VPS's). kept as "<build>/<path>"; a line
// with no build is taken for the current one.
const readList = (file, have = new Set()) => {
  if (fs.statSync(file).isDirectory()) {
    for (const name of fs.readdirSync(file)) {
      // players' paintings (masterpieces.txt, some 700 MB) are no game file
      // and too big to read as one string
      if (/\.(txt|tsv|gz)$/.test(name) && fs.statSync(path.join(file, name)).size < 256 * 1048576) {
        readList(path.join(file, name), have);
      }
    }
    return have;
  }
  let text = fs.readFileSync(file);
  if (file.endsWith(".gz")) {
    text = zlib.gunzipSync(text);
  }
  for (const line of text.toString("utf8").split(/\r?\n/)) {
    const relPath = line.split("\t")[0].trim()
      .replace(/^https?:\/\/[^/]+\//, "")
      .replace(/^(?:\.\/)?cache\//, "")
      .replace(/\/[0-9a-f]{2}\/([0-9a-f]{32})$/, "/$1");
    if (relPath && !relPath.endsWith("/")) {
      have.add(/^\d+\//.test(relPath) ? relPath : `${config.deployVersion}/${relPath}`);
    }
  }
  return have;
};
const have = LIST ? readList(LIST) : null;

// is the file at "<build>/<path>" in the cache, the list, or made here?
const present = async hashed => Boolean(await cdn.cached(hashed)) || Boolean(have && have.has(hashed));

const themeChecks = async () => {
  const problems = [];
  for (const [name, theme] of Object.entries(config.themes || {})) {
    for (const [room, shown] of Object.entries(theme.rooms || {})) {
      const relPath = cdn.hashedPath(`roomDefs/${shown.replace(/\./g, "/")}.xroom`).replace(/^\d+\//, `${theme.build}/`);
      if (!await present(relPath)) {
        problems.push(`theme \`${name}\` shows \`${room}\` as \`${shown}\` from build ${theme.build}: not in the ${have ? "list or the cache" : "cache"} (\`${relPath}\`)`);
      }
    }
  }
  section("Theme rooms", problems, "Each theme draws some rooms from another room file of an older build (config.themes).");
};

const dataChecks = async () => {
  await defpacks.init();
  const {brokenLinks} = await gamefiles.problems({files: false});
  section("Defs naming what no def pack has",
    brokenLinks.map(({from, to}) => `${from.kindLabel} ${from.id} "${from.name}" names ${to.kind} ${to.id} (${to.role})`),
    "The game's own tables, as the CDN serves them. docs/broken-references.md says what is known of each.");

  if (!WITH_FILES) {
    return;
  }
  const data = await gamefiles.catalog();
  const missing = new Map(); // kind -> [line]
  const elsewhere = []; // den items whose picture is there under another icon id
  for (const entry of data.entries.values()) {
    for (const used of entry.files) {
      const hashed = cdn.hashedPath(used.path);
      if (gamefiles.where(used.path).own || await present(hashed)) {
        continue;
      }
      // a room the current build dropped is taken from an older one (lib/cdn.js get)
      if (used.path.startsWith("roomDefs/")) {
        let older = null;
        for (const build of config.olderBuilds) {
          if (await present(hashed.replace(/^\d+\//, `${build}/`))) {
            older = build;
            break;
          }
        }
        if (older) {
          continue;
        }
      }
      if (entry.kind === "denItem" && used.path.startsWith("items/")) {
        const others = [];
        for (let icon = 0; icon < 64; icon++) {
          if (await present(cdn.hashedPath(gamefiles.denItemFile(entry.id, icon)))) {
            others.push(icon);
          }
        }
        if (others.length) {
          elsewhere.push(`Den item ${entry.id} "${entry.name}": sortCat ${entry.fields.sortCat} asks for \`${used.path}\` (icon ${gamefiles.denIconId(Number(entry.fields.sortCat))}); there is ${others.map(icon => `\`${gamefiles.denItemFile(entry.id, icon)}\` (icon ${icon})`).join(", ")}`);
          continue;
        }
      }
      const label = gamefiles.KINDS[entry.kind].label;
      const named = (data.usedBy.get(`${entry.kind}:${entry.id}`) || []).length;
      missing.set(label, [...(missing.get(label) || []), `${label} ${entry.id} "${entry.name}": ${used.role}, \`${used.path}\` (\`${hashed}\`)${named ? `; named by ${named} other def${named === 1 ? "" : "s"}` : ""}`]);
    }
  }
  section("Den items whose picture has another icon id", elsewhere,
    "The client asks for `items/<id << 16 | icon>`, the icon worked out from the def's `sortCat` (DenItem.getIconId). These have no file under that icon, but do under another: the def's sortCat does not match the art.");
  say(`## Files the defs name that ${have ? "the list and the cache do" : "the cache does"} not have`);
  say();
  if (!missing.size) {
    say("Nothing found.");
    say();
  }
  for (const [label, found] of missing) {
    say(`### ${label}: ${found.length}`);
    say();
    for (const line of found.slice(0, SHOWN)) {
      say(`- ${line}`);
    }
    if (found.length > SHOWN) {
      say(`- ...and ${found.length - SHOWN} more`);
    }
    say();
  }
};

const run = async () => {
  say("# Reference check");
  say();
  say(`Made by \`node tools/check-references.js${args.length ? ` ${args.join(" ")}` : ""}\`.`);
  say();
  codeChecks();
  await themeChecks();
  await dataChecks();
  const report = lines.join("\n");
  if (OUT) {
    fs.writeFileSync(OUT, report);
    console.log(`written to ${OUT}`);
  }
  else {
    console.log(report);
  }
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
