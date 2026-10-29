"use strict";

// writes the reference pages of docs/ from the code itself, so they say
// what the code does today:
//
//   docs/server.md   every module of lib/: what it is for (its own opening
//                    comment), what it uses, what uses it, the game files
//                    and data files it touches
//   docs/client.md   every class in swf-src/ and what was changed in it
//   docs/web.md      the web pages, and the server routes each one calls
//   docs/tools.md    every script in tools/
//
//   node tools/make-docs.js
//
// run it after adding or changing a module, and commit what it writes. the
// pages written by hand (docs/README.md, architecture.md, game-files.md,
// broken-references.md) link to these. a module's group and one-line summary
// are in GROUPS below: a new module with none is listed under "Other".

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const lineCount = file => read(file).split("\n").length;

// each module's group and one-line summary, written by hand
const GROUPS = [
  ["The core", "What every request and message passes through.", {
    "server.js": "Starts everything: loads the def packs and the database, then opens the web server and the game socket.",
    "config.js": "Every setting, with its environment variable and its default.",
    "lib/sfs.js": "The game socket: the SmartFoxServer 1.x protocol the client speaks.",
    "lib/world.js": "The game itself: logins, rooms, movement, chat, and every game message, handed on to the modules below.",
    "lib/http.js": "The web server: the launcher's and the client's web services, the game's files, the pages and every dashboard route.",
    "lib/commands.js": "The \"!something\" chat commands.",
    "lib/stubs.js": "Empty answers for features this server does not have, so the client does not wait forever.",
    "lib/limits.js": "Rate limits, and who a request is from.",
    "lib/log.js": "Keeps the server's recent log lines for the owner dashboard.",
    "lib/logtext.js": "Makes outside text safe to put in the log.",
    "lib/stats.js": "Player counts and play time over time, for the dashboards' graphs.",
    "lib/retention.js": "Deletes old records about players, as the privacy policy says.",
  }],
  ["The game's files", "Reading the game's tables and files; see game-files.md.", {
    "lib/cdn.js": "Fetches the game's files from the official CDN and keeps them in cache/; hashes file names.",
    "lib/amf3.js": "Reads and writes AMF3, the format of def packs and room files.",
    "lib/defpacks.js": "Loads the def packs (the game's tables) and serves changed copies of them to clients.",
    "lib/roominfo.js": "Reads room files for each room's name and the shops in it.",
    "lib/gamefiles.js": "What every game file is: the owner dashboard's Game files page, and tools/check-references.js.",
  }],
  ["Accounts and signing in", "", {
    "lib/accounts.js": "The account database (SQLite): credentials, settings, and each account's state as JSON.",
    "lib/signup.js": "The client's Create Account screens.",
    "lib/manage.js": "The account page (/account): a player's own settings, password, 2FA, data export, deletion.",
    "lib/totp.js": "Two-step sign-in codes (authenticator apps).",
    "lib/captcha.js": "Cloudflare Turnstile before passwords and sign-ups, when it is set up.",
    "lib/devices.js": "The computers players sign in from: alts and device bans.",
    "lib/names.js": "Which usernames are refused.",
    "lib/discord.js": "Linking a Discord account; the Server Booster badge; Discord sign-in to the dashboards.",
    "lib/recoverymail.js": "Sends account recovery mail through an outside service, when one is set up.",
    "lib/invitehook.js": "Hands invite codes to an outside bot, when one is set up.",
    "lib/erase.js": "Deletes an account and everything kept about it.",
  }],
  ["A player's things", "", {
    "lib/player.js": "Helpers over an account's animals, pets and items.",
    "lib/avatars.js": "Owning several animals and switching between them.",
    "lib/items.js": "Clothing: buying, wearing, recycling.",
    "lib/dens.js": "Den items and dens: owning, placing, recycling, den types.",
    "lib/pets.js": "Pets.",
    "lib/adopt.js": "The Adopt-A-Pet checklist.",
    "lib/trades.js": "Trading between players.",
    "lib/worlditems.js": "Gifts lying about in the lands.",
    "lib/achievements.js": "Achievements and the user vars they count.",
    "lib/colours.js": "Custom colours beyond the game's palette.",
    "lib/wearrules.js": "Rules on which animals may wear which clothing.",
    "lib/badges.js": "Badges on player cards, name tag badges, bios.",
    "lib/tints.js": "The mud, ice, fire or acid tint staff put on a player's animal.",
    "lib/disguises.js": "Playing as one of the game's characters (\"!become\").",
    "lib/buddies.js": "Buddy lists and blocking.",
  }],
  ["Shops, items and music", "", {
    "lib/shopstock.js": "What each shop sells (from lib/shop-stock.json).",
    "lib/sales.js": "When items are on sale: their yearly windows (lib/sale-dates.json).",
    "lib/admin.js": "The item finder (/shop): any item, put straight into an account.",
    "lib/customitems.js": "Items staff make while the server runs.",
    "lib/playeritems.js": "Items players make for themselves (the Item Maker).",
    "lib/itemcontrol.js": "Locking items, taking them from players, deleting custom items.",
    "lib/itemart.js": "Custom items' own pictures.",
    "lib/custommusic.js": "Music tracks staff upload, made den music items.",
    "lib/extramusic.js": "Sounds from the game's files made into den music items.",
  }],
  ["Places and events", "", {
    "lib/parties.js": "The game's parties, and parties players host.",
    "lib/epicdens.js": "The Epic Dens list: the showcase dens.",
    "lib/adventures.js": "Adventures: the engine around the hand-written scripts in lib/adventures/.",
    "lib/adventures/training-grounds.js": "The script of the Training Grounds adventure.",
    "lib/adventures/return-of-the-phantoms.js": "The script of the Return of the Phantoms adventure.",
    "lib/minigames.js": "Minigames: which game is which (lib/games.json), starting them, gem awards.",
    "lib/buddygames.js": "The eight two-player games played from a player card.",
    "lib/journeybook.js": "The Journey Book: its pages and facts (lib/journeybook.json).",
    "lib/theatre.js": "What each theatre plays, and its queue.",
    "lib/theatrevideos.js": "Video files kept on this server for the theatre.",
    "lib/masterpieces.js": "Paintings from the Art Studio, hung in dens.",
    "lib/jpegprint.js": "Fingerprints of paintings, to know one again.",
    "lib/walls.js": "Jammer Walls.",
    "lib/ecards.js": "Jam-A-Grams.",
    "lib/emoji.js": "Emoji pictures for chat.",
  }],
  ["Chat and safety", "", {
    "lib/chatfilter.js": "The server's own chat filter (lib/chat-filter.txt).",
    "lib/chatspam.js": "Trims spam out of chat lines.",
    "lib/chatlog.js": "What players typed, kept for moderators.",
    "lib/moderation.js": "Kick, ban, silence, clear a den.",
    "lib/reports.js": "Player reports.",
    "lib/bans.js": "Address bans, appeals and the record of bans.",
    "lib/image-moderation.js": "Checks uploaded pictures with Google Cloud Vision, when it is set up.",
    "lib/modnotes.js": "Moderators' notes on players.",
    "lib/modlog.js": "What each staff member did.",
    "lib/support.js": "Username requests and feedback from the account page.",
  }],
  ["Staff and the dashboards", "", {
    "lib/panel.js": "The owner dashboard (/dashboard/admin): the admin password, or an Owner's staff sign-in.",
    "lib/modpanel.js": "The staff dashboard (/dashboard/staff): moderators, with their own accounts and 2FA.",
    "lib/staff.js": "What both dashboards do alike.",
    "lib/roles.js": "Staff roles and their permissions.",
    "lib/discordbot.js": "The Discord bot: staff commands and the status board.",
    "lib/announcemedia.js": "Pictures shown with announcements.",
  }],
];

// the data files in lib/ that modules read
const DATA_FILES = {
  "lib/games.json": "The minigames table (the game's own list was never a file): id, class, title, icon.",
  "lib/journeybook.json": "The Journey Book's pages and facts.",
  "lib/shop-stock.json": "What each shop list sells, from the AJ Classic Wiki (tools/shop-stock.py).",
  "lib/sale-dates.json": "When each item was on sale, from every build (tools/sale-history.js).",
  "lib/ecard-art.json": "The Jam-A-Gram cards and stamps offered (media ids, found by tools/find-art.py).",
  "lib/wall-art.json": "The Jammer Wall wallpapers and stickers (media ids).",
  "lib/chat-filter.txt": "The chat filter's rules.",
  "lib/reserved-names.txt": "Usernames that would pass for staff.",
  "lib/sexual-names.txt": "Words refused in usernames.",
};

const DEF_PACK_NAMES = {
  1000: "items", 1003: "animals", 1011: "rooms", 1025: "NPCs", 1027: "layers", 1029: "image array info", 1030: "den items",
  1036: "emoticons", 1038: "generic lists", 1040: "den types", 1042: "achievements", 1046: "pets", 1047: "parties",
  1049: "name tag badges", 1050: "battle cards", 1051: "currency exchange", 1052: "adventures", 1053: "movies",
  1054: "diamond shop", 1057: "special animals", 1058: "e-books", 1060: "combined lists", 1061: "Adopt-A-Pet",
  1062: "pet food", 1063: "pet toys", 1064: "world items", 1065: "Jamaa Journal", 10230: "English text",
};

// a file's opening comment: the first run of // lines that is not about
// one constant (it has a blank line or the code it describes after it).
const openingComment = text => {
  const lines = text.split("\n");
  const blocks = [];
  let block = [];
  for (const line of lines.slice(0, 120)) {
    if (/^\/\/ ?/.test(line)) {
      block.push(line.replace(/^\/\/ ?/, ""));
    }
    else {
      if (block.length) {
        blocks.push(block);
      }
      block = [];
    }
  }
  const prose = blocks.find(one => one.join(" ").length > 80) || blocks[0] || [];
  // paragraphs joined, keeping indented lists and blank comment lines as breaks
  const paragraphs = [];
  let current = [];
  for (const line of prose) {
    if (line.trim() === "") {
      if (current.length) {
        paragraphs.push(current);
      }
      current = [];
    }
    else if (/^\s{2,}|^\s*-\s/.test(line)) {
      if (current.length && !current.code) {
        paragraphs.push(current);
        current = [];
      }
      current.code = true;
      current.push(line);
    }
    else {
      if (current.code) {
        paragraphs.push(current);
        current = [];
      }
      current.push(line.trim());
    }
  }
  if (current.length) {
    paragraphs.push(current);
  }
  return paragraphs.map(paragraph => (paragraph.code ? `\`\`\`\n${paragraph.join("\n")}\n\`\`\`` : paragraph.join(" "))).join("\n\n");
};

const modules = () => {
  const files = ["server.js", "config.js",
    ...fs.readdirSync("lib").filter(file => file.endsWith(".js")).map(file => `lib/${file}`),
    ...fs.readdirSync("lib/adventures").filter(file => file.endsWith(".js")).map(file => `lib/adventures/${file}`)];
  const info = new Map();
  for (const file of files) {
    const text = read(file);
    const requires = [...text.matchAll(/require\(["'`](\.{1,2}\/[^"'`]+)["'`]\)/g)]
      .map(match => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])))
      .map(target => (target.endsWith(".js") || target.endsWith(".json") ? target : `${target}.js`));
    const defPacks = new Set();
    for (const match of text.matchAll(/\b(?:DEF_[A-Z_]+\s*=\s*|defPack\s+|defpacks\.load\()(\d{4,5})\b/g)) {
      defPacks.add(Number(match[1]));
    }
    const gameFolders = new Set([...text.matchAll(/["'`](defPacks|media|items|imageArrays|roomDefs|audio|streams|subtitle|factDefs|assets)\//g)].map(match => match[1]));
    const dataFiles = new Set([...text.matchAll(/\bdata\/([a-z-]+(?:\.[a-z]+)?(?:\/[^\s"'`),;]*)?)/g)].map(match => `data/${match[1]}`.replace(/[/.]$/, "")));
    info.set(file, {file, text, lines: text.split("\n").length, requires: [...new Set(requires)], defPacks, gameFolders, dataFiles, usedBy: []});
  }
  for (const one of info.values()) {
    for (const target of one.requires) {
      if (info.has(target)) {
        info.get(target).usedBy.push(one.file);
      }
    }
  }
  return info;
};

const anchor = file => file.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
const linkTo = file => `[\`${file}\`](#${anchor(file)})`;

const serverPage = () => {
  const info = modules();
  const placed = new Set(GROUPS.flatMap(([, , members]) => Object.keys(members)));
  const others = [...info.keys()].filter(file => !placed.has(file));
  const groups = [...GROUPS, ...(others.length ? [["Other", "Modules with no group in tools/make-docs.js yet.", Object.fromEntries(others.map(file => [file, ""]))]] : [])];
  const out = [];
  out.push("# Server modules", "");
  out.push("Every file of the server, grouped by what it is for. Written by `node tools/make-docs.js` from the code: each module's description is its own opening comment, so fix a description there, not here. [architecture.md](architecture.md) says how they fit together.", "");
  out.push("In each module: **Uses** are the modules it loads, **Used by** the ones that load it, **Def packs** the game tables it reads (see [game-files.md](game-files.md#the-def-packs)), **Game files** the CDN folders it names, and **Data** what it keeps under `data/`.", "");
  out.push("## Contents", "");
  for (const [title, , members] of groups) {
    out.push(`- **${title}**: ${Object.keys(members).filter(file => info.has(file)).map(file => linkTo(file)).join(", ")}`);
  }
  out.push(`- **Data files in lib/**: ${Object.keys(DATA_FILES).map(file => `\`${file}\``).join(", ")}`, "");
  for (const [title, about, members] of groups) {
    out.push(`## ${title}`, "");
    if (about) {
      out.push(about, "");
    }
    for (const [file, summary] of Object.entries(members)) {
      const one = info.get(file);
      if (!one) {
        continue;
      }
      out.push(`### ${file}`, "");
      if (summary) {
        out.push(`**${summary}**`, "");
      }
      const comment = ["server.js", "config.js", "lib/defpacks.js", "lib/wearrules.js"].includes(file) ? "" : openingComment(one.text);
      if (comment) {
        out.push(comment, "");
      }
      const facts = [];
      facts.push(`${one.lines} lines`);
      const uses = one.requires.filter(target => target !== "config.js" && !target.endsWith("logtext.js"));
      if (uses.length) {
        facts.push(`**Uses** ${uses.map(target => (info.has(target) ? linkTo(target) : `\`${target}\``)).join(", ")}`);
      }
      if (one.usedBy.length) {
        facts.push(`**Used by** ${one.usedBy.map(linkTo).join(", ")}`);
      }
      if (one.defPacks.size) {
        facts.push(`**Def packs** ${[...one.defPacks].sort((a, b) => a - b).map(id => `${id}${DEF_PACK_NAMES[id] ? ` (${DEF_PACK_NAMES[id]})` : ""}`).join(", ")}`);
      }
      if (one.gameFolders.size) {
        facts.push(`**Game files** ${[...one.gameFolders].map(folder => `\`${folder}/\``).join(", ")}`);
      }
      if (one.dataFiles.size) {
        facts.push(`**Data** ${[...one.dataFiles].map(name => `\`${name}\``).join(", ")}`);
      }
      out.push(facts.map(fact => `- ${fact}`).join("\n"), "");
    }
  }
  out.push("## Data files in lib/", "", "| File | What it holds | Read by |", "|---|---|---|");
  for (const [file, about] of Object.entries(DATA_FILES)) {
    const readers = [...info.values()].filter(one => one.requires.includes(file) || one.text.includes(path.basename(file))).map(one => linkTo(one.file));
    out.push(`| \`${file}\` | ${about} | ${readers.join(", ")} |`);
  }
  out.push("");
  return out.join("\n");
};

// an AS3 class's methods: name -> body, with comments and spacing taken out
// so that only real changes count
const methodsOf = text => {
  const methods = new Map();
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const match of plain.matchAll(/function\s+(?:(get|set)\s+)?(\w+)\s*\(/g)) {
    const open = plain.indexOf("{", match.index);
    const semicolon = plain.indexOf(";", match.index);
    if (open < 0 || (semicolon >= 0 && semicolon < open)) {
      continue;
    }
    let depth = 0;
    let end = open;
    for (; end < plain.length; end++) {
      depth += plain[end] === "{" ? 1 : plain[end] === "}" ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    const name = match[1] ? `${match[1]} ${match[2]}` : match[2];
    methods.set(methods.has(name) ? `${name}#2` : name, plain.slice(open, end + 1).replace(/\s+/g, ""));
  }
  return methods;
};

// what was changed in a class of swf-src/ against its original under
// tools/decompiled/: {changed, added}, or null with no original found
const changesOf = (name, text) => {
  const original = path.join("tools", "decompiled", ...name.split(".")) + ".as";
  if (!fs.existsSync(original)) {
    return null;
  }
  const before = methodsOf(read(original));
  const after = methodsOf(text);
  const changed = [];
  const added = [];
  for (const [method, body] of after) {
    if (!before.has(method)) {
      added.push(method);
    }
    else if (before.get(method) !== body) {
      changed.push(method);
    }
  }
  return {changed, added, original: original.split(path.sep).join("/")};
};

const clientPage = () => {
  const build = read("tools/build-client.sh");
  const classes = [...build.matchAll(/^\s+([\w.]+)\s+(\S+\.as)\s*\\?$/gm)].map(match => ({name: match[1], file: match[2]}));
  const pcode = [...build.matchAll(/(\S+\.pcode)/g)].map(match => match[1].replace(/^swf-src\//, ""));
  const out = [];
  out.push("# The client's changes", "");
  out.push("The game client is the official `ajclient.swf` with some of its classes replaced. `swf-src/` holds the replacements: each is a decompiled class (the untouched one is under `tools/decompiled/`, by its package) changed for this server. `tools/build-client.sh` compiles them over the original with JPEXS and writes `swf/ajclient.swf`, which the server sends in place of the CDN's client. Written by `node tools/make-docs.js`.", "");
  out.push("**A change here needs `sh tools/build-client.sh`** (Java, and JPEXS in `tools/ffdec`). A class added to `swf-src/` also needs a line in that script.", "");
  out.push("For each class: the methods changed and added against the untouched original (comments and spacing aside), and the first comments in the file, which say why, mostly. Search a file for `Burrow:`, `#1009` and `#2025` (errors the original threw) for more.", "");
  for (const {name, file} of classes) {
    const full = path.posix.join("swf-src", file);
    const local = fs.existsSync(full);
    out.push(`### ${name}`, "");
    if (!local) {
      out.push(`Compiled from \`${path.posix.normalize(path.posix.join("swf-src", file))}\`, the decompiled original, so that the build has it as it decompiles.`, "");
      continue;
    }
    const text = read(full);
    const changes = changesOf(name, text);
    const notes = [...text.matchAll(/^\s*\/\/ ?(.+)$/gm)].map(match => match[1].trim()).filter(line => line.length > 20).slice(0, 4).join(" ");
    const facts = [`\`${full}\`, ${text.split("\n").length} lines`];
    if (changes) {
      facts.push(`original: \`${changes.original}\``);
      facts.push(changes.changed.length ? `**changed:** ${changes.changed.map(method => `\`${method}\``).join(", ")}` : "no method changed");
      if (changes.added.length) {
        facts.push(`**added:** ${changes.added.map(method => `\`${method}\``).join(", ")}`);
      }
    }
    out.push(facts.map(fact => `- ${fact}`).join("\n"), "");
    if (notes) {
      out.push(`> ${notes}`, "");
    }
  }
  out.push("", "## Replaced as P-code", "");
  out.push("Some methods decompile wrong and cannot be compiled from source, so their bytecode is replaced instead. The script's comments say which and why:", "");
  for (const file of [...new Set(pcode)]) {
    out.push(`- \`swf-src/${file}\``);
  }
  out.push("", "## Other files in swf-src/", "");
  const named = new Set([...classes.map(one => one.file), ...pcode]);
  for (const file of fs.readdirSync("swf-src")) {
    if (!named.has(file)) {
      out.push(`- \`swf-src/${file}\``);
    }
  }
  out.push("");
  return out.join("\n");
};

const webPage = () => {
  const lib = fs.readdirSync("lib").filter(file => file.endsWith(".js")).map(file => ({file: `lib/${file}`, text: read(`lib/${file}`)}));
  const routes = [];
  for (const {file, text} of lib) {
    for (const match of text.matchAll(/(?:case |route === )"((?:GET|POST|DELETE|PUT) \/[^"]+)"/g)) {
      routes.push({route: match[1], file});
    }
    // a route that takes any method
    for (const match of text.matchAll(/url\.pathname === "(\/(?:admin|mod|account)\/api\/[^"]+)"/g)) {
      routes.push({route: `ANY ${match[1]}`, file});
    }
  }
  const out = [];
  out.push("# Web pages and routes", "");
  out.push("The pages in `public/` and the routes of the server they call. Written by `node tools/make-docs.js`.", "");
  out.push("## Pages", "", "| Page | Address | What it is |", "|---|---|---|");
  const PAGES = {
    "dashboard.html": ["/dashboard", "The way into the two dashboards."],
    "admin.html": ["/dashboard/admin", "The owner dashboard (lib/panel.js): everything, behind the admin password or an Owner's staff sign-in."],
    "mod.html": ["/dashboard/staff", "The staff dashboard (lib/modpanel.js): what each staff role may do."],
    "account.html": ["/account", "A player's own account page (lib/manage.js)."],
    "shop.html": ["/shop", "The item finder (lib/admin.js)."],
    "game.html": ["/play", "The page the game runs in, with the theatre's video and the browser overlays."],
    "home.html": ["/", "The home page."],
    "register.html": ["/register", "Signing up from the web."],
    "signup": ["/signup/...", "The sign-up pages' parts."],
    "recover.html": ["/recover", "Getting back into an account."],
    "download.html": ["/download", "The launcher's installers (config.downloadsDir)."],
    "commands.html": ["/commands", "The list of chat commands."],
    "captcha.html": ["", "The captcha, inside the client."],
    "privacy.html": ["/privacy", "The privacy policy (lib/retention.js keeps to it)."],
    "terms.html": ["/terms", "The terms."],
    "stats-view.html": ["", "The graphs shown inside the dashboards."],
  };
  for (const file of fs.readdirSync("public").sort()) {
    const [where, about] = PAGES[file] || ["", ""];
    if (file.endsWith(".html") || PAGES[file]) {
      out.push(`| \`public/${file}\` | ${where ? `\`${where}\`` : ""} | ${about} |`);
    }
  }
  out.push("", "Other files in `public/`: pictures (`badges/`, logos), `fonts/`, `music/` (extra den music), `filter/` (the client's chat filter lists), `captcha.js`.", "");
  for (const [page, prefix, owner] of [["admin.html", "/admin/api/", "lib/panel.js"], ["mod.html", "/mod/api/", "lib/modpanel.js"], ["account.html", "/account/api/", "lib/manage.js"]]) {
    const text = read(`public/${page}`);
    const called = [...new Set([...text.matchAll(/\bapi\(\s*["'`]([a-z0-9/_-]+)/gi)].map(match => match[1].replace(/\/$/, "")))].sort();
    out.push(`## ${page}`, "", `Calls \`${prefix}<route>\` (through \`/dashboard/api/...\` for the dashboards), answered by \`${owner}\` unless said otherwise.`, "");
    out.push("| Route | Answered in |", "|---|---|");
    for (const call of called) {
      const full = `${prefix}${call}`;
      const found = routes.filter(route => route.route.endsWith(` ${full}`)).map(route => `\`${route.route.split(" ")[0]}\` ${route.file}`);
      const shared = lib.filter(({text: source}) => new RegExp(`"(GET|POST|DELETE) ${call}"`).test(source)).map(({file}) => `${file} (shared item route)`);
      out.push(`| \`${call}\` | ${[...found, ...shared].join(", ") || "**no route found**"} |`);
    }
    out.push("");
  }
  out.push("## Every route", "", "| Route | In |", "|---|---|");
  for (const {route, file} of routes.sort((a, b) => a.route.split(" ")[1].localeCompare(b.route.split(" ")[1]))) {
    out.push(`| \`${route}\` | ${file} |`);
  }
  out.push("", "`lib/http.js` answers more by testing the address itself (the launcher's services, the game's files, the pages); read its `handle` function for those.", "");
  return out.join("\n");
};

const toolsPage = () => {
  const out = [];
  out.push("# Tools", "");
  out.push("The scripts in `tools/`. Written by `node tools/make-docs.js` from each script's opening comment.", "");
  out.push("`tools/decompiled/` is the decompiled client, for reading only (`old-builds/` has older builds). `tools/ffdec/` is JPEXS, which `build-client.sh` runs.", "");
  const files = fs.readdirSync("tools").filter(file => /\.(js|sh|py|ps1)$/.test(file)).map(file => `tools/${file}`)
    .concat(fs.readdirSync("tools/hud").map(file => `tools/hud/${file}`));
  for (const file of files.sort()) {
    const text = read(file);
    const comment = [...text.split("\n").slice(0, 60)]
      .filter(line => /^\s*(\/\/|#)(?!!)/.test(line))
      .map(line => line.replace(/^\s*(\/\/|#)\s?/, ""))
      .filter(line => !/^-{3,}|^-+ .* -+$/.test(line));
    const prose = comment.slice(0, 18).join("\n").trim();
    out.push(`## ${file}`, "");
    out.push(prose ? `\`\`\`\n${prose}\n\`\`\`` : "_No opening comment._", "");
  }
  return out.join("\n");
};

const write = (file, text) => {
  fs.writeFileSync(file, text);
  console.log(`wrote ${file}`);
};

write("docs/server.md", serverPage());
write("docs/client.md", clientPage());
write("docs/web.md", webPage());
write("docs/tools.md", toolsPage());
