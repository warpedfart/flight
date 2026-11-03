"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "public");
const css = fs.readFileSync(path.join(dir, "theme.css"), "utf8").trim();
if (css.includes("</style")) throw new Error("theme.css must not contain </style");

const block = `<style id="dove-theme">\n${css}\n    </style>`;
const LINK = /<link rel="stylesheet" href="\/theme\.css">/;
const BLOCK = /<style id="dove-theme">[\s\S]*?<\/style>/;

let changed = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const file = path.join(dir, name);
    const html = fs.readFileSync(file, "utf8");
    let out = html;
    if (BLOCK.test(html)) out = html.replace(BLOCK, () => block);
    else if (LINK.test(html)) out = html.replace(LINK, () => block);
    else { console.log(`skip     ${name} (no theme link)`); continue; }
    if (out !== html) { fs.writeFileSync(file, out); changed++; console.log(`updated  ${name}`); }
    else console.log(`same     ${name}`);
}
console.log(`${changed} page(s) changed`);