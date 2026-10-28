"use strict";

const dens = require("./dens.js");

// The Journey Book (the HUD's book button, GuiManager.openJourneyBook): a
// page for each land, each listing the facts found there, and a den item
// for finding them all. The official server answered two generic lists for
// it, which this rebuilds from the game's own files (lib/journeybook.json):
//   53: the pages, as (page media id, the land's name string) pairs. the
//       book opens at the page whose name is the room's (GuiManager.
//       onJourneyBookMediaListReceived); with no pages at all it opened empty
//       and could not be shut, and a party that opens it on entry (Call of
//       the Alphas) left the player stuck.
//   54: every fact, as (id, media, title, description, type, user var, bit)
//       (GenericListXtCommManager.handleFactResponse, JBManager).
// The pages, their names and their gifts were read from the page files
// themselves (each names its facts "jb_<id>" and its gifts "jb_gift_d_<den
// item>[_<part>]"); the facts from factDefs/<id>. A page has one part (a user
// var and a gift) a land; the "alpha" page (the Call of the Alphas party,
// media 6189) has three, one for each year's set of facts.
const {pages, facts} = require("./journeybook.json");

const PAGES_LIST = 53;
const FACTS_LIST = 54;
// the party rooms the book is opened in on entry, a bit each
// (RoomManagerWorld: AchievementXtCommManager.UV_PARTY_JB_ENTER_BIT_ARRAY)
const PARTY_ENTERED_VAR = 366;
// a page's var: one bit a fact, then these (PageFlip, JBManager)
const BIT_SEEN = 29;
const BIT_REJECTED = 30;
const BIT_KEPT = 31;

const partByVar = new Map(pages.flatMap(page => page.parts.map(part => [part.userVar, part])));
const factBits = new Map();
for (const [, , , , , userVar, bit] of facts) {
  factBits.set(userVar, (factBits.get(userVar) || 0) | (1 << bit));
}

// the vars the client sets a bit of at a time: it sends the bit's number,
// never the whole value (NGFactManager, PageFlip, RoomManagerWorld).
const BIT_VARS = new Set([...partByVar.keys(), PARTY_ENTERED_VAR]);

const isBitVar = varId => BIT_VARS.has(Number(varId));

const bitsOf = value => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) >>> 0 : 0);
const has = (value, bit) => ((bitsOf(value) >>> bit) & 1) === 1;

// generic list entries, or null for a list that is not the book's.
const list = listId => {
  if (Number(listId) === PAGES_LIST) {
    return {entries: pages.flatMap(page => [page.media, page.nameStrId]), count: pages.length};
  }
  if (Number(listId) === FACTS_LIST) {
    return {entries: facts.flat(), count: facts.length};
  }
  return null;
};

// sets bit `bit` of a book var. keeping a page's gift ("kept") gives its den
// item, once, and only for a page whose every fact has been found; a gift
// asked for early, or twice, is refused. true when a den item was given.
// the caller saves and replies.
const setBit = (account, varId, bit) => {
  const id = Number(varId);
  if (!Number.isInteger(bit) || bit < 0 || bit > 31) {
    return false;
  }
  const current = bitsOf(account.userVars[id]);
  const part = partByVar.get(id);
  let given = false;
  if (part && (bit === BIT_KEPT || bit === BIT_REJECTED)) {
    const all = factBits.get(id);
    if ((current & all) !== all || has(current, BIT_KEPT) || has(current, BIT_REJECTED)) {
      return false;
    }
    if (bit === BIT_KEPT) {
      if (!dens.giveDenItem(account, part.gift)) {
        return false; // the den inventory is full: the gift stays to be had later
      }
      given = true;
    }
  }
  account.userVars[id] = (current | (1 << bit)) >>> 0;
  return given;
};

// Before this, the server kept the bit's number as the var's whole value,
// so a book var holds the last bit set and nothing more. that one bit is
// what can be had back; done once an account.
const repair = account => {
  if (account.journeyBookBits) {
    return;
  }
  for (const id of BIT_VARS) {
    const value = account.userVars[id];
    if (value !== undefined && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 31) {
      account.userVars[id] = (1 << Number(value)) >>> 0;
    }
  }
  account.journeyBookBits = true;
};

module.exports = {list, isBitVar, setBit, repair, PAGES_LIST, FACTS_LIST};
