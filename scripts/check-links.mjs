// check-links.mjs — validates every URL referenced in events.json.
// Usage: node scripts/check-links.mjs   (exits 1 if anything is broken)
//
// Checks: event websites, additional links, and location map urls.
// Reports HTTP status and TLS/lookup errors so stale curation is caught
// before it shows up on the site. Transient failures (connection errors,
// 5xx) are retried a few times — a dead URL is curation news, a flaky
// network is not, and CI should only red-flag the first.
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
const ATTEMPTS = 3;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// one probe with retries: network errors and 5xx get ATTEMPTS tries with
// a growing backoff; 4xx (real dead links) and bot walls fail fast.
async function probe(url) {
  let last = "FAIL: unknown";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "gophercon.dev link check (https://gophercon.dev)" },
      });
      if (res.status < 400) return attempt > 1 ? `ok (after ${attempt} tries)` : "ok";
      if (BLOCKED.has(res.status)) return `blocked HTTP ${res.status}`;
      last = `HTTP ${res.status}`;
      if (res.status < 500) return last; // 4xx: definitive, don't retry
    } catch (e) {
      last = `FAIL: ${e?.cause?.code || e?.message || e}`;
    }
    if (attempt < ATTEMPTS) await nap(attempt * 2500 + Math.random() * 1000);
  }
  return `${last} (after ${ATTEMPTS} tries)`;
}

const results = await Promise.allSettled(
  [...urls.keys()].map((url) => probe(url).then((status) => [url, status]))
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
