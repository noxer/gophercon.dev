// check-links.mjs — validates every URL referenced in events.json.
// Usage: node scripts/check-links.mjs   (exits 1 if anything is broken)
//
// Checks: event websites, additional links, and location map urls.
// Reports HTTP status and TLS/lookup errors so stale curation is caught
// before it shows up on the site.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = JSON.parse(readFileSync(path.join(ROOT, "events.json"), "utf8"));

const urls = new Map(); // url -> [who references it]
for (const ev of bundle.events) {
  const add = (url, where) => {
    if (!url) return;
    if (!urls.has(url)) urls.set(url, []);
    urls.get(url).push(where);
  };
  add(ev.website, ev.id);
  for (const l of ev.links || []) add(l.url, `${ev.id} (${l.label})`);
  for (const [i, loc] of (ev.locations || []).entries()) add(loc.url, `${ev.id} (location ${i + 1})`);
}

const BLOCKED = new Set([403, 406, 429, 503]); // bot walls: likely fine for humans

const results = await Promise.allSettled(
  [...urls.keys()].map(async (url) => {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "gophercon.dev link check (https://gophercon.dev)" },
    });
    return [url, res.status >= 400
      ? (BLOCKED.has(res.status) ? `blocked HTTP ${res.status}` : `HTTP ${res.status}`)
      : "ok"];
  })
);

let broken = 0, warned = 0;
for (let i = 0; i < results.length; i++) {
  const url = [...urls.keys()][i];
  const r = results[i];
  const status = r.status === "fulfilled" ? r.value[1] : `FAIL: ${r.reason?.cause?.code || r.reason?.message || r.reason}`;
  if (status !== "ok" && !status.startsWith("blocked")) {
    broken++;
    console.log(`BROKEN ${status}  ${url}   <- ${urls.get(url).join(", ")}`);
  } else if (status.startsWith("blocked")) {
    warned++;
    console.log(`BLOCKED ${status}  ${url}   <- ${urls.get(url).join(", ")} (bot wall; verify by hand)`);
  }
}
console.log(broken === 0
  ? `all ${urls.size} urls resolve (${warned} bot-blocked warnings)`
  : `${broken}/${urls.size} urls broken`);
process.exit(broken === 0 ? 0 : 1);
