const path = require("path");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SITE = path.join(__dirname, "..");
const DAY = 86400000;
const iso = (d) => d.getFullYear() + "-" +
  String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

(async () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(SITE, "events.json"), "utf8"));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // v2 fixture: hybrid multi-location event with opens/closes/closed link windows
  bundle.events.push({
    id: "synthetic-hybrid-fest",
    unverified: true, // exercises the v9 review marker
    title: "Synthetic Hybrid Fest",
    description: "test fixture for multi-location and dated links",
    startDate: iso(new Date(today.getTime() + 30 * DAY)),
    locations: [
      { city: "Prague", country: "Czechia", region: "Europe", url: "https://prague.example/venue" },
      { city: "Vienna", country: "Austria", region: "Europe" },
      { city: "Online", country: "", region: "Online" }
    ],
    type: "meetup",
    website: "https://synthetic.example/",
    links: [
      { label: "cfp", url: "https://synthetic.example/cfp", endsAt: iso(new Date(today.getTime() + 5 * DAY)) },
      { label: "pre-registration", url: "https://synthetic.example/pre", startsAt: iso(new Date(today.getTime() + 20 * DAY)) },
      { label: "old link", url: "https://synthetic.example/old", endsAt: iso(new Date(today.getTime() - 3 * DAY)) }
    ]
  });
  // v3 fixture: cancelled event, dated sooner than GoLab so the countdown
  // must skip it
  bundle.events.push({
    id: "synthetic-cancelled-summit",
    title: "Synthetic Cancelled Summit",
    description: "test fixture for cancelled status",
    startDate: iso(new Date(today.getTime() + 3 * DAY)),
    locations: [{ city: "Canceltown", country: "Nowhereland", region: "Europe" }],
    type: "conference",
    status: "cancelled",
    website: "https://cancelled.example/",
    links: []
  });
  // v4 fixture: rescheduled but new date TBD, dated sooner than GoLab —
  // must NOT become "next up"
  bundle.events.push({
    id: "synthetic-rescheduled-tbd",
    title: "Synthetic Rescheduled Conf",
    description: "test fixture for rescheduled status",
    startDate: iso(new Date(today.getTime() + 6 * DAY)),
    locations: [{ city: "Movington", country: "Translandia", region: "Europe" }],
    type: "conference",
    status: "rescheduled",
    website: "https://moved.example/",
    links: []
  });
  // v5 fixture: tentative — announced, curator-estimated date, no locations yet
  bundle.events.push({
    id: "synthetic-tentative-summit",
    title: "Synthetic Tentative Fest",
    description: "test fixture for tentative status",
    startDate: iso(new Date(today.getTime() + 15 * DAY)),
    type: "meetup",
    status: "tentative",
    website: "https://tbd.example/",
    links: []
  });
  // v1 fixture: single location object + top-level cfpDeadline
  bundle.events.push({
    id: "compat-v1-conf",
    title: "Compat V1 Conf",
    description: "test fixture for v1 schema fallbacks",
    startDate: iso(new Date(today.getTime() + 12 * DAY)),
    location: { city: "Oslo", country: "Norway", region: "Europe" },
    type: "conference",
    website: "https://v1.example/",
    links: [{ label: "CFP", url: "https://v1.example/cfp" }],
    cfpDeadline: iso(new Date(today.getTime() + 7 * DAY))
  });

  // v11 fixtures: recurring meetup series — one with a fixed published
  // pattern (4th Friday monthly), one cadence-only (monthly). Long-past
  // founding dates: they must render in upcoming, never hide as past, and
  // never steal the hero countdown.
  bundle.events.push({
    id: "synthetic-pattern-meetup",
    title: "Synthetic Pattern Meetup",
    description: "test fixture for v11 computed pattern series",
    startDate: "2019-01-01",
    repeat: { freq: "monthly", weekday: 5, week: 4 },
    locations: [{ city: "Pattern City", country: "Testland", region: "Europe" }],
    type: "meetup",
    website: "https://pattern.example/",
    links: []
  });
  bundle.events.push({
    id: "synthetic-open-meetup",
    title: "Synthetic Open Meetup",
    description: "test fixture for v11 undated cadence series",
    startDate: "2018-03-01",
    repeat: { freq: "monthly" },
    locations: [{ city: "Openburg", country: "Testland", region: "Europe" }],
    type: "meetup",
    website: "https://open.example/",
    links: []
  });

  // Independent nth-weekday math to derive the pattern fixture's expected date
  const nthWd = (y, m, wd, wk) => {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const day = wk > 0
      ? 1 + ((wd - first.getDay() + 7) % 7) + (wk - 1) * 7
      : last.getDate() - ((last.getDay() - wd + 7) % 7) + (wk + 1) * 7;
    return new Date(y, m, day);
  };
  let nextPattern = nthWd(today.getFullYear(), today.getMonth(), 5, 4);
  if (nextPattern < today) nextPattern = nthWd(today.getFullYear(), today.getMonth() + 1, 5, 4);

  // Inline app.js so the page needs no network, and load over http:// so the
  // History API (URL-synced filters) is available to the tests.
  const appJs = fs.readFileSync(path.join(SITE, "assets/app.js"), "utf8");
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8")
    .replace('<script src="assets/app.js" defer></script>',
      () => "<script>" + appJs + "</script>");
  const page = (url) => new JSDOM(html, {
    runScripts: "dangerously",
    url,
    beforeParse(window) {
      // jsdom has no fetch; serve the site files with the injected fixtures.
      window.fetch = async (u) => {
        if (u === "events.json") {
          const text = JSON.stringify(bundle);
          return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
        }
        const text = fs.readFileSync(path.join(SITE, u), "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
      };
    },
  });
  const dom = page("http://localhost:8000/");

  const doc = dom.window.document;
  const win = dom.window;
  const events = bundle.events;

  for (let i = 0; i < 30 && doc.querySelectorAll(".evt").length === 0; i++) {
    await new Promise((res) => setTimeout(res, 100));
  }

  const end = (e) => e.repeat ? Infinity : new Date((e.endDate || e.startDate) + "T00:00:00").getTime();
  const start = (e) => new Date(e.startDate + "T00:00:00").getTime();
  // v11 series-aware sort key (independent mirror of app logic): pattern
  // series sort by computed next occurrence; undated series sort last in upcoming
  const effNext = (e) => {
    if (!e.repeat || e.repeat.freq !== "monthly" ||
        typeof e.repeat.weekday !== "number" || !e.repeat.week) return null;
    const floor = Math.max(today.getTime(), start(e));
    let y = new Date(floor).getFullYear(), m = new Date(floor).getMonth();
    for (let i = 0; i < 26; i++) {
      const occ = nthWd(y, m, e.repeat.weekday, e.repeat.week);
      if (occ && occ.getTime() >= floor) return occ.getTime();
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    return null;
  };
  const sortKey = (e) => {
    if (e.repeat) { const n = effNext(e); return n === null ? Infinity : n; }
    return start(e);
  };
  const locsOf = (e) => (e.locations && e.locations.length) ? e.locations
    : e.location ? [e.location] : [{ city: "TBD", country: "", region: "" }];
  const cutoff = today.getTime() - 7 * DAY;
  // rescheduled events (new date tbd) never auto-hide and live in the
  // upcoming block — mirrors isHiddenByDefault/isPastEvent in app.js
  const shownAlways = (e) => end(e) >= cutoff || e.status === "rescheduled";
  const inUpcoming = (e) => end(e) >= today.getTime() || e.status === "rescheduled";
  const expectedHidden = events.filter((e) => !shownAlways(e)).length;
  // default view: past beyond the 7d window hidden AND go: dedicated
  // (go-track events excluded) — matches the app defaults
  const expectedShown = events.filter((e) => shownAlways(e) && e.scope !== "track").length;
  const expectedUpcoming = events.filter((e) => inUpcoming(e) && e.scope !== "track").length;

  let failures = 0;
  const check = (name, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
  };

  const rows = () => doc.querySelectorAll(".evt").length;
  const titleOf = (row) => row.querySelector(".name").textContent;
  const rowByTitle = (t) => [...doc.querySelectorAll(".evt")].find((r) => titleOf(r) === t);
  const chipText = (row, label) => {
    const chip = [...row.querySelectorAll(".chip")].find((c) =>
      c.textContent.toLowerCase().includes(label.toLowerCase()));
    return chip ? { text: chip.textContent, cls: chip.className, el: chip } : null;
  };

  // v2 bundle + defaults
  check("events.json v11 bundle", [bundle.version, events.length, bundle.license], [11, 30, "CC0-1.0"]);
  check("load error not shown", doc.getElementById("load-error").hidden, true);
  check("rows shown by default", rows(), expectedShown);
  check("upcoming rows", doc.querySelectorAll("#list-upcoming .evt").length, expectedUpcoming);
  check("hidden note in meta", /hidden \(ended over a week ago\) — press p/.test(doc.getElementById("meta").textContent), true);
  check("counts line", doc.getElementById("counts").textContent.includes(
    `${events.length} listed · ${expectedShown} shown · ${expectedHidden} past hidden`), true);
  check("show-past label", doc.getElementById("show-past-label").textContent, `show ${expectedHidden} past`);
  check("hero shows soonest event", doc.getElementById("hero-next").textContent.includes("GoLab 2026"), true);
  const heroA = doc.querySelector("#hero-meta a.hero-link");
  check("hero meta URL is a real link", [heroA && heroA.href, heroA && heroA.target],
    ["https://golab.io/", "_blank"]);

  // v11: recurring meetup series
  const openRow = rowByTitle("Synthetic Open Meetup");
  const patRow = rowByTitle("Synthetic Pattern Meetup");
  check("series shown by default (never past-hidden)", [!!openRow, !!patRow], [true, true]);
  check("undated series date reads monthly",
    openRow.querySelector(".iso").textContent, "monthly");
  check("undated series rel reads em dash",
    openRow.querySelector(".rel").textContent, "\u2014");
  check("pattern series shows computed next 4th Friday",
    patRow.querySelector(".iso").textContent, iso(nextPattern));
  check("pattern series carries monthly tag",
    [...patRow.querySelectorAll(".status-tag")].map((t) => t.textContent), ["monthly"]);
  check("series never marked past",
    [openRow.classList.contains("past"), patRow.classList.contains("past")], [false, false]);
  check("series render in upcoming table", [
    !!openRow.closest("#list-upcoming"), !!patRow.closest("#list-upcoming")], [true, true]);
  check("series never steal hero countdown",
    doc.getElementById("hero-next").textContent.includes("GoLab 2026"), true);
  check("undated series sorts last among upcoming",
    [...doc.querySelectorAll("#list-upcoming .evt")].pop() === openRow, true);
  check("cmd line has hide-past flag", doc.getElementById("cmd").textContent.includes("--hide-past=7d"), true);

  // migrated data: GopherCon India CFP now closed (endsAt in the past)
  check("migrated cfp chip shows closed",
    chipText(rowByTitle("GopherCon India 2026"), "cfp").text.includes("closed 2026-08-23"), true);

  // v9: unverified review marker
  check("unverified marker renders as ?",
    rowByTitle("Synthetic Hybrid Fest").querySelector(".status-tag.unverified").textContent, "?");
  check("marker has explanatory tooltip",
    /verify it, then delete/.test(rowByTitle("Synthetic Hybrid Fest")
      .querySelector(".status-tag.unverified").title), true);
  check("every visible flagged event gets exactly one marker",
    doc.querySelectorAll(".status-tag.unverified").length,
    events.filter((e) => e.unverified && shownAlways(e) && e.scope !== "track").length);
  check("unflagged entry has no marker",
    rowByTitle("Compat V1 Conf").querySelector(".status-tag.unverified"), null);

  // cancelled event: listed in upcoming with tag + class, skipped by hero
  const cancelRow = rowByTitle("Synthetic Cancelled Summit");
  check("cancelled row in upcoming section", cancelRow && cancelRow.parentElement.id, "list-upcoming");
  check("cancelled row class", /cancelled/.test(cancelRow.className), true);
  check("cancelled status tag rendered", cancelRow.querySelector(".status-tag").textContent, "\u2715 cancelled");
  check("countdown skips cancelled event", doc.getElementById("hero-next").textContent.includes("GoLab 2026"), true);
  const expectedCancelledShown = events.filter(e => e.status === "cancelled" && end(e) >= cutoff && e.scope !== "track").length;
  const expectedReschedShown = events.filter(e => e.status === "rescheduled" && e.scope !== "track").length;
  const expectedTbcShown = events.filter(e => e.status === "tentative" && end(e) >= cutoff && e.scope !== "track").length;
  check("counts line shows cancelled", doc.getElementById("counts").textContent.includes(`${expectedCancelledShown} cancelled`), true);

  // rescheduled-TBD: tagged (not struck through), countdown skips it
  const reschedRow = rowByTitle("Synthetic Rescheduled Conf");
  check("rescheduled-TBD row not cancelled-styled", /cancelled/.test(reschedRow.className), false);
  check("rescheduled-TBD tag shows new date tbd",
    reschedRow.querySelector(".status-tag").textContent.includes("new date tbd"), true);
  check("countdown skips rescheduled-TBD (sooner than GoLab)",
    doc.getElementById("hero-next").textContent.includes("GoLab 2026"), true);
  check("counts line shows rescheduled", doc.getElementById("counts").textContent.includes(`${expectedReschedShown} rescheduled`), true);

  // tentative: estimated date gets "\u2248" prefix + "tbc" relative, tag; real seed too
  const tentRow = rowByTitle("Synthetic Tentative Fest");
  check("tentative row class", /tentative/.test(tentRow.className), true);
  check("tentative iso prefixed with \u2248", tentRow.querySelector(".iso").textContent.startsWith("\u2248"), true);
  check("tentative relative column shows tbc", tentRow.querySelector(".col-when .rel").textContent, "tbc");
  check("tentative seed (GopherCon 2027) renders tentative",
    /tentative/.test(rowByTitle("GopherCon 2027").className), true);
  check("tentative seed CFP link shows opens window",
    chipText(rowByTitle("GopherCon 2027"), "cfp").text.includes("opens 2027-01-18"), true);
  check("counts line shows tbc", doc.getElementById("counts").textContent.includes(`${expectedTbcShown} tbc`), true);

  // search
  const search = doc.getElementById("search");
  const type = doc.getElementById("type");
  const region = doc.getElementById("region");
  const doSearch = (q) => { search.value = q; search.dispatchEvent(new win.Event("input", { bubbles: true })); };

  doSearch("berlin");
  check("search 'berlin' default window (go:dedicated hides DevFest)",
    [...doc.querySelectorAll(".evt")].map(titleOf), ["GopherCon Europe 2027"]);
  check("cmd line has query", doc.getElementById("cmd").textContent.includes('--query="berlin"'), true);
  check("URL reflects search", win.location.search.includes("q=berlin"), true);

  // kbd p reveals past
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "p", bubbles: true }));
  check("kbd p toggles checkbox", doc.getElementById("show-past").checked, true);
  check("search 'berlin' + past shown", [...doc.querySelectorAll(".evt")].map(titleOf),
    ["GopherCon Europe 2027", "GopherCon Europe 2026", "GopherCon Europe 2020"]);

  // kbd j + cmd flags + kbd /
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "j", bubbles: true }));
  check("kbd j selects first row", doc.querySelectorAll(".evt.sel").length, 1);
  check("cmd line has show-past flag", doc.getElementById("cmd").textContent.includes("--show-past"), true);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "/", bubbles: true }));
  check("kbd / focuses search", doc.activeElement === search, true);

  // keyboard link sub-selection on the 4-link hybrid fixture row
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  doSearch("hybrid");
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "j", bubbles: true }));
  const hybChips = () => rowByTitle("Synthetic Hybrid Fest").querySelectorAll(".chip");
  check("j selects website link by default", hybChips()[0].classList.contains("chip-sel"), true);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check("ArrowRight moves to next link", hybChips()[1].classList.contains("chip-sel"), true);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "4", bubbles: true }));
  check("digit 4 jumps to fourth link", hybChips()[3].classList.contains("chip-sel"), true);
  const opened = [];
  win.open = (url) => { opened.push(url); return null; };
  check("selected link is highlighted", doc.querySelectorAll(".chip-sel").length, 1);
  check("selection moves real focus to the selected chip",
    doc.activeElement === hybChips()[3], true);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  check("Enter on a focused link does not also open the row link", opened, []);
  doc.activeElement.blur();
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  check("Enter with no focused control opens the selected link", opened, ["https://synthetic.example/old"]);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape drops selection", doc.querySelectorAll(".evt.sel").length, 0);

  doSearch("");
  doc.getElementById("clear-filters").click();
  check("after clear: rows", rows(), expectedShown);

  // multi-location: hybrid 2021 event searchable by city + "Online" region
  doc.getElementById("show-past").checked = true;
  doc.getElementById("show-past").dispatchEvent(new win.Event("change", { bubbles: true }));
  doSearch("san diego");
  check("multi-location search finds hybrid", [...doc.querySelectorAll(".evt")].map(titleOf), ["GopherCon 2021"]);
  check("online-only column text",
    rowByTitle("GopherCon 2021").querySelector(".col-loc").textContent,
    "Online · Online");
  doSearch("");
  region.value = "Online";
  region.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("region 'Online' filter (past shown)",
    [...doc.querySelectorAll(".evt")].map(titleOf).sort(),
    ["GopherCon 2021", "GopherCon Europe 2020", "Synthetic Hybrid Fest"].sort());
  check("synthetic multi-loc column",
    rowByTitle("Synthetic Hybrid Fest").querySelector(".col-loc").textContent,
    "Prague, Czechia \u2197 +2 more · Europe / Online");
  region.value = "all";
  region.dispatchEvent(new win.Event("change", { bubbles: true }));
  // v7: OSM map link on the location (\u2316) + Venue chip on the link row
  const ukRow = rowByTitle("GopherCon UK 2026");
  const ukLead = ukRow.querySelector(".col-loc a.loc-link");
  check("map link on leading location uses \u2316 glyph",
    ukLead.textContent, "London, UK \u2316");
  check("map link points to openstreetmap.org",
    /openstreetmap\.org/.test(ukLead.href), true);
  const ukVenueChip = chipText(ukRow, "venue");
  check("venue website link in links row",
    ukVenueChip && ukVenueChip.el.href, "https://www.thebrewery.co.uk/");
  check("link labels always render lowercase",
    ukVenueChip.text.startsWith("\u2197 venue"), true);
  // non-map location url renders as normal \u2197 link
  const PragueLead = rowByTitle("Synthetic Hybrid Fest").querySelector(".col-loc a.loc-link");
  check("non-map location url links with \u2197",
    [PragueLead.textContent, PragueLead.href], ["Prague, Czechia \u2197", "https://prague.example/venue"]);
  check("location without url stays plain text",
    rowByTitle("GopherCon 2021").querySelector(".col-loc a"), null);

  // link windows on the synthetic fixture
  const syn = rowByTitle("Synthetic Hybrid Fest");
  const cfpChip = chipText(syn, "cfp");
  const preChip = chipText(syn, "pre-registration");
  const oldChip = chipText(syn, "old link");
  check("open link chip shows closes-date", cfpChip.text.includes("closes"), true);
  check("open link chip has amber period", !!cfpChip.el.querySelector(".per-open"), true);
  check("future link chip shows opens-date", /opens \d{4}-\d{2}-\d{2}/.test(preChip.text), true);
  check("expired link chip shows closed + dimmed",
    [/closed \d{4}-\d{2}-\d{2}/.test(oldChip.text), /chip-closed/.test(oldChip.cls)], [true, true]);

  // v1-compat fixture: single location + cfpDeadline merged into CFP chip
  doSearch("compat v1");
  const v1 = rowByTitle("Compat V1 Conf");
  check("v1 fixture renders", !!v1, true);
  check("v1 location fallback", v1.querySelector(".col-loc").textContent, "Oslo, Norway · Europe");
  check("v1 cfpDeadline merged into chip",
    chipText(v1, "cfp").text.includes("closes"), true);
  doSearch("");

  // filters + empty state
  region.value = "South America";
  region.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("region South America (past shown)", rows(),
    events.filter((e) => locsOf(e).some((l) => l.region === "South America")).length);
  type.value = "conference";
  type.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("region SA + type conference -> latam edition", rows(), 1);
  // after the GopherCamp retype no community events remain, so the type select
  // only offers existing types; use go-scope for the no-match + URL test
  const scope0 = doc.getElementById("scope");
  scope0.value = "track";
  scope0.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("region SA + go-track (no match)", rows(), 0);
  check("empty state visible", doc.getElementById("empty").hidden, false);
  check("URL reflects region+scope",
    win.location.search.includes("region=South+America") && win.location.search.includes("go=track"), true);
  doc.getElementById("reset-empty").click();
  check("after clear: rows", rows(), expectedShown);
  check("reset clears URL", win.location.search, "");

  // v8: scope — go: defaults to dedicated; go-track tags + filter
  const scope = doc.getElementById("scope");
  check("go filter defaults to dedicated", scope.value, "dedicated");
  scope.value = "all";
  scope.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("go:all reveals go-track events", rows(), events.filter((e) => shownAlways(e)).length);
  const fosdem = rowByTitle("FOSDEM 2027");
  check("go-track tag rendered",
    fosdem.querySelector(".status-tag.scope").textContent, "\u25D0 go track");
  const devfest = rowByTitle("DevFest Berlin 2026");
  check("devfest go-track tag rendered",
    devfest.querySelector(".status-tag.scope").textContent, "\u25D0 go track");
  check("devfest venue has OSM map link",
    /openstreetmap\.org\/way\/1341514920/.test(
      devfest.querySelector(".col-loc a.loc-link").href), true);
  check("track event can also be tentative (both tags)",
    !!fosdem.querySelector(".status-tag.tentative"), true);
  scope.value = "track";
  scope.dispatchEvent(new win.Event("change", { bubbles: true }));
  check("go:track shows only track events",
    [...doc.querySelectorAll(".evt")].map(titleOf),
    events.filter((e) => e.scope === "track" && end(e) >= cutoff)
      .sort((a, b) => start(a) - start(b)).map((e) => e.title));
  check("cmd line has go flag", doc.getElementById("cmd").textContent.includes('--go="track"'), true);
  check("URL reflects go filter", win.location.search.includes("go=track"), true);
  doc.getElementById("clear-filters").click();
  check("reset restores go:dedicated default", scope.value, "dedicated");
  check("after reset: rows", rows(), expectedShown);
  check("reset clears URL again", win.location.search, "");

  // sorting + structure
  check("soonest upcoming first", titleOf(doc.querySelector("#list-upcoming .evt")),
    events.filter((e) => inUpcoming(e) && e.scope !== "track")
      .sort((a, b) => sortKey(a) - sortKey(b))[0].title);
  check("separator visible with past rows", doc.getElementById("past-separator").hidden, false);
  doc.getElementById("show-past").checked = true;
  doc.getElementById("show-past").dispatchEvent(new win.Event("change", { bubbles: true }));
  const chipCounts = [...doc.querySelectorAll(".evt")].map((r) => r.querySelectorAll(".chip").length);
  check("one website chip per row", chipCounts.every((n) => n >= 1), true);
  const shownEvts = events.filter((e) => e.scope !== "track"); // go: dedicated default
  check("total chips (website + links)", doc.querySelectorAll(".chip").length,
    shownEvts.length + shownEvts.reduce((n, e) => n + (e.links || []).length, 0));
  const golabIso = rowByTitle("GoLab 2026").querySelector(".iso").textContent;
  check("ISO date range format", golabIso, "2026-11-01/03");

  // URL -> state: a refreshed or shared URL restores the exact same view
  const restore = async (url) => {
    const d = page(url);
    for (let i = 0; i < 30 && d.window.document.querySelectorAll(".evt").length === 0; i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    return d.window.document;
  };
  const d2 = await restore("http://localhost:8000/?q=berlin&go=all&past=1");
  check("url restores search box", d2.getElementById("search").value, "berlin");
  check("url restores go filter", d2.getElementById("scope").value, "all");
  check("url restores past toggle", d2.getElementById("show-past").checked, true);
  check("url restores row set", [...d2.querySelectorAll(".evt")].map(titleOf),
    ["DevFest Berlin 2026", "GopherCon Europe 2027", "GopherCon Europe 2026", "GopherCon Europe 2020"]);
  const d3 = await restore("http://localhost:8000/?region=Neverland&go=bogus&type=nope");
  check("invalid url params fall back to defaults",
    [d3.getElementById("region").value, d3.getElementById("type").value,
     d3.getElementById("scope").value, d3.defaultView.location.search],
    ["all", "all", "dedicated", ""]);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
