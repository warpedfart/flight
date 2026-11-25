"use strict";

const defpacks = require("./defpacks.js");

let manual = {groups: [], separate: []};
try {
  manual = require("./den-variants.json");
}
catch (err) {
}

const COLOURS = new Set(("red yellow green blue purple pink black white brown gray grey teal cyan gold "
  + "silver aqua violet magenta turquoise maroon beige lavender").split(" "));
const AMBIGUOUS = new Set("orange peach lime coral mint cream tan navy".split(" "));
const NEAR = 10;

const wordsOf = abbr => String(abbr).match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || [];
const partsOf = abbr => {
  const words = wordsOf(abbr);
  const isColour = (word, at) => COLOURS.has(word.toLowerCase()) || (AMBIGUOUS.has(word.toLowerCase()) && at === words.length - 1);
  return {
    stem: words.filter((word, at) => !isColour(word, at)).join(""),
    colours: words.filter((word, at) => isColour(word, at)),
  };
};

const build = () => {
  const usable = defpacks.denItemIds().filter(id => {
    const def = defpacks.denItemDef(id);
    return def && def.abbrName && def.typeCat !== "4" && String(def.gameDefId || "0") === "0";
  }).sort((one, other) => one - other);
  const parent = new Map(usable.map(id => [id, id]));
  const alone = new Set((manual.separate || []).map(Number));
  const find = id => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (one, other) => {
    if (parent.has(one) && parent.has(other)) {
      parent.set(find(one), find(other));
    }
  };
  const autoUnion = (one, other) => {
    if (!alone.has(one) && !alone.has(other)) {
      union(one, other);
    }
  };

  const exact = new Map();
  const stems = new Map();
  for (const id of usable) {
    const def = defpacks.denItemDef(id);
    const where = `${def.sortCat}|${def.typeCat}`;
    const exactKey = `${def.abbrName}|${where}`;
    if (exact.has(exactKey)) {
      autoUnion(exact.get(exactKey), id);
    }
    else {
      exact.set(exactKey, id);
    }
    const {stem, colours} = partsOf(def.abbrName);
    if (stem.length >= 3) {
      const stemKey = stem;
      const entry = stems.get(stemKey) || {coloured: null, plain: []};
      if (colours.length) {
        if (entry.coloured !== null) {
          autoUnion(entry.coloured, id);
        }
        else {
          entry.coloured = id;
        }
        for (const plain of entry.plain) {
          if (Math.abs(plain - id) <= NEAR) {
            autoUnion(plain, id);
          }
        }
      }
      else {
        if (entry.coloured !== null && Math.abs(entry.coloured - id) <= NEAR) {
          autoUnion(entry.coloured, id);
        }
        entry.plain.push(id);
      }
      stems.set(stemKey, entry);
    }
  }
  for (const group of manual.groups || []) {
    for (let at = 1; at < group.length; at++) {
      union(Number(group[0]), Number(group[at]));
    }
  }

  const byRoot = new Map();
  for (const id of usable) {
    const root = find(id);
    byRoot.set(root, [...(byRoot.get(root) || []), id]);
  }
  const groupOf = new Map();
  for (const ids of byRoot.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        groupOf.set(id, ids);
      }
    }
  }
  return groupOf;
};

const label = id => {
  const def = defpacks.denItemDef(id);
  if (!def) {
    return String(id);
  }
  return defpacks.string(def.nameStrId) || partsOf(def.abbrName).colours.join(" ") || def.abbrName;
};

module.exports = {build, label};