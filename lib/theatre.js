"use strict";

const {logText} = require("./logtext.js");
const theatreVideos = require("./theatrevideos.js");

// what each theatre plays, and what waits to play after it: kept by room
// name ("path.name#shard"), so it outlasts the room being empty (lib/world.js
// lets an empty room go) and someone walking in finds it where it is.
// staff run it in the game's theatre box (the "xtv" handler in lib/world.js)
// and on the moderator panel's Theatre page (lib/modpanel.js).
//
// an entry is {kind: "file", id, name} (lib/theatrevideos.js) or {kind:
// "youtube", id, name}. a file goes on to the next entry when it is over;
// YouTube's length is not known here, so a YouTube video plays until staff
// skip it or stop it.

const MAX_QUEUE = 50;
const YOUTUBE = /^(?:[A-Za-z0-9_-]{11}|(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?)$/i;
// a little after the file's end, so the last frames are seen everywhere
const END_GRACE_MS = 1500;

const theatres = new Map(); // room name -> {title, playing: entry + {startedAt, lengthMs} | null, queue: [entry]}
// (room name) when what plays changes (not the queue, which the screen does
// not show): lib/world.js tells the people in the room
let changed = () => {};

// the entry staff mean by what they typed: a theatre video's name, or a
// YouTube link or id. null for neither.
const entryFor = text => {
  const typed = String(text || "").trim();
  const file = theatreVideos.find(typed);
  if (file) {
    return {kind: "file", id: file.id, name: file.name};
  }
  const match = YOUTUBE.exec(typed);
  return match ? {kind: "youtube", id: match[1] || typed, name: `YouTube ${match[1] || typed}`} : null;
};

const theatreOf = (room, title = "") => {
  let theatre = theatres.get(room);
  if (!theatre) {
    theatre = {title, playing: null, queue: [], timer: null};
    theatres.set(room, theatre);
  }
  if (title) {
    theatre.title = title;
  }
  return theatre;
};

// a theatre with nothing playing and nothing waiting is forgotten
const tidy = room => {
  const theatre = theatres.get(room);
  if (theatre && !theatre.playing && !theatre.queue.length) {
    theatres.delete(room);
  }
};

const start = (room, theatre, entry) => {
  clearTimeout(theatre.timer);
  theatre.timer = null;
  if (!entry) {
    theatre.playing = null;
    changed(room);
    tidy(room);
    return;
  }
  // a file deleted or changed since it was queued is passed over
  if (entry.kind === "file" && !theatreVideos.byId(entry.id)) {
    console.log(`[theatre] "${logText(entry.name)}" is no longer there; skipped`);
    start(room, theatre, theatre.queue.shift());
    return;
  }
  const lengthMs = entry.kind === "file" ? theatreVideos.lengthOf(entry.id) : null;
  theatre.playing = {...entry, startedAt: Date.now(), lengthMs};
  if (lengthMs) {
    theatre.timer = setTimeout(() => start(room, theatre, theatre.queue.shift()), lengthMs + END_GRACE_MS);
  }
  changed(room);
};

// what the theatre's page (public/game.html, ajTheatreVideo) is told plays
// on the screen: a YouTube id, "file:<id>:<ms in>" (how far in it is now,
// so everyone sees the same part, whenever they came in), "" for nothing,
// or null when this room has never had a theatre video.
const screenText = room => {
  const theatre = theatres.get(room);
  if (!theatre) {
    return null;
  }
  const {playing} = theatre;
  if (!playing) {
    return "";
  }
  if (playing.kind === "youtube") {
    return playing.id;
  }
  return theatreVideos.byId(playing.id) ? `file:${playing.id}:${Date.now() - playing.startedAt}` : "";
};

// played now, in place of what plays; what waits plays after it.
const play = (room, title, entry) => {
  start(room, theatreOf(room, title), entry);
};

// nothing plays; what waits stays, until staff skip to it or play something
const stop = room => {
  const theatre = theatres.get(room);
  if (theatre) {
    start(room, theatre, null);
  }
};

// to the end of the queue (played at once when nothing plays):
// {ok} or {error}.
const enqueue = (room, title, entry) => {
  const theatre = theatreOf(room, title);
  if (theatre.queue.length >= MAX_QUEUE) {
    return {error: `The queue is full (${MAX_QUEUE} videos).`};
  }
  if (!theatre.playing) {
    start(room, theatre, entry);
    return {ok: `"${entry.name}" is playing.`};
  }
  theatre.queue.push(entry);
  return {ok: `"${entry.name}" is number ${theatre.queue.length} in the queue.`};
};

// on to the next in the queue, or nothing when it is empty
const skip = room => {
  const theatre = theatres.get(room);
  if (theatre) {
    start(room, theatre, theatre.queue.shift());
  }
};

// queue entry `index` taken out, or moved `by` places: true when done
const remove = (room, index) => {
  const theatre = theatres.get(room);
  if (!theatre || !Number.isInteger(index) || !theatre.queue[index]) {
    return false;
  }
  theatre.queue.splice(index, 1);
  tidy(room);
  return true;
};
const move = (room, index, by) => {
  const theatre = theatres.get(room);
  const to = index + by;
  if (!theatre || !Number.isInteger(index) || !theatre.queue[index] || !theatre.queue[to]) {
    return false;
  }
  [theatre.queue[index], theatre.queue[to]] = [theatre.queue[to], theatre.queue[index]];
  return true;
};
const clear = room => {
  const theatre = theatres.get(room);
  if (!theatre) {
    return;
  }
  theatre.queue = [];
  tidy(room);
};

// for the moderator panel: each theatre with something playing or waiting
const list = () => [...theatres].map(([room, {title, playing, queue}]) => ({
  room, title,
  playing: playing ? {kind: playing.kind, name: playing.name, inMs: Date.now() - playing.startedAt, lengthMs: playing.lengthMs} : null,
  queue: queue.map(({kind, name}) => ({kind, name})),
}));

// lib/world.js: (room name) when what a theatre plays changes
const onChange = listener => {
  changed = listener;
};

module.exports = {MAX_QUEUE, entryFor, screenText, play, stop, enqueue, skip, remove, move, clear, list, onChange};
