// build-seo.mjs — regenerates the crawler-facing parts of the site from
// events.json, so search engines and link previews see the events without
// running JavaScript:
//
//   index.html   the block between <!-- seo:events:start --> and
//                <!-- seo:events:end -->: schema.org JSON-LD (WebSite +
//                ItemList of Event) and a plain <noscript> event list
//   sitemap.xml  the single-URL sitemap, lastmod = events.json "updated"
//
// Usage: node scripts/build-seo.mjs           (rewrite the files)
//        node scripts/build-seo.mjs --check   (exit 1 if they are stale — CI)
//
// Deterministic on purpose: the cut-off for "still relevant" is the
// events.json `updated` date, not the wall clock, so --check only fails when
// someone edited the data and forgot to re-run this script.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://gophercon.dev/";
const START = "<!-- seo:events:start -->";
const END = "<!-- seo:events:end -->";
const DAY = 86400000;

const bundle = JSON.parse(readFileSync(path.join(ROOT, "events.json"), "utf8"));
const ref = new Date(bundle.updated + "T00:00:00Z");

const endOf = (ev) => ev.endDate || ev.startDate;
const locsOf = (ev) => (ev.locations && ev.locations.length) ? ev.locations
  : ev.location ? [ev.location] : [];

// Same 7-day grace as the site's default view, measured from `updated`.
// Series (meetups) have no fixed date to mark up.
const relevant = bundle.events
  .filter((ev) => !ev.repeat)
  .filter((ev) => ev.status === "rescheduled" ||
    new Date(endOf(ev) + "T00:00:00Z") >= new Date(ref.getTime() - 7 * DAY))
  // rescheduled-TBD entries last (their listed date is the old one) — same
  // order as the site's upcoming block
  .sort((a, b) => (a.status === "rescheduled") - (b.status === "rescheduled") ||
    a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));

// Structured data only for events whose dates are real: tentative entries
// carry a curator estimate, and marking that up would put a made-up date in
// search results.
const markedUp = relevant.filter((ev) => ev.status !== "tentative" && locsOf(ev).length);

// Google prefers ISO 3166-1 alpha-2 in addressCountry; unknown names pass
// through unchanged (still valid schema.org text) — add new countries here.
const ISO = {
  Australia: "AU", Belgium: "BE", Brazil: "BR", China: "CN", Czechia: "CZ",
  Germany: "DE", India: "IN", Israel: "IL", Italy: "IT", Japan: "JP",
  Kenya: "KE", Russia: "RU", Singapore: "SG", Spain: "ES", UK: "GB", USA: "US",
};

function place(l) {
  if (l.region === "Online") {
    return { "@type": "VirtualLocation", url: l.url || undefined };
  }
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
      itemListElement: markedUp.map((ev, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: eventLd(ev),
      })),
    },
  ],
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dateText(ev) {
  const s = ev.startDate, e = endOf(ev);
  const range = s === e ? s : s + " – " + e;
  if (ev.status === "tentative") return "≈ " + range + " (dates tbc)";
  if (ev.status === "rescheduled") return range + " (rescheduled, new date tbd)";
  if (ev.status === "cancelled") return range + " (cancelled)";
  return range;
}

function placeText(ev) {
  const locs = locsOf(ev);
  if (!locs.length) return "location tbd";
  return locs.map((l) => [l.city, l.country].filter(Boolean).join(", ")).join(" + ");
}

// JSON inside <script>: escape "<" so no string can close the tag early.
const json = JSON.stringify(ld, null, 2).replace(/</g, "\\u003c");

const listItems = relevant.map((ev) =>
  `          <li><a href="${esc(ev.website)}">${esc(ev.title)}</a> — ` +
  `${esc(dateText(ev))} — ${esc(placeText(ev))}` +
  `${ev.scope === "track" ? " (Go track)" : ""}</li>`).join("\n");

const block = `${START}
    <script type="application/ld+json">
${json}
    </script>
    <noscript>
      <div class="static-list">
        <p class="empty">this page needs javascript to search and filter. upcoming go events:</p>
        <ul>
${listItems}
        </ul>
      </div>
    </noscript>
    ${END}`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${bundle.updated}</lastmod>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`;

const htmlPath = path.join(ROOT, "index.html");
const html = readFileSync(htmlPath, "utf8");
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) {
  console.error(`index.html: markers ${START} … ${END} not found`);
  process.exit(1);
}
const nextHtml = html.slice(0, a) + block + html.slice(b + END.length);
const sitemapPath = path.join(ROOT, "sitemap.xml");
let currentSitemap = "";
try { currentSitemap = readFileSync(sitemapPath, "utf8"); } catch { /* first run */ }

if (process.argv.includes("--check")) {
  const stale = [];
  if (nextHtml !== html) stale.push("index.html");
  if (sitemap !== currentSitemap) stale.push("sitemap.xml");
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")} — run: node scripts/build-seo.mjs`);
    process.exit(1);
  }
  console.log(`seo block up to date (${markedUp.length} events marked up, ${relevant.length} listed)`);
} else {
  writeFileSync(htmlPath, nextHtml);
  writeFileSync(sitemapPath, sitemap);
  console.log(`wrote index.html seo block (${markedUp.length} events marked up, ${relevant.length} listed) + sitemap.xml`);
}
