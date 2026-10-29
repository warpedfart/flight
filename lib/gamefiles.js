"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const amf3 = require("./amf3.js");
const badges = require("./badges.js");
const cdn = require("./cdn.js");
const config = require("../config.js");
const defpacks = require("./defpacks.js");
const extraMusic = require("./extramusic.js");
const games = require("./games.json");
const journeyBook = require("./journeybook.json");
const ecardArt = require("./ecard-art.json");
const wallArt = require("./wall-art.json");
const shopStock = require("./shop-stock.json");

// what each of the game's files is: the owner dashboard's Game files page
// (lib/panel.js), and tools/check-references.js. the CDN names a file by a
// hash of its name ("media/1233" is "1830/media/<md5...>", lib/cdn.js), and
// the names are bare numbers: what a number is, the def packs say. a party's
// def names its room and its art, a den item's def its picture file, and so
// on. this reads every def pack and the server's own tables (lib/*.json)
// once, the first time it is asked, and keeps:
//
//   entries   {kind, id, name, fields, files, links} for each thing the game
//             has (a party, a den item, a shop list, ...). `files` are the
//             files it is drawn or played from, `links` the other entries it
//             names (a party's room, a shop's items).
//   by file   each file's path ("media/1233") -> the entries that use it, so
//             a hash or a path can be looked up the other way.
//
// docs/game-files.md says what every folder of the CDN holds.

// the def packs the client knows (loader.DefPacksDefHelper), and what each
// holds. "a list, never a file": no build on the CDN has it; the official
// server sent it over the socket when the game asked ("gl",
// GenericListXtCommManager.handleNewData).
const PACKS = new Map([
  [1000, "Clothing, and animals' eyes, patterns and body parts"],
  [1003, "Animals"],
  [1011, "Rooms: each room's file path"],
  [1024, "Minigames (a list, never a file; lib/games.json stands in)"],
  [1025, "NPCs: adventure characters and their outfits"],
  [1027, "Layers: which body layer an item's art is drawn on"],
  [1029, "Image array info"],
  [1030, "Den items"],
  [1033, "Media (a list, never a file: media files are named by the defs that use them)"],
  [1035, "Facts (a list, never a file; factDefs/ holds the facts)"],
  [1036, "Emoticons and actions"],
  [1037, "Streams (a list, never a file; streams/ holds the videos and voices)"],
  [1038, "Generic lists: shops, pet food and toy lists, and the like"],
  [1040, "Den rooms (den types)"],
  [1042, "Achievements"],
  [1046, "Pets"],
  [1047, "Parties"],
  [1049, "Name tag badges"],
  [1050, "Battle cards (adventures)"],
  [1051, "Currency exchange"],
  [1052, "Adventures"],
  [1053, "Movies (the theatre's films)"],
  [1054, "Diamond shop: what is sold for diamonds, and its price"],
  [1057, "Special animals (custom animal patterns)"],
  [1058, "E-books"],
  [1059, "Party list (a list, never a file)"],
  [1060, "Combined lists (a list, never a file)"],
  [1061, "Adopt-A-Pet toys"],
  [1062, "Pet food"],
  [1063, "Pet toys"],
  [1064, "World items: gifts lying about in the lands"],
  [1065, "Jamaa Journal pages"],
]);
// the pack's id is "1023" or "1055" and the language's number
// (LocalizationManager: LANG_ENG 0 ... LANG_DE 4)
const LANGUAGES = ["English", "Spanish", "Portuguese", "French", "German"];
for (let n = 0; n < 8; n++) {
  const language = LANGUAGES[n] || `language ${n}`;
  PACKS.set(Number(`1023${n}`), `Game text, ${language}`);
  PACKS.set(Number(`1055${n}`), `Preferred game text, ${language}`);
}

// image array ids pack an animal, a category and a layer
// (com.sbi.graphics.ImageArrayHelper.packId). categories 25 and 26 are an
// item's icons, drawn on the tiger (animal 1) alone; the others are the
// animations each animal has its own art for.
const imageArrayId = (animal, category, layer) => ((animal << 24) | (category << 16) | layer) >>> 0;
const ICON_ANIMAL = 1;
const ICON_LARGE = 25;
const ICON_SMALL = 26;
const ANIMATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 22, 23, 34, 35, 37, 42];

// a den item's file is items/<def id << 16 | icon id> (loader.DenItemHelper);
// the icon id comes from its sort category (DenItem.getIconId).
const denIconId = sortCat => ([0, 99, 6, 5].includes(sortCat) ? 1 : sortCat === 1 ? 2 : [2, 3, 4].includes(sortCat) ? 3 : sortCat + 1);
const denItemFile = (defId, iconId) => `items/${((defId << 16) | iconId) >>> 0}`;

// what the kinds of entries are called on the page, and the pack each comes
// from (none for the server's own tables).
const KINDS = {
  clothing: {label: "Clothing", pack: 1000},
  bodypart: {label: "Eyes, pattern or body part", pack: 1000},
  animal: {label: "Animal", pack: 1003},
  specialAnimal: {label: "Special animal", pack: 1057},
  room: {label: "Room", pack: 1011},
  npc: {label: "NPC", pack: 1025},
  denItem: {label: "Den item", pack: 1030},
  emoticon: {label: "Emoticon or action", pack: 1036},
  list: {label: "List or shop", pack: 1038},
  denRoom: {label: "Den type", pack: 1040},
  achievement: {label: "Achievement", pack: 1042},
  pet: {label: "Pet", pack: 1046},
  party: {label: "Party", pack: 1047},
  badge: {label: "Name tag badge", pack: 1049},
  battleCard: {label: "Battle card", pack: 1050},
  exchange: {label: "Currency exchange", pack: 1051},
  adventure: {label: "Adventure", pack: 1052},
  movie: {label: "Movie", pack: 1053},
  diamond: {label: "Diamond shop row", pack: 1054},
  ebook: {label: "E-book", pack: 1058},
  adoptAPet: {label: "Adopt-A-Pet toy", pack: 1061},
  petFood: {label: "Pet food", pack: 1062},
  petToy: {label: "Pet toy", pack: 1063},
  worldItem: {label: "World item", pack: 1064},
  journal: {label: "Jamaa Journal page", pack: 1065},
  minigame: {label: "Minigame", table: "lib/games.json"},
  journeyPage: {label: "Journey Book page", table: "lib/journeybook.json"},
  fact: {label: "Journey Book fact", table: "lib/journeybook.json"},
  ecard: {label: "Jam-A-Gram card or stamp", table: "lib/ecard-art.json"},
  wallArt: {label: "Jammer Wall wallpaper or sticker", table: "lib/wall-art.json"},
  defPack: {label: "Def pack"},
};

// what each folder of the CDN holds, for a file no entry names
const FOLDERS = {
  defPacks: "a def pack: one of the game's tables",
  media: "a SWF of artwork: a popup, an icon, a party's art, a den's art",
  items: "a den item's picture, in the game's image format",
  imageArrays: "clothing or an animal drawn for one animal and one animation, in the game's image format",
  roomDefs: "a room: its scene, actors, shops and doors (an .xroom file)",
  audio: "a sound or a piece of music (MP3)",
  streams: "a video (FLV) or a voice line (MP3)",
  subtitle: "a movie's subtitles, per language",
  factDefs: "a Journey Book fact or a fact popup",
  feedbackDefs: "a feedback form",
  pollDefs: "a poll",
  assets: "a SWF the client loads at start (fonts, the HUD, sound banks)",
  ajc: "the game client itself",
};

// DIAMOND_TYPES in lib/player.js, by the kind they point at
const DIAMOND_KINDS = {0: "clothing", 1: "denItem", 2: "pet", 3: "animal", 4: "denRoom", 5: "specialAnimal"};
// WorldItemDef.giftType (lib/worlditems.js)
const GIFT_KINDS = {0: "denItem", 3: "clothing"};

const num = value => Number(value) || 0;

let built = null;
let building = null;

const build = async () => {
  const entries = new Map(); // "kind:id" -> entry
  const string = id => defpacks.string(num(id));
  const add = (kind, id, name, fields) => {
    const entry = {kind, id: num(id), name: name || "", fields: fields || {}, files: [], links: []};
    entries.set(`${kind}:${entry.id}`, entry);
    return entry;
  };
  const file = (entry, relPath, role) => {
    if (relPath && !entry.files.some(one => one.path === relPath)) {
      entry.files.push({path: relPath, role});
    }
  };
  const media = (entry, id, role) => {
    if (num(id) > 0) {
      file(entry, `media/${num(id)}`, role);
    }
  };
  const link = (entry, kind, id, role) => {
    if (num(id) > 0) {
      entry.links.push({kind, id: num(id), role});
    }
  };
  // an item of pack 1000 is clothing or a body part: whichever it is
  const itemKind = id => (entries.has(`bodypart:${num(id)}`) ? "bodypart" : "clothing");
  const plain = row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]]));
  const pack = async id => (await defpacks.load(id).catch(() => [])).map(plain);

  // the packs themselves
  for (const [id, label] of PACKS) {
    const entry = add("defPack", id, label, {});
    // a list the official server sent has no file to name
    if (!/never a file/.test(label)) {
      file(entry, `defPacks/${id}`, "the pack");
    }
  }

  for (const row of await pack(1000)) {
    const entry = add(row.type === "1" ? "clothing" : "bodypart", row.id, string(row.titleStrId), row);
    const layer = num(row.layerDefId);
    // eyes, patterns and body parts have no icons: the animal editor draws
    // them on the animal
    if (layer > 0 && entry.kind === "clothing") {
      file(entry, `imageArrays/${imageArrayId(ICON_ANIMAL, ICON_LARGE, layer)}`, "icon, large (shops, inventory)");
      file(entry, `imageArrays/${imageArrayId(ICON_ANIMAL, ICON_SMALL, layer)}`, "icon, small");
    }
    if (layer > 0) {
      entry.wornLayer = layer;
    }
    media(entry, row.soundMediaRefId, "sound");
    media(entry, row.attackMediaRefId, "attack (adventures)");
  }

  for (const row of await pack(1003)) {
    const entry = add("animal", row.id, string(row.titleStrRef), row);
    media(entry, row.iconMediaRefId, "icon");
    link(entry, "bodypart", row.basePatternId, "pattern");
    link(entry, "bodypart", row.baseEyesId, "eyes");
  }

  for (const row of await pack(1057)) {
    const entry = add("specialAnimal", row.id, string(row.titleStrRef), row);
    link(entry, "animal", row.avatarRef, "animal");
    link(entry, "bodypart", row.patternRefId, "pattern");
    link(entry, "list", row.patternListRefId, "patterns");
    media(entry, row.particleRefId, "particles");
    media(entry, row.iconRefId, "icon");
    media(entry, row.avatarIconRefId, "animal icon");
  }

  // rooms: their file, and what their file says (name, shops) when it is in
  // the cache
  const shopRooms = new Map(); // list id -> room ids
  for (const row of await pack(1011)) {
    const roomPath = String(row.pathName || "");
    const entry = add("room", row.id, roomPath, row);
    file(entry, `roomDefs/${roomPath}.xroom`, "the room");
    entry.roomPath = roomPath;
    const body = roomPath ? await cdn.cached(cdn.hashedPath(`roomDefs/${roomPath}.xroom`)) : null;
    if (body) {
      try {
        const room = amf3.decode(zlib.inflateSync(body));
        const settings = (room.actors.ActorSettings || [])[0] || {};
        // "Display Name" is a room the designers left unnamed (lib/roominfo.js)
        if (typeof settings.name === "string" && settings.name.trim() && settings.name.trim() !== "Display Name") {
          entry.name = `${settings.name.trim()} (${roomPath})`;
        }
        for (const volume of room.actors.ActorVolume || []) {
          // a shop's volume names its generic list (roominfo.js VOLUME_SHOP)
          if (Number(volume.type) === 3 && num(volume.typeDefId)) {
            link(entry, "list", volume.typeDefId, "shop");
            shopRooms.set(num(volume.typeDefId), [...(shopRooms.get(num(volume.typeDefId)) || []), entry.id]);
          }
        }
      }
      catch (err) {
        entry.note = "its file is in the cache but could not be read";
      }
    }
  }

  for (const row of await pack(1025)) {
    const entry = add("npc", row.id, string(row.titleStrId), row);
    for (const key of ["mediaRefId", "iconMediaRefId", "headMediaRefId", "soundMediaRefId"]) {
      media(entry, row[key], key.replace(/MediaRefId$/, "") || "art");
    }
    link(entry, "animal", row.avatarRefId, "animal");
    for (const part of ["eyes", "pattern", "tail", "leg", "back", "neck", "head"]) {
      link(entry, itemKind(row[`${part}ItemRefId`]), row[`${part}ItemRefId`], part);
    }
  }

  for (const row of await pack(1030)) {
    const entry = add("denItem", row.id, string(row.nameStrId), row);
    file(entry, denItemFile(num(row.id), denIconId(num(row.sortCat))), "its picture (icon and in the den)");
    // music plays audio/<abbrName>.mp3 (DenItemHolder)
    if (row.typeCat === "4" && row.abbrName) {
      file(entry, `audio/${row.abbrName}.mp3`, "the music");
    }
    link(entry, "minigame", row.gameDefId, "game it starts");
    link(entry, "animal", row.mannequinAvatarDefId, "mannequin's animal");
  }

  for (const row of await pack(1036)) {
    media(add("emoticon", row.id, "", row), row.mediaRef, "art");
  }

  const listTypes = new Map();
  for (const row of await pack(1038)) {
    listTypes.set(num(row.id), num(row.typeId));
    const stock = (shopStock.lists || {})[row.id];
    const typeLabel = PACKS.get(num(row.typeId)) || `pack ${row.typeId}`;
    const entry = add("list", row.id, stock ? `${stock.shop} (shop)` : `List of: ${typeLabel}`, row);
    if (stock) {
      for (const [when, role] of [["now", "sold now"], ["former", "sold once"]]) {
        for (const id of (stock[when] || {}).clothing || []) {
          link(entry, "clothing", id, role);
        }
        for (const id of (stock[when] || {}).den || []) {
          link(entry, "denItem", id, role);
        }
      }
    }
    for (const room of shopRooms.get(num(row.id)) || []) {
      link(entry, "room", room, "stands in");
    }
  }

  for (const row of await pack(1040)) {
    const entry = add("denRoom", row.id, string(row.titleStrRef), row);
    media(entry, row.mediaRef, "art");
    media(entry, row.iconMediaRef, "icon");
    link(entry, "room", row.roomDefId, "room");
  }

  for (const row of await pack(1042)) {
    const entry = add("achievement", row.id, string(row.titleStrRef) || row.name, row);
    media(entry, row.baseMediaRef, "art");
    media(entry, row.iconMediaRef, "icon");
  }

  for (const row of await pack(1046)) {
    const entry = add("pet", row.id, string(row.titleStrId), row);
    media(entry, row.mediaRefId, "the pet");
    link(entry, "list", row.foodListId, "food");
    link(entry, "list", row.toyListId, "toys");
  }

  // a party's room is "party<id>" in the game
  for (const row of await pack(1047)) {
    const entry = add("party", row.id, string(row.titleStrId), row);
    media(entry, row.mediaRefId, "party list art");
    media(entry, row.iconMediaRefId, "icon");
    link(entry, "room", row.roomDefId, "the party's room");
    link(entry, "animal", row.avatarDefId, "the animal it is for");
  }

  for (const row of await pack(1049)) {
    media(add("badge", row.id, "", row), row.mediaRefId, "the badge");
  }

  for (const row of await pack(1050)) {
    const entry = add("battleCard", row.id, string(row.titleStrId), row);
    media(entry, row.cardMediaRef, "the card");
    media(entry, row.effectMediaRef, "effect");
    media(entry, row.screenEffectMediaRef, "screen effect");
  }

  for (const row of await pack(1051)) {
    media(add("exchange", row.id, string(row.titleStrId), row), row.mediaRefId, "art");
  }

  for (const row of await pack(1052)) {
    const entry = add("adventure", row.id, string(row.titleStrId), row);
    media(entry, row.mediaRefId, "art");
    media(entry, row.bannerMediaRefId, "banner");
  }

  for (const row of await pack(1053)) {
    const entry = add("movie", row.id, string(row.titleStrRef) || string(row.streamTitleStrRef), row);
    if (num(row.streamRefId)) {
      file(entry, `streams/${num(row.streamRefId)}.flv`, "the video");
    }
    if (num(row.subtitleRefId)) {
      // subtitle/<id>/<language> (VideoPlayerOSMF)
      for (const [n, language] of LANGUAGES.entries()) {
        file(entry, `subtitle/${num(row.subtitleRefId)}/${n}`, `subtitles, ${language}`);
      }
    }
    media(entry, row.mediaRefId, "art");
    media(entry, row.iconMediaRefId, "icon");
    media(entry, row.thumbMediaRefId, "thumbnail");
    link(entry, "denItem", row.denItemRefId, "den item");
    for (const n of [1, 2, 3]) {
      link(entry, "movie", row[`choice${n}MovieNodeRefId`], `choice ${n}`);
    }
  }

  for (const row of await pack(1054)) {
    const kind = DIAMOND_KINDS[row.type];
    const entry = add("diamond", row.id, "", row);
    if (kind) {
      link(entry, kind, row.refId, "sells");
    }
  }

  for (const row of await pack(1058)) {
    media(add("ebook", row.id, "", row), row.mediaRefId, "the book");
  }

  for (const row of await pack(1061)) {
    media(add("adoptAPet", row.id, string(row.titleStrId), row), row.mediaRefId, "the pet");
  }

  for (const row of await pack(1062)) {
    add("petFood", row.id, string(row.titleStrId), row);
  }

  for (const row of await pack(1063)) {
    add("petToy", row.id, string(row.titleStrId), row);
  }

  for (const row of await pack(1064)) {
    const entry = add("worldItem", row.id, string(row.titleStrId) || row.name, row);
    media(entry, row.mediaRefId, "art");
    if (GIFT_KINDS[row.giftType]) {
      link(entry, GIFT_KINDS[row.giftType] === "clothing" ? itemKind(row.giftRefId) : GIFT_KINDS[row.giftType], row.giftRefId, "gives");
    }
  }

  for (const row of await pack(1065)) {
    const entry = add("journal", row.id, row.name, row);
    media(entry, row.pageMediaRefId, "the page");
    media(entry, row.iconMediaRefId, "icon");
    if (GIFT_KINDS[row.giftType]) {
      link(entry, GIFT_KINDS[row.giftType], row.giftRefId, "gives");
    }
  }

  // the server's own tables
  for (const game of games) {
    const entry = add("minigame", game.id, game.title, game);
    media(entry, game.icon, "icon");
  }
  for (const [n, page] of journeyBook.pages.entries()) {
    const entry = add("journeyPage", n + 1, string(page.nameStrId) || `Page ${n + 1}`, page);
    media(entry, page.media, "the page");
    for (const part of page.parts) {
      link(entry, "denItem", part.gift, "gift for finding every fact");
    }
  }
  for (const [id, mediaId, title, description] of journeyBook.facts) {
    const entry = add("fact", id, string(title), {id, media: mediaId, title, description});
    file(entry, `factDefs/${id}`, "the fact");
    media(entry, mediaId, "picture");
  }
  for (const [list, role] of [["cards", "a card"], ["stamps", "a stamp"]]) {
    for (const id of ecardArt[list] || []) {
      media(add("ecard", id, `Jam-A-Gram ${role.slice(2)} ${id}`, {list}), id, role);
    }
  }
  for (const [list, role] of [["wallpapers", "wallpaper"], ["stickers", "sticker"]]) {
    for (const art of wallArt[list] || []) {
      const id = num(art.media || art);
      const entry = add("wallArt", id, `Jammer Wall ${role} ${id}`, typeof art === "object" ? art : {media: id});
      media(entry, id, role);
      media(entry, art.button, "its button");
    }
  }

  // each file's users, and the other way round each entry's
  const byFile = new Map();
  for (const entry of entries.values()) {
    for (const one of entry.files) {
      byFile.set(one.path, [...(byFile.get(one.path) || []), `${entry.kind}:${entry.id}`]);
    }
  }
  const usedBy = new Map();
  for (const entry of entries.values()) {
    for (const one of entry.links) {
      const key = `${one.kind}:${one.id}`;
      usedBy.set(key, [...(usedBy.get(key) || []), {kind: entry.kind, id: entry.id, role: one.role}]);
    }
  }
  return {entries, byFile, usedBy, madeAt: Date.now()};
};

const catalog = () => {
  if (built) {
    return Promise.resolve(built);
  }
  if (!building) {
    building = build().then(made => {
      built = made;
      return made;
    }).finally(() => {
      building = null;
    });
  }
  return building;
};

// files the CDN never had, that this server answers with itself (lib/http.js):
// hashed path -> where it comes from
let ownFiles = null;
const ownFile = hashed => {
  if (!ownFiles) {
    ownFiles = new Map(extraMusic.TRACKS.map(track => [cdn.hashedPath(`audio/${track.file}.mp3`), "this server: cut out of a game file (lib/extramusic.js)"]));
  }
  return badges.mediaFile(hashed) ? "this server: swf/badges/ (lib/badges.js)"
    : badges.cardMedia(hashed) ? "this server: swf/biotab.swf (lib/badges.js)"
    : ownFiles.get(hashed) || null;
};

// a file of the game, as the server keeps it: its path on the CDN ("1830/
// media/<hash>"), whether the cache has it, and `own`: where this server
// makes it from, for a file the CDN never had.
const where = relPath => {
  const hashed = cdn.hashedPath(relPath);
  const file = path.join(config.cacheDir, ...cdn.cachePath(hashed).split("/"));
  let bytes = null;
  try {
    bytes = fs.statSync(file).size;
  }
  catch (err) {
    // not in the cache
  }
  return {path: relPath, hashed, cached: bytes !== null, bytes, own: ownFile(hashed)};
};

// what a hashed name is, among the files the entries name: lazily, a map of
// every one of them (some 80 000 hashes) to the paths it may be. a name
// alone can be several files: every room's "room_main.xroom" hashes alike,
// told apart only by the folders before it.
let hashes = null;
const hashIndex = data => {
  if (!hashes) {
    hashes = new Map();
    for (const relPath of data.byFile.keys()) {
      const hash = cdn.hashName(relPath.split("/").pop());
      hashes.set(hash, [...(hashes.get(hash) || []), relPath]);
    }
  }
  return hashes;
};

// the file a hashed path is ("1830/roomDefs/sarepia/<hash>", or the hash
// alone): {relPath, others: how many more it could be}, or null
const fileOfHash = (data, text, hash) => {
  const candidates = hashIndex(data).get(hash) || [];
  const folders = text.replace(/^\d+\//, "").split("/").slice(0, -1).join("/");
  const fits = folders ? candidates.filter(relPath => relPath.toLowerCase().startsWith(`${folders}/`)) : candidates;
  return fits.length ? {relPath: fits[0], others: fits.length - 1} : null;
};

// a short form of an entry, for a list of results
const summary = entry => ({kind: entry.kind, kindLabel: KINDS[entry.kind].label, id: entry.id, name: entry.name, files: entry.files.length});

const MAX_RESULTS = 200;

// q: words of a name, an id ("1233"), "kind:id" ("party:6"), a file's path
// ("media/1233") or a hashed name (32 hex characters, with or without its
// folders). kind: limits it to one kind ("" for all).
const search = async (q, kind = "") => {
  const data = await catalog();
  const text = String(q || "").trim().toLowerCase();
  const kinds = Object.keys(KINDS).includes(kind) ? [kind] : null;
  const ofKind = entry => !kinds || kinds.includes(entry.kind);
  const results = [];
  let fileHit = null;
  const hash = /([0-9a-f]{32})$/.exec(text);
  if (hash) {
    const found = fileOfHash(data, text, hash[1]);
    fileHit = found ? {...where(found.relPath), usedBy: data.byFile.get(found.relPath) || [], others: found.others,
      folder: FOLDERS[found.relPath.split("/")[0]] || ""} : {hash: hash[1], unknown: true};
    for (const key of fileHit.usedBy || []) {
      results.push(data.entries.get(key));
    }
  }
  else if (/^[a-z]+\/[\w./-]+$/i.test(text) && !/^[a-z]+:\d+$/i.test(text)) {
    const relPath = [...data.byFile.keys()].find(one => one.toLowerCase() === text) || text;
    fileHit = {...where(relPath), usedBy: data.byFile.get(relPath) || [], folder: FOLDERS[relPath.split("/")[0]] || ""};
    for (const key of fileHit.usedBy) {
      results.push(data.entries.get(key));
    }
  }
  else if (/^[a-z]+:\d+$/i.test(text)) {
    const [k, id] = text.split(":");
    const match = [...data.entries.values()].find(entry => entry.kind.toLowerCase() === k && entry.id === Number(id));
    if (match) {
      results.push(match);
    }
  }
  else if (/^\d+$/.test(text)) {
    for (const entry of data.entries.values()) {
      if (entry.id === Number(text) && ofKind(entry)) {
        results.push(entry);
      }
    }
    // a media id is named by its users
    for (const key of data.byFile.get(`media/${text}`) || []) {
      const entry = data.entries.get(key);
      if (ofKind(entry) && !results.includes(entry)) {
        results.push(entry);
      }
    }
  }
  else {
    // "*": everything (of one kind: the page's kind buttons)
    const words = text === "*" ? [] : text.split(/\s+/).filter(Boolean);
    for (const entry of data.entries.values()) {
      const name = `${entry.name} ${KINDS[entry.kind].label} ${entry.fields.abbrName || ""} ${entry.fields.name || ""}`.toLowerCase();
      if (ofKind(entry) && words.every(word => name.includes(word))) {
        results.push(entry);
      }
    }
  }
  return {
    file: fileHit,
    total: results.length,
    results: results.filter(Boolean).slice(0, MAX_RESULTS).map(summary),
  };
};

// one entry in full: its fields, its files (with where each is), what it
// names and what names it.
const entry = async (kind, id) => {
  const data = await catalog();
  const found = data.entries.get(`${kind}:${Number(id)}`);
  if (!found) {
    return null;
  }
  const named = one => {
    const other = data.entries.get(`${one.kind}:${one.id}`);
    return {...one, kindLabel: (KINDS[one.kind] || {}).label || one.kind, name: other ? other.name : "", missing: !other};
  };
  return {
    ...summary(found),
    pack: KINDS[found.kind].pack || null,
    table: KINDS[found.kind].table || null,
    note: found.note || "",
    fields: found.fields,
    files: found.files.map(one => ({...where(one.path), role: one.role})),
    links: found.links.map(named),
    usedBy: (data.usedBy.get(`${found.kind}:${found.id}`) || []).map(named),
    // clothing and body parts are drawn for each animal apart: on request
    wornLayer: found.wornLayer || null,
  };
};

// the art of a piece of clothing (or a body part) worn by one animal: a file
// per animation, those the cache has marked.
const worn = async (layer, animal) => ANIMATIONS.map(category => ({
  ...where(`imageArrays/${imageArrayId(Number(animal) & 0xFF, category, Number(layer) & 0xFFFF)}`),
  role: `animation ${category}`,
}));

// what a file is by its first bytes, for its name when it is saved
const extensionOf = data => {
  const head = data.subarray(0, 3).toString("latin1");
  return ["FWS", "CWS", "ZWS"].includes(head) ? ".swf"
    : head === "FLV" ? ".flv"
    : head === "ID3" || (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0) ? ".mp3"
    : data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])) ? ".png"
    : ".bin";
};

// a file from the cache, by its path ("media/1233"): {data, name} or null.
// never downloads.
const read = async relPath => {
  if (!/^[A-Za-z]+\/[\w./-]{1,200}$/.test(relPath) || relPath.split("/").includes("..")) {
    return null;
  }
  const data = await cdn.cached(cdn.hashedPath(relPath));
  return data ? {data, name: `${relPath.replace(/\.\w+$/, "").replace(/[^\w-]+/g, "-")}${extensionOf(data)}`} : null;
};

// how many of each kind there are, for the page's first view
const counts = async () => {
  const data = await catalog();
  const count = {};
  for (const one of data.entries.values()) {
    count[one.kind] = (count[one.kind] || 0) + 1;
  }
  return Object.entries(KINDS).map(([kind, about]) => ({kind, label: about.label, count: count[kind] || 0, pack: about.pack || null, table: about.table || null}));
};

// links to entries that do not exist, and files the cache does not have:
// for tools/check-references.js, and the page's Problems view. `files:
// false` leaves out files missing from the cache (a cache that is not the
// whole archive misses most of them).
const problems = async ({files = true} = {}) => {
  const data = await catalog();
  const brokenLinks = [];
  const missingFiles = [];
  for (const one of data.entries.values()) {
    for (const target of one.links) {
      if (!data.entries.has(`${target.kind}:${target.id}`)) {
        brokenLinks.push({from: summary(one), to: target});
      }
    }
    if (files) {
      for (const used of one.files) {
        const found = where(used.path);
        if (!found.cached && !found.own) {
          missingFiles.push({from: summary(one), path: used.path, role: used.role});
        }
      }
    }
  }
  return {brokenLinks, missingFiles};
};

// forgets what was read, for after the packs change (custom items)
const forget = () => {
  built = null;
  hashes = null;
};

module.exports = {
  KINDS, PACKS, FOLDERS, ANIMATIONS,
  catalog, search, entry, worn, counts, problems, forget, where, read,
  imageArrayId, denItemFile, denIconId,
};
