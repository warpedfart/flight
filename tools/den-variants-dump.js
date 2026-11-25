"use strict";
const defpacks = require("../lib/defpacks.js");
const variants = require("../lib/denvariants.js");
(async () => {
  await defpacks.init();
  const groupOf = variants.build();
  const groups = new Set(groupOf.values());
  const offered = new Set(defpacks.denItemIds());
  for (const ids of groups) {
    console.log(ids.map(id => `${id}:${defpacks.denItemDef(id).abbrName}`).join("  "));
  }
  console.log(`${groups.size} groups\n\n--- ungrouped items right next to a group (possible missing variants) ---`);
  for (const ids of groups) {
    const near = new Set();
    for (const id of ids) {
      for (let step = -2; step <= 2; step++) {
        if (step && !groupOf.has(id + step) && defpacks.denItemDef(id + step)) {
          near.add(id + step);
        }
      }
    }
    if (near.size) {
      const list = [...near].sort((a, b) => a - b)
        .map(id => `${id}:${defpacks.denItemDef(id).abbrName}${offered.has(id) ? "" : " (not offered)"}`);
      console.log(`${ids[0]}:${defpacks.denItemDef(ids[0]).abbrName}  <-  ${list.join("  ")}`);
    }
  }
})();