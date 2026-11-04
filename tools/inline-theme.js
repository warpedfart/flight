"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "public");
const css = fs.readFileSync(path.join(dir, "theme.css"), "utf8").trim();
const js = fs.readFileSync(path.join(dir, "theme-toggle.js"), "utf8").trim();
if (css.includes("</style")) throw new Error("theme.css must not contain </style");
if (js.includes("</script")) throw new Error("theme-toggle.js must not contain </script");

const block = `<style id="dove-theme">\n${css}\n    </style>`;
const LINK = /<link rel="stylesheet" href="\/theme\.css">/;
const BLOCK = /<style id="dove-theme">[\s\S]*?<\/style>/;

const BUTTON = `<button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode"><svg class="moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg></button>`;
const NAV = /<nav\b[^>]*\bid="nav"[\s\S]*?<\/nav>/i;
const UNWRAP = /<div id="topbar">\s*(<nav\b[\s\S]*?<\/nav>)\s*<\/div>/i;
const BUTTON_ANY = /[ \t]*<button[^>]*class="theme-toggle"[^>]*>[\s\S]*?<\/button>[ \t]*\n?/g;
const SCRIPT = `<script id="theme-toggle-js">\n${js}\n    </script>`;
const SCRIPT_ANY = /[ \t]*(?:<script src="\/theme-toggle\.js"><\/script>|<script id="theme-toggle-js">[\s\S]*?<\/script>)[ \t]*\n?/g;
const FEATURES = /[ \t]*<a\b[^>]*>\s*Features\s*<\/a>[ \t]*\n?/gi;

let changed = 0;
for (const name of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
  const file = path.join(dir, name);
  const html = fs.readFileSync(file, "utf8");
  let out = html;

  if (BLOCK.test(out)) out = out.replace(BLOCK, () => block);
  else if (LINK.test(out)) out = out.replace(LINK, () => block);
  else { console.log(`skip     ${name} (no theme link or block)`); continue; }

  out = out.replace(FEATURES, "");

  out = out.replace(BUTTON_ANY, "");
  out = out.replace(UNWRAP, (match, nav) => nav);
  if (NAV.test(out)) out = out.replace(NAV, nav => `<div id="topbar">\n    ${nav}\n    ${BUTTON}\n    </div>`);
  else out = out.replace(/<body[^>]*>/i, match => `${match}\n    ${BUTTON}`);

  out = out.replace(SCRIPT_ANY, "");
  out = out.replace(/<\/head>/i, () => `    ${SCRIPT}\n  </head>`);

  out = out.replace('document.documentElement.className = "js";', 'document.documentElement.classList.add("js");');
  out = out.replace('href="#/register"', 'href="/register"');
  out = out.replace('const button = $("get-button");', 'const button = $("get-button") || document.createElement("a");');

  if (out !== html) { fs.writeFileSync(file, out); changed++; console.log(`updated  ${name}`); }
  else console.log(`same     ${name}`);
}
console.log(`${changed} page(s) changed`);