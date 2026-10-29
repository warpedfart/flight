# The game's files

What every file the game loads is, where it comes from, and how to find the
ones that belong to a party, a den item, a shop and the rest.

To look a file up, use **Game files** in the owner dashboard
(`/dashboard/admin#gamefiles`). It searches by name, id, path or hashed file
name, and it shows each thing's files, what it names, and what names it. The
rest of this page explains what that page shows.

- [How a file is named](#how-a-file-is-named)
- [The folders](#the-folders)
- [The def packs](#the-def-packs)
- [What makes up...](#what-makes-up)
  - [a party](#a-party), [a den item](#a-den-item), [clothing](#clothing),
    [a shop and its stock](#a-shop-and-its-stock), [a room or a land](#a-room-or-a-land),
    [an animal](#an-animal), [a pet](#a-pet), [a den type](#a-den-type),
    [an adventure](#an-adventure), [a movie](#a-movie),
    [the Journey Book](#the-journey-book), [a Jamaa Journal page](#a-jamaa-journal-page),
    [a minigame](#a-minigame), [text](#text)
- [Files this server makes itself](#files-this-server-makes-itself)
- [Where the files are kept](#where-the-files-are-kept)
- [Tools](#tools)

## How a file is named

The client asks for every file by a short path, such as `media/1233`,
`roomDefs/party/venue_ginger.xroom` or `defPacks/1047`. Before it asks, it
replaces the last part of the path with a hash (`LoaderCache.hashItV2` in the
client, `hashName` in `lib/cdn.js`) and puts the build number in front:

```
media/1233                       ->  1830/media/da240c8064e1a50f3ffb640b69799f40
roomDefs/party/venue_ginger.xroom ->  1830/roomDefs/party/<hash of "venue_ginger.xroom">
```

The hash is MD5 of the name, salted with `"W3 7r4Ck h4X0r3rs"` and shuffled.
It works one way only. A hash can't be turned back into a name, but a name
can be hashed and compared. Because of that:

- **The folder names stay readable** (`media`, `roomDefs/party`). Only the
  last part is hashed.
- **Most names are bare numbers.** The number means something only through
  the def that names it: media `1233` is the Trading Party's art because
  party 6's def says `mediaRefId: 1233`. The game's own table of media
  (list 1033) was never a file, so what uses a file is the only clue
  to what it is.
- **The lookup page works backwards.** It hashes every path any def names,
  so pasting a hash finds the file it belongs to.

`lib/gamefiles.js` builds that index; `node tools/check-references.js` uses
it too.

## The folders

| Folder | What is in it | Named by | Count on the CDN |
|---|---|---|---|
| `defPacks/` | the game's tables (see [below](#the-def-packs)) | pack id: `defPacks/1047` | 48 |
| `media/` | SWFs of artwork: popups, icons, party art, den type art, pets, badges, Jam-A-Grams, journal pages | media id: `media/1233` | ~9 100 |
| `items/` | den item pictures, in the game's own image format | `defId << 16 \| iconId` (see [den items](#a-den-item)) | ~7 000 |
| `imageArrays/` | clothing and animal bodies drawn for one animal and one animation | `animal << 24 \| category << 16 \| layer` (see [clothing](#clothing)) | ~1 050 000 |
| `roomDefs/` | rooms: scene art, actors, shops, doors (`.xroom`: zlib, then AMF3) | room path: `roomDefs/jamaa_township/room_main.xroom` | ~400 |
| `audio/` | sound effects and music (MP3) | file name: `audio/aj_PS_trunkOpen.mp3`, music den items `audio/<abbrName>.mp3` | ~1 300 |
| `streams/` | movie videos (FLV) and voice lines (MP3) | `streams/388.flv`, `streams/789.mp3` | ~800 |
| `subtitle/` | movie subtitles | `subtitle/<subtitle id>/<language>` (0 English, 1 Spanish, 2 Portuguese, 3 French, 4 German) | ~240 |
| `factDefs/` | Journey Book facts and fact popups | fact id: `factDefs/140` | ~750 |
| `feedbackDefs/` | feedback forms (unused here) | id | 22 |
| `pollDefs/` | polls (unused here) | id | 30 |
| `assets/` | SWFs loaded at start: `sharedFonts.swf`, `HUDAssets.swf`, `LogInAssets.swf`, `interactiveHud.swf`, sound banks (`FFMSounds*.swf`, `QuestSounds*.swf`) | file name | ~70 |
| `ajc/` | the client (`ajclient.swf`) | file name | 2 |

`masterpieces/`, `mod-item-icons/` and `ABSU/` on the CDN held players' own
data (paintings and the like). The server never fetches or serves them.

## The def packs

A def pack is a table of rows, each a def: one party, one den item, one
room. It's an AMF3 object compressed with raw deflate (`lib/amf3.js`,
`lib/defpacks.js`). The ids are from `loader.DefPacksDefHelper` in the client.

| Pack | Holds | Fields that point at other files or defs |
|---|---|---|
| 1000 | clothing (`type` 1), and eyes, patterns and body parts (`type` 0) | `layerDefId` → imageArrays; `titleStrId` → text; `soundMediaRefId`, `attackMediaRefId` → media |
| 1003 | animals | `iconMediaRefId` → media; `basePatternId`, `baseEyesId` → pack 1000 |
| 1011 | rooms | `pathName` → `roomDefs/<pathName>.xroom` |
| 1025 | NPCs (adventure characters) | `mediaRefId`, `iconMediaRefId`, `headMediaRefId` → media; `*ItemRefId` → pack 1000; `avatarRefId` → animal |
| 1027 | layers | which body layer a `layerDefId` draws on |
| 1029 | image array info | |
| 1030 | den items | `id` → `items/` file; `nameStrId` → text; `abbrName` → `audio/<abbrName>.mp3` for music (`typeCat` 4); `gameDefId` → minigame |
| 1036 | emoticons and actions | `mediaRef` → media |
| 1038 | generic lists: shops, pet food and toy lists, pattern lists | `typeId`: the pack its entries come from. **What is on a list is not in any file** (see [shops](#a-shop-and-its-stock)) |
| 1040 | den types | `mediaRef`, `iconMediaRef` → media; `roomDefId` → room |
| 1042 | achievements | `baseMediaRef`, `iconMediaRef` → media; `userVarRef` → the counter it watches |
| 1046 | pets | `mediaRefId` → media; `foodListId`, `toyListId` → lists |
| 1047 | parties | `mediaRefId`, `iconMediaRefId` → media; `roomDefId` → room; `avatarDefId` → an animal-only party |
| 1049 | name tag badges | `mediaRefId` → media |
| 1050 | battle cards | `cardMediaRef`, `effectMediaRef`, `screenEffectMediaRef` → media |
| 1051 | currency exchange | `mediaRefId` → media |
| 1052 | adventures | `mediaRefId`, `bannerMediaRefId` → media |
| 1053 | movies (the theatre's films) | `streamRefId` → `streams/<id>.flv`; `subtitleRefId` → `subtitle/`; `denItemRefId` → den item; `choice*MovieNodeRefId` → the next movie |
| 1054 | the diamond shop | `type` + `refId`: what it sells (0 clothing, 1 den item, 2 pet, 3 animal, 4 den type, 5 special animal); `cost` in diamonds |
| 1057 | special animals | `avatarRef` → animal; `patternRefId` → pack 1000; `iconRefId`, `avatarIconRefId`, `particleRefId` → media |
| 1058 | e-books | `mediaRefId` → media |
| 1061 | Adopt-A-Pet toys | `mediaRefId` → media |
| 1062, 1063 | pet food, pet toys | `titleStrId` → text |
| 1064 | world items (gifts lying about in lands) | `mediaRefId` → media; `giftType` + `giftRefId` → what it gives |
| 1065 | Jamaa Journal pages | `pageMediaRefId`, `iconMediaRefId` → media |
| 10230–10237 | the game's text, per language (`1023` + language number) | strings by id |
| 10550–10557 | preferred text, per language (`1055` + language number) | |

**Never files:** 1024 (minigames), 1033 (media), 1035 (facts), 1037
(streams), 1059 (party list), 1060 (combined lists). The client knows these
ids, but only as lists the official server sent over the game socket (the
`gl` message, `GenericListXtCommManager.handleNewData`). No build on the CDN
has them, back to 1691 (checked against the live CDN on 2026-10-29). Where
one matters, this server rebuilds it:

- `lib/games.json` stands in for 1024.
- `lib/journeybook.json` holds the facts list 1035 needed for the Journey Book.
- The media a def names is found from the def itself, so 1033 isn't needed.

Most packs reach the client unchanged. `lib/defpacks.js` changes a few
before sending them:

- item and den item packs get re-dated sale windows (`lib/sales.js`) and the
  custom items staff make (`lib/customitems.js`);
- the badge pack gets this server's name tag badges (`lib/badges.js`);
- the den item pack gets the extra music (`lib/extramusic.js`).

## What makes up...

### a party

| Part | Where |
|---|---|
| its def | defPack **1047**, by party id |
| its name | `titleStrId` → text |
| its room | `roomDefId` → defPack **1011** → `roomDefs/<pathName>.xroom` (most are `party/venue_*`) |
| the party list's art | `mediaRefId` → `media/<id>` |
| its icon | `iconMediaRefId` → `media/<id>` |
| animal-only parties | `avatarDefId` → the animal |
| its music | none of its own. A room file can play music; a hosted Jammer party plays a den music item (`audio/<abbrName>.mp3`) |

In the game, party N's room is `party<N>`. Every party whose room exists is
open all the time (`lib/parties.js`). Jammer parties that players host use
the custom party defs (`isCustom` 1), and their room is `pparty<host>`.
Example: the Trading Party is party 6, room 515 (`party/venue_pl_barn_trading`),
art `media/1233`.

### a den item

| Part | Where |
|---|---|
| its def | defPack **1030** |
| its name | `nameStrId` → text |
| its picture, in shops, inventory and the den | `items/<defId << 16 \| iconId>`. `iconId` comes from `sortCat`: 0, 5, 6 and 99 → 1; 1 → 2; 2, 3, 4 → 3; anything else → sortCat + 1 (`DenItem.getIconId`) |
| a mannequin's pose | more files with the same `defId << 16` and other low numbers (6 to 58) |
| music (`typeCat` 4) | `audio/<abbrName>.mp3` |
| an arcade machine | `gameDefId` → minigame |
| a custom item's own picture | `data/itemart/denItem-<id>.<png\|jpg\|gif>` on this server (`lib/itemart.js`) |

Example: den item 1520 with icon 1 is `items/99614721` (1520 × 65536 + 1).
The server side is `lib/dens.js`; the client side is `DenItemHelper`,
`DenItemHolder` and `DenXtCommManager`.

### clothing

| Part | Where |
|---|---|
| its def | defPack **1000**, `type` 1 |
| its name | `titleStrId` → text |
| its art | `layerDefId` (a layer id, 16 bits), drawn as **image arrays** |
| the shop and inventory icon | `imageArrays/<1 << 24 \| 25 << 16 \| layerDefId>` (large) and category 26 (small). Icons are drawn on the tiger, animal 1, alone |
| as worn | `imageArrays/<animal << 24 \| animation << 16 \| layerDefId>`, one file per animal per animation. Animations are categories 1–11, 13–18, 22, 23, 34, 35, 37 and 42 |
| which animals may wear it | `avatarUseFlags` (a bit per animal) |
| its colours | `colors`: palette indexes |

Many items share one `layerDefId`. Recoloured versions of a piece share its
art: item 276 (Rare Spiked Collar) has layer 152, like eight other collars.
Example: the Rare Spiked Collar's large icon is `imageArrays/18415768`
(`0x01190098`). The lookup page lists a piece's worn files for any animal
you pick.

### a shop and its stock

**No game file says what a shop sells.** The official server sent each
shop's list when it opened. What this server has:

| Part | Where |
|---|---|
| which shop stands in a room | the room file: an `ActorVolume` of type 3 whose `typeDefId` is the shop's list id |
| the list | defPack **1038**, by list id; `typeId` says what it lists (1000 clothing, 1030 den items, 1054 diamond items, ...) |
| what is on it | `lib/shop-stock.json`, taken from the AJ Classic Wiki by `tools/shop-stock.py`, per list id: `now` (sold now) and `former` (sold once, back in its season) |
| the shop's title | the room's name (`lib/roominfo.js`) |
| prices | the item's own def (`value` for clothing, `cost` for den items, with `currencyType`); diamond prices in defPack **1054** |
| sale dates | the def's `availabilityStartTime`/`availabilityEndTime`, re-dated every year from `lib/sale-dates.json` (`lib/sales.js`, `tools/sale-history.js`) |

`lib/shopstock.js` puts these together. On the lookup page, a list that
`shop-stock.json` knows is called "<Shop> (shop)". Its "It names" section
lists the stock, and "Named by" lists the rooms it stands in.

### a room or a land

| Part | Where |
|---|---|
| its def | defPack **1011**: id and `pathName` |
| everything else | `roomDefs/<pathName>.xroom`: the scene SWFs, actors, doors, shops (`ActorVolume`), the room's name (`ActorSettings.name`), music |
| older versions | the same path in an older build (`1828/roomDefs/...`): `config.olderBuilds` for rooms the current build dropped, `config.themes` for the seasonal designs |

A room's name in the game is its path with dots: `jamaa_township.room_main`.
`tools/room-assets.js` writes out the files a room file carries inside it.
`tools/room-info.js` and `tools/room-history.js` describe rooms and their
versions.

### an animal

| Part | Where |
|---|---|
| its def | defPack **1003** |
| its name | `titleStrRef` → text |
| its icon | `iconMediaRefId` → media |
| its body | image arrays with the animal's id in the top 8 bits, for its body layers |
| default eyes and pattern | `baseEyesId`, `basePatternId` → pack 1000 |
| special animals (Legendary Eagle, ...) | defPack **1057**, `avatarRef` → the animal |

### a pet

defPack **1046**: `mediaRefId` → `media/<id>` (the pet's art); `foodListId`
and `toyListId` → generic lists, whose entries are defPack 1062 (food) and
1063 (toys). Adopt-A-Pet toys are defPack **1061**.

### a den type

defPack **1040**: `mediaRef` (the den shop's picture) and `iconMediaRef` →
media; `roomDefId` → the den's room (`player_den/room_main_*`). The Epic Dens
showcase rooms are `epic_dens/*` (`lib/epicdens.js`).

### an adventure

defPack **1052** (art: `mediaRefId`, `bannerMediaRefId`), its rooms under
`roomDefs/adventures/`, the characters in defPack **1025**, battle cards in
**1050**, sounds in `assets/QuestSounds*.swf`. What happens during an
adventure was decided by the official server, so each one here is a script
written by hand (`lib/adventures/`).

### a movie

defPack **1053**: the video `streams/<streamRefId>.flv`, subtitles
`subtitle/<subtitleRefId>/<language>`, art and icon media, and the choices
leading to the next movie. The theatre's own videos (`lib/theatrevideos.js`)
are files this server keeps, not the game's.

### the Journey Book

`lib/journeybook.json`, rebuilt from the page files: each page's media id,
the land's name and the gift for finishing it (a den item), plus every
fact's id, media, title and text. The facts themselves are
`factDefs/<id>`.

### a Jamaa Journal page

defPack **1065**: `pageMediaRefId` and `iconMediaRefId` → media.

### a minigame

The minigame list (1024) was never a file, so `lib/games.json` stands in for it: id,
the game's class in the client, its title and its icon media. The games are
compiled into the client. Arcade machines are den items whose `gameDefId`
names the game. Game rooms are under `roomDefs/` (for example
`pvp_tictactoe/room_main`).

### text

Every name and message is a string id in the language's pack (10230 for
English). `defpacks.string(id)` reads one.

## Files this server makes itself

These are never fetched from the CDN (`lib/http.js` answers them first):

| Asked for | Answered with |
|---|---|
| `ajc/ajclient.swf` (any `*/ajclient.swf`) | `swf/ajclient.swf`, the patched client (built from `swf-src/`) |
| `assets/HUDAssets.swf` | `swf/HUDAssets.swf` |
| `gameClient/sharedFonts.swf` | `swf/sharedFonts.swf` |
| the name tag badges this server adds (`media/20001` and up) | `swf/badges/<badge>.swf` (`lib/badges.js`) |
| the player card's Bio tab (`media/20100`) | `swf/biotab.swf` |
| extra den music (`audio/<name>.mp3`) | cut out of a room or media file (`lib/extramusic.js`) |
| staff-uploaded music | `data/custom-music/` (`lib/custommusic.js`) |
| def packs | changed copies (see [the def packs](#the-def-packs)) |
| a custom item's picture | `data/itemart/` (`lib/itemart.js`) |

## Where the files are kept

- **`cache/<build>/<folder>/<first two letters>/<hash>`** is a copy of
  every file the CDN was asked for (`lib/cdn.js`). The two-letter folder
  stops `imageArrays` from being one folder of a million files. On the VPS
  the cache holds the whole archive, and `AJ_OFFLINE=1` makes the server
  use the cache only.
- **`tools/fetch-archive.js files.txt.gz`** fills the cache from a list of
  paths.
- **`D:\aj-links\*.txt`** (on the development machine) list the CDN's files
  by folder. `unhashed.tsv` gives the plain name of about a million of them,
  but not all: newer media and most streams are missing from it.

## Tools

| Tool | What it does |
|---|---|
| owner dashboard → **Game files** | the lookup: search, a thing's files and links, saving a file from the cache |
| `node tools/check-references.js [--list <list or folder>]` | lists connections that lead nowhere, in the code and the game data. [broken-references.md](broken-references.md) says what each one should point at |
| `node tools/room-assets.js <out> <room/path>` | writes out what a room file carries |
| `node tools/room-info.js`, `node tools/room-history.js` | rooms and their versions across builds |
| `tools/extract-swfs.sh` | copies the SWFs out of the cache with a `.swf` extension, for JPEXS |
| `python tools/find-art.py` | searches media files for artwork by its shape (how the Jam-A-Gram art was found) |
| `node tools/sale-history.js` | rebuilds `lib/sale-dates.json` from every build's packs |
| `python tools/shop-stock.py` | rebuilds `lib/shop-stock.json` from the wiki |
