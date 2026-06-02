// CI gate: the production CSP must NOT weaken script-src with unsafe-eval/unsafe-inline.
// Babel/CDN was dropped in the port, so the only injection -> IPC path is script eval;
// keeping script-src tight is a security invariant (secret_get is never exposed to JS).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const csp = conf?.app?.security?.csp ?? "";

const scriptSrc = csp
  .split(";")
  .map((d) => d.trim())
  .find((d) => d.startsWith("script-src"));

const fail = (msg) => {
  console.error(`CSP assertion FAILED: ${msg}`);
  console.error(`  csp = ${csp}`);
  process.exit(1);
};

if (!scriptSrc) fail("no script-src directive found");
if (/unsafe-eval/.test(scriptSrc)) fail("script-src contains 'unsafe-eval'");
if (/unsafe-inline/.test(scriptSrc)) fail("script-src contains 'unsafe-inline'");

console.log(`CSP OK: ${scriptSrc}`);
