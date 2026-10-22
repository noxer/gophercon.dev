# gophercon.dev

A small static website that lists Go-related events (conferences and community
events) around the world, with search, filters, and automatic hiding of events
that ended more than a week ago.

Design: terminal/console aesthetic — dark Go-navy, system monospace, ISO dates
with relative day offsets (`+10d`), and keyboard-driven navigation. No build
step, no webfonts, no dependencies — plain files, served over http.

## Files

| File                | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `index.html`        | Page markup                                         |
| `events.json`       | **The event data** — edit this to add/update events |
| `assets/styles.css` | Terminal styling (dark Go-navy, monospace)          |
| `assets/app.js`     | Fetches `events.json`, renders, filters, keyboard nav |
| `scripts/check-links.mjs` | URL validator for every link in `events.json` |
| `.github/`          | Issue forms (suggestions/changes) + monthly link-check CI |
| `previews/`         | Static design mockups from the exploration phase — delete before deploying if you like |

The site fetches `events.json` at runtime, so browsers block it when the page
is opened via `file://`. For local development, serve the folder:

```sh
python3 -m http.server 8000    # then open http://localhost:8000
```

## Managing the list

All content lives in **`events.json`** — no database, no CMS. The site fetches
it at runtime, so an edit to the file is live as soon as it's deployed. The
file is self-describing: it carries a `schema` object with the field
definitions inside it, plus `version`, `updated` (set this when you change
data), `source`, and `license`.

```jsonc
{
  "id": "gophercon-example-2027",      // unique slug, never reuse
  "title": "GopherCon Example 2027",
  "description": "One or two short sentences.",
  "startDate": "2027-05-12",           // YYYY-MM-DD
  "endDate": "2027-05-14",             // optional, defaults to startDate
  "locations": [                       // one entry per location
    { "city": "Exampleville", "country": "Exampleland", "region": "Europe",
      "url": "https://www.openstreetmap.org/way/12345" },      // optional map link
    { "city": "Online", "country": "", "region": "Online" }   // hybrid event
  ],
  // region: Africa | Asia | Europe | North America | South America | Oceania | Online
  "type": "conference",                // conference | community | workshop | meetup | online
  "status": "cancelled",               // optional: cancelled | rescheduled | tentative — see below
  "rescheduledFrom": "2027-04-14",     // optional: old startDate after any date move
  "scope": "track",                    // optional: broader conference with a Go track/devroom
  "website": "https://example.org/",   // the one "main" link
  "links": [                           // dated links get status annotations
    { "label": "CFP",             "url": "https://cfp.example.org/",
      "startsAt": "2026-11-01", "endsAt": "2027-01-15" },     // "opens …" / "closes …"
    { "label": "Pre-registration","url": "https://example.org/pre",
      "endsAt": "2027-04-30" },                               // "closes 2027-04-30"
    { "label": "Schedule",        "url": "https://example.org/schedule" } // undated
  ]
}
```

Housekeeping rules:

- **Order doesn't matter** — the app sorts by date itself.
- **One entry per edition** (`golab-2026`, `golab-2027`, …); when a new
  edition is announced, add a new entry, don't mutate the old one.
- **Multiple locations**: `locations` is an array — multi-city events and
  hybrid events (add a `{ city: "Online", region: "Online" }` entry). The
  location column shows the first plus `+N more`; search and the region
  filter match *any* of the locations.
- **Maps & venues**: give a location a `url` to link it — prefer an
  [OpenStreetMap](https://www.openstreetmap.org) link (search the venue,
  copy its way/node URL); OpenStreetMap links render with a `⌖` marker
  (`Berlin, Germany ⌖ · Europe`), any other URL renders as a normal
  `↗` link. The venue's *website* belongs in `links[]` as a
  `{ "label": "Venue", "url": "…" }` chip — so every row offers map and
  venue page in one click each.
- **Link windows**: any link can carry `startsAt`/`endsAt`. The site
  annotates them automatically — `· opens 2026-11-01` (until it starts),
  `· closes 2027-01-15` (while open, in amber), `· closed …` (dimmed).
  Works for CFPs, pre-registration, ticket sales — anything with a window.
- **Cancellations**: set `"status": "cancelled"` on the edition entry. The
  row stays in the list struck through with an `✕ cancelled` tag until one
  week after the scheduled end (so people who planned to attend learn about
  it), and the "next up" countdown skips it. (The official Go wiki strikes
  through cancelled entries; this mirrors it.)
- **Date moves (either direction — postponed or pulled forward)**: edit
  `startDate`/`endDate` to the new truth and set
  `"rescheduledFrom": "<original startDate>"`; the row tags itself
  `↝ rescheduled from 2027-04-14`. The term is direction-neutral on purpose:
  "postponed" only means *later*, and "moved up" ambiguously means *earlier*.
- **Postponed, new date unknown**: `"status": "rescheduled"` — tag
  `↝ rescheduled — new date tbd`, countdown skips it, and it never
  auto-hides, so attendees waiting for the new dates aren't left staring at
  a missing entry. When dates land, replace the status with real dates +
  `rescheduledFrom`; if it dies, switch to `cancelled`.
- **Announced, dates TBD**: `"status": "tentative"` + a curator *estimate*
  for the dates (typically the month of prior editions — e.g. GopherCon
  2027 is estimated early August). Renders as `≈ 2027-08-02` with `tbc` in
  the relative column and an `↻ dates tbc` tag; it still sorts and counts.
  Replace the estimate with real dates as soon as they're announced.
  (Partial-precision dates like `"2027-07"` were rejected: they break
  sorting, day-offsets and the hide-window arithmetic.)
- **Go track vs Go-focused**: an event that is *not* a Go event but has a
  dedicated Go track/devroom (FOSDEM is the archetype) gets
  `"scope": "track"`. It renders a dashed-border `◐ go track` tag — the
  half-full glyph reads "partly Go" — and the `go:` dropdown filters
  `all | dedicated | go-track`. Absent `scope` = Go-focused event; that's
  the majority, so most entries never mention it. The description should
  make the track explicit ("Go talks inside a bigger conference").
- **New regions/types need no code** — filter dropdowns are generated from
  whatever values appear in the file.
- Old editions hide themselves: entries that ended over a week ago drop out
  of the default view automatically and stay available via the past toggle.
- **v1 compatibility**: old data using a single `location` object or a
  top-level `cfpDeadline` still renders (the fields are normalized at load).
- Validate after editing: `python3 -m json.tool events.json` for syntax, and
  `node scripts/check-links.mjs` to verify every event website, extra link
  and location map URL still resolves (reports HTTP/TLS/DNS failures and
  bot-wall warnings). Run it in CI too — domains go stale.

The data is seeded from the [official Go conference list](https://go.dev/wiki/Conferences)
plus event websites. Keep it roughly in sync as editions are announced —
check the wiki once a month, or wire up automation (a scheduled GitHub Action
that diffs the wiki table against `events.json` and opens a PR is a good
next step).

## Suggestion box & triage

No backend — the box is **GitHub issue forms** (`.github/ISSUE_TEMPLATE/`):

- **suggest-event.yml** — structured form: name, dates, location, website,
  extra links, description, and a *Go-focused vs Go-track* dropdown so the
  `scope` call is made by the suggester, not guessed by the curator.
- **report-event.yml** — "what changed?" dropdown (cancelled / moved /
  broken link / dates announced…) for fixing listed events.

The site footer links to both. **Before deploying, replace `YOUR-USERNAME`
in the footer links in `index.html`** with the GitHub org/user that owns the
repo — the forms only work once the repo exists on GitHub.

Triage loop (roughly weekly, or when notified):

1. Read the issue; confirm the details from the linked source.
2. Add or edit the `events.json` entry (unknown dates → `tentative`,
   per the housekeeping rules above).
3. Run `node scripts/check-links.mjs`, commit, close the issue with a
   comment naming the entry `id` ("added as `fosdem-2027`").

GitHub's login requirement keeps most spam out, and the monthly
`check-links.yml` Action (plus a run on every `events.json` push) catches
link rot filed *by* the community as report-a-change issues.

## Reusing the data

`events.json` is public, licensed CC0, and the canonical URL is
`https://gophercon.dev/events.json`. Point people to
`https://raw.githubusercontent.com/<you>/gophercon.dev/main/events.json`
(or jsDelivr) when they want to `fetch()` it from another site — GitHub Pages
itself doesn't send CORS headers, the raw endpoints do.

## Behavior

- **Past events:** an event is considered past once its *end* date is over.
  Events that ended more than 7 days ago are hidden by default; the
  `[x] show 10 past` toggle reveals them below a `── recently past ──` rule.
- **Search** matches title, description, type, city, country, and region
  (all tokens must match).
- **Sort order:** upcoming events first (next soonest first), past events
  below (most recently ended first). The hero countdown always shows the
  soonest upcoming event.

## Keyboard shortcuts

| Key      | Action                                  |
| -------- | --------------------------------------- |
| `/`      | focus search                            |
| `p`      | toggle past events                      |
| `j` / `k`| move the row selection                  |
| `←` / `→`| move between the selected row's links (also `h`/`l`) |
| `1`–`9`  | jump to the Nth link of the selected row (numbers shown on selected rows) |
| `Enter`  | open the currently selected link (default: website) |
| `Escape` | clear search / drop selection           |


## Running & deploying

Serve the folder locally (`python3 -m http.server 8000`) — opening the page
via `file://` won't work because the browser blocks fetching local JSON; the
page then shows a hint instead of events.

It's pure static files, so any static host works for the `gophercon.dev`
domain: GitHub Pages, Netlify, Cloudflare Pages, S3… (e.g. Cloudflare Pages:
build command *none*, output directory `/`.)
