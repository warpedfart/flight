"use strict";

const accounts = require("./accounts.js");

// a colour the admin puts on a player's animal, as the game's mud, ice,
// fire and acid put one on whoever stands in them (AvatarManager.
// processPlayerSplashColor). in the game it fades once they step out; one
// put on here stays until the admin takes it off.
//
// the client tints its own animal and tells the room by a chat line of type
// 8, "<alpha << 24 | rgb>" (UserCommXtCommManager.sendAvatarBlendColor),
// which the others draw (AvatarManager._setAvatarBlendColor). a tinted
// player's client still works out its own colour as they walk in and out
// of the game's mud, and says so: the server answers each time with the
// tint, to them and everyone else, so it never fades. no change to the SWF.

// the game's own colours, and how strongly each is laid on at most
const TINTS = {
  mud: {color: 0x5C4033, level: 255},
  ice: {color: 0x90CCFF, level: 200},
  fire: {color: 0xAA0000, level: 200},
  acid: {color: 0x4DFE15, level: 200},
};
const BLEND_CHAT = "8";

const of = account => (account && Object.hasOwn(TINTS, account.tint) ? account.tint : "");

// the blend colour the client reads (uint(), so the int it wraps to will do)
const blendOf = name => (name ? String((TINTS[name].level << 24 | TINTS[name].color) | 0) : "0");

// tells `to` of the tint on `subject` (a session whose animal `to` has just
// been told of, or has on screen), if it has one.
const show = (to, subject) => {
  const name = of(subject.account);
  if (name && subject.room) {
    to.sendXt("uc", subject.room.id, subject.id, blendOf(name), BLEND_CHAT);
  }
};

// puts a tint on (a name above) or takes it off (""). `viewers` (session)
// -> the sessions that see this one's animal, and the session itself, are
// told at once when the player is in a room.
const set = (account, name, session, viewers) => {
  if (name && !Object.hasOwn(TINTS, name)) {
    return false;
  }
  account.tint = name || "";
  accounts.save(account);
  if (session && session.room && session.pos) {
    for (const to of [session, ...viewers(session)]) {
      to.sendXt("uc", session.room.id, session.id, blendOf(name), BLEND_CHAT);
    }
  }
  return true;
};

module.exports = {of, show, set, BLEND_CHAT};
