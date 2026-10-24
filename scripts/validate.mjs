// validate.mjs — offline sanity checks for events.json.
// Usage: node scripts/validate.mjs   (exits 1 if anything is wrong)
//
// Catches malformed entries before the site renders them wrong: required
// fields, real YYYY-MM-DD dates, endDate >= startDate, unique ids, known
// enum values, and https-only URLs. No network — check-links.mjs covers
// whether the URLs actually resolve.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = JSON.parse(readFileSync(path.join(ROOT, "events.json"), "utf8"));

// keep in sync with the README and the schema object in events.json
const REGIONS = new Set(["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Online"]);
const TYPES = new Set(["conference", "community", "meetup"]);
const STATUSES = new Set(["cancelled", "rescheduled", "tentative"]);
const SCOPES = new Set(["track"]);

const errors = [];
const fail = (who, msg) => errors.push(`${who}: ${msg}`);

// a real calendar date, not just the right shape (rejects 2027-02-30)
function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function checkURL(who, field, url) {
  try {
    if (new URL(url).protocol !== "https:") fail(who, `${field} is not https: ${url}`);
  } catch {
    fail(who, `${field} is not a valid URL: ${url}`);
  }
}

function checkString(who, ev, field) {
  if (typeof ev[field] !== "string" || !ev[field].trim()) fail(who, `missing ${field}`);
}

if (!Array.isArray(bundle.events)) {
  console.log("events.json: top-level \"events\" array missing");
  process.exit(1);
}
if (!isDate(bundle.updated)) fail("events.json", `"updated" is not a YYYY-MM-DD date: ${bundle.updated}`);

const ids = new Set();
for (const [i, ev] of bundle.events.entries()) {
  const who = ev.id || `events[${i}]`;

  if (typeof ev.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ev.id)) {
    fail(who, "id must be a lowercase slug (a-z, 0-9, dashes)");
  } else if (ids.has(ev.id)) {
    fail(who, "duplicate id");
  }
  ids.add(ev.id);

  checkString(who, ev, "title");
  checkString(who, ev, "description");

  if (!isDate(ev.startDate)) fail(who, `startDate is not a YYYY-MM-DD date: ${ev.startDate}`);
  if (ev.endDate !== undefined) {
    if (!isDate(ev.endDate)) fail(who, `endDate is not a YYYY-MM-DD date: ${ev.endDate}`);
    else if (isDate(ev.startDate) && ev.endDate < ev.startDate) fail(who, "endDate is before startDate");
  }
  if (ev.rescheduledFrom !== undefined && !isDate(ev.rescheduledFrom)) {
    fail(who, `rescheduledFrom is not a YYYY-MM-DD date: ${ev.rescheduledFrom}`);
  }
  if (ev.cfpDeadline !== undefined && !isDate(ev.cfpDeadline)) {
    fail(who, `cfpDeadline is not a YYYY-MM-DD date: ${ev.cfpDeadline}`);
  }

  if (!TYPES.has(ev.type)) fail(who, `unknown type: ${ev.type}`);
  if (ev.status !== undefined && !STATUSES.has(ev.status)) fail(who, `unknown status: ${ev.status}`);
  if (ev.scope !== undefined && !SCOPES.has(ev.scope)) fail(who, `unknown scope: ${ev.scope}`);
  if (ev.unverified !== undefined && ev.unverified !== true) fail(who, "unverified must be true or absent");

  if (ev.repeat !== undefined) {
    const r = ev.repeat;
    if (!r || r.freq !== "monthly") fail(who, "repeat.freq must be \"monthly\"");
    if (r && (r.weekday !== undefined || r.week !== undefined)) {
      if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) fail(who, "repeat.weekday must be 0..6");
      if (!Number.isInteger(r.week) || r.week === 0 || Math.abs(r.week) > 5) fail(who, "repeat.week must be ±1..5");
    }
  }

  if (typeof ev.website !== "string") fail(who, "missing website");
  else checkURL(who, "website", ev.website);

  // v1 data used a single "location" object; v2+ uses "locations"
  const locs = ev.locations || (ev.location ? [ev.location] : []);
  if (!Array.isArray(locs) || (locs.length === 0 && ev.status !== "tentative")) {
    fail(who, "needs at least one location");
  }
  for (const [j, loc] of (Array.isArray(locs) ? locs : []).entries()) {
    const lw = `${who} (location ${j + 1})`;
    if (typeof loc.city !== "string" || !loc.city.trim()) fail(lw, "missing city");
    if (!REGIONS.has(loc.region)) fail(lw, `unknown region: ${loc.region}`);
    if (loc.url !== undefined) checkURL(lw, "url", loc.url);
  }

  for (const [j, link] of (ev.links || []).entries()) {
    const lw = `${who} (link ${link.label || j + 1})`;
    if (typeof link.label !== "string" || !link.label.trim()) fail(lw, "missing label");
    if (typeof link.url !== "string") fail(lw, "missing url");
    else checkURL(lw, "url", link.url);
    for (const f of ["startsAt", "endsAt"]) {
      if (link[f] !== undefined && !isDate(link[f])) fail(lw, `${f} is not a YYYY-MM-DD date: ${link[f]}`);
    }
    if (isDate(link.startsAt) && isDate(link.endsAt) && link.endsAt < link.startsAt) {
      fail(lw, "endsAt is before startsAt");
    }
  }
}

for (const e of errors) console.log(`INVALID ${e}`);
console.log(errors.length === 0
  ? `all ${bundle.events.length} events valid`
  : `${errors.length} problem${errors.length === 1 ? "" : "s"} in events.json`);
process.exit(errors.length === 0 ? 0 : 1);
