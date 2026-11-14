// build-site.mjs — builds the published site into a folder (default _site/).
// Usage: node scripts/build-site.mjs [outDir]
//
// Run by .github/workflows/deploy.yml on every push to main and once a day,
// so the published page is never more than a day old. Locally, plain
// `python3 -m http.server` on the repo still works: the page renders itself
// in the browser either way; the build only adds what crawlers, link
// previews and slow connections need up front.
//
// What the build adds to index.html:
//   - the event table, hero and counts already rendered — produced by
//     running the real assets/app.js against events.json in jsdom, so the
//     markup is exactly what the browser would draw. When app.js runs in the
//     browser it redraws the same rows (with the visitor's own date and any
//     filters from the URL), so nothing jumps on load.
//   - schema.org JSON-LD (WebSite + ItemList of Event) in <head>.
// And next to it: sitemap.xml (lastmod = last commit touching events.json).
//
// Only site files are published (index.html, events.json, assets/,
// robots.txt, CNAME) — not the README, tests, scripts, package files or the
// previews/ mockups.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "_site"));
const SITE = "https://gophercon.dev/";
const DAY = 86400000;

const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const eventsText = read("events.json");
const bundle = JSON.parse(eventsText);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const isoDay = (d) => d.toISOString().slice(0, 10);

// ---------- prerender: run the real app.js in jsdom ----------

async function prerender() {
  const dom = new JSDOM(read("index.html"), { url: SITE, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = async (u) => {
    if (u !== "events.json") throw new Error("unexpected fetch: " + u);
    return { ok: true, status: 200, json: async () => JSON.parse(eventsText) };
  };
  w.eval(read("assets/app.js"));
  const doc = w.document;
  for (let i = 0; i < 50 && !doc.querySelector(".evt") && doc.getElementById("empty").hidden; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const err = doc.getElementById("load-error");
  if (!err.hidden) throw new Error("app.js failed while prerendering: " + err.textContent);
  if (!doc.querySelector(".evt")) throw new Error("prerender produced no event rows");
  // the live region starts empty in the browser too; never ship an announcement
  doc.getElementById("sr-status").textContent = "";
  const html = dom.serialize();
  const rows = doc.querySelectorAll(".evt").length;
  w.close();
  return { html, rows };
}

// ---------- JSON-LD ----------

const endOf = (ev) => ev.endDate || ev.startDate;
const locsOf = (ev) => (ev.locations && ev.locations.length) ? ev.locations
  : ev.location ? [ev.location] : [];

// Same window as the site's default view: upcoming plus the last 7 days.
// Series (meetups) have no fixed date to mark up. Tentative entries carry a
// curator estimate — marking that up would put a made-up date in search.
const markedUp = bundle.events
  .filter((ev) => !ev.repeat && ev.status !== "tentative" && locsOf(ev).length)
  .filter((ev) => ev.status === "rescheduled" ||
    new Date(endOf(ev) + "T00:00:00Z") >= new Date(today.getTime() - 7 * DAY))
  // rescheduled-TBD last (their listed date is the old one), as on the page
  .sort((a, b) => (a.status === "rescheduled") - (b.status === "rescheduled") ||
    a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));

// Google prefers ISO 3166-1 alpha-2 in addressCountry; unknown names pass
// through unchanged (still valid schema.org text) — add new countries here.
const ISO = {
  Australia: "AU", Belgium: "BE", Brazil: "BR", China: "CN", Czechia: "CZ",
  Germany: "DE", India: "IN", Israel: "IL", Italy: "IT", Japan: "JP",
  Kenya: "KE", Russia: "RU", Singapore: "SG", Spain: "ES", UK: "GB", USA: "US",
};

function place(l) {
  if (l.region === "Online") return { "@type": "VirtualLocation", url: l.url || undefined };
  return {
    "@type": "Place",
    name: [l.city, l.country].filter(Boolean).join(", "),
    address: {
      "@type": "PostalAddress",
      addressLocality: l.city || undefined,
      addressCountry: ISO[l.country] || l.country || undefined,
    },
  };
}

function eventLd(ev) {
  const locs = locsOf(ev);
  const online = locs.filter((l) => l.region === "Online").length;
  const mode = online === 0 ? "OfflineEventAttendanceMode"
    : online === locs.length ? "OnlineEventAttendanceMode" : "MixedEventAttendanceMode";
  const status = ev.status === "cancelled" ? "EventCancelled"
    : ev.status === "rescheduled" ? "EventPostponed"
    : ev.rescheduledFrom ? "EventRescheduled" : "EventScheduled";
  const out = {
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    startDate: ev.startDate,
    endDate: endOf(ev),
    eventStatus: "https://schema.org/" + status,
    eventAttendanceMode: "https://schema.org/" + mode,
    location: locs.length === 1 ? place(locs[0]) : locs.map(place),
    url: ev.website,
  };
  if (ev.rescheduledFrom) out.previousStartDate = ev.rescheduledFrom;
  return out;
}

const ld = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": SITE + "#website",
      name: "gophercon.dev",
      url: SITE,
      description: "A curated list of upcoming Go (Golang) conferences and community events worldwide.",
      inLanguage: "en",
    },
    {
      "@type": "ItemList",
      name: "Upcoming Go conferences and events",
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      numberOfItems: markedUp.length,
      itemListElement: markedUp.map((ev, i) => ({ "@type": "ListItem", position: i + 1, item: eventLd(ev) })),
    },
  ],
};
// JSON inside <script>: escape "<" so no string can close the tag early
const jsonLd = `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;

// ---------- sitemap ----------

// lastmod = when the event data last changed, from git; today if git (or
// the history, in a shallow clone) isn't available.
function dataChanged() {
  try {
    const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", "events.json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch { /* no git */ }
  return isoDay(today);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${dataChanged()}</lastmod>
  </url>
</urlset>
`;

// ---------- write ----------

const MARKER = /^[ \t]*<!-- build:jsonld [^>]*-->[ \t]*$/m;
const { html, rows } = await prerender();
if (!MARKER.test(html)) throw new Error("index.html: <!-- build:jsonld … --> marker not found");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "index.html"), html.replace(MARKER, "  " + jsonLd));
writeFileSync(path.join(OUT, "sitemap.xml"), sitemap);
for (const f of ["events.json", "robots.txt", "CNAME"]) cpSync(path.join(ROOT, f), path.join(OUT, f));
cpSync(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });

console.log(`built ${path.relative(process.cwd(), OUT) || "."}: ${rows} rows prerendered, ` +
  `${markedUp.length} events in JSON-LD, as of ${isoDay(today)}`);
