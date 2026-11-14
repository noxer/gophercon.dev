// Tests for scripts/build-site.mjs — run with `npm test` (node --test).
//
// Builds the site once into a temp folder, then checks what would be
// published. Expectations come from events.json and the clock, never from
// hard-coded event names, so editing the event list can't turn these red.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const DAY = 86400000;
let out, html, doc;

before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), "build-test-"));
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-site.mjs"), out], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  doc = new JSDOM(html).window.document; // parsed only, no scripts run
});

after(() => fs.rmSync(out, { recursive: true, force: true }));

const listFiles = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);

test("publishes only site files", () => {
  const files = listFiles(out).sort();
  const assets = listFiles(path.join(ROOT, "assets")).map((f) => path.join("assets", f));
  assert.deepStrictEqual(files,
    ["CNAME", "events.json", "index.html", "robots.txt", "sitemap.xml", ...assets].sort());
  assert.strictEqual(fs.readFileSync(path.join(out, "events.json"), "utf8"),
    fs.readFileSync(path.join(ROOT, "events.json"), "utf8"));
});

test("the page arrives with the default view already rendered", () => {
  const events = JSON.parse(fs.readFileSync(path.join(ROOT, "events.json"), "utf8")).events;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = (e) => new Date((e.endDate || e.startDate) + "T00:00:00");
  // default view: go: dedicated, past beyond 7 days hidden (rescheduled-TBD
  // and series never hide) — mirrors app.js
  const shown = events.filter((e) => e.scope !== "track" &&
    (e.repeat || e.status === "rescheduled" || end(e) >= new Date(today.getTime() - 7 * DAY)));
  assert.ok(shown.length > 0, "fixture sanity: something to show");
  assert.strictEqual(doc.querySelectorAll(".evt").length, shown.length);
  assert.match(doc.getElementById("hero-next").textContent, /^next up: /);
  assert.match(doc.getElementById("counts").textContent, new RegExp(`${events.length} listed`));
  assert.ok(doc.querySelectorAll("#region option").length > 1, "region dropdown filled");
  assert.strictEqual(doc.getElementById("load-error").hidden, true);
  assert.strictEqual(doc.getElementById("sr-status").textContent, "", "no announcement shipped");
  // the app still loads as an external script
  assert.ok(doc.querySelector('script[src="assets/app.js"][defer]'));
});

test("JSON-LD sits in <head>, parses, and skips estimated dates", () => {
  const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].parentElement.tagName, "HEAD");
  assert.ok(!html.includes("<!-- build:jsonld"), "marker replaced");
  const ld = JSON.parse(blocks[0].textContent);
  const list = ld["@graph"].find((n) => n["@type"] === "ItemList");
  const events = JSON.parse(fs.readFileSync(path.join(ROOT, "events.json"), "utf8")).events;
  const tentative = new Set(events.filter((e) => e.status === "tentative").map((e) => e.title));
  assert.strictEqual(list.numberOfItems, list.itemListElement.length);
  for (const { item } of list.itemListElement) {
    assert.strictEqual(item["@type"], "Event");
    assert.ok(!tentative.has(item.name), `${item.name} is tentative and must not be marked up`);
  }
});

test("sitemap has one URL with a real date", () => {
  const xml = fs.readFileSync(path.join(out, "sitemap.xml"), "utf8");
  assert.match(xml, /<loc>https:\/\/gophercon\.dev\/<\/loc>/);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test("app.js on the prerendered page redraws the same view without duplicating anything", async () => {
  const app = fs.readFileSync(path.join(out, "assets", "app.js"), "utf8");
  const tag = /<script src="assets\/app\.js" defer(="")?><\/script>/;
  assert.match(html, tag);
  // mark the prerendered rows: a real redraw replaces them with fresh ones
  const page = html.replace(/class="evt/g, 'data-prerendered="1" class="evt')
    .replace(tag, () => "<script>" + app + "</script>");
  const dom = new JSDOM(page, {
    url: "http://localhost:8000/",
    runScripts: "dangerously",
    beforeParse(w) {
      const text = fs.readFileSync(path.join(out, "events.json"), "utf8");
      w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(text) });
    },
  });
  await new Promise((r) => setTimeout(r, 200));
  const live = dom.window.document;
  assert.strictEqual(live.getElementById("load-error").hidden, true, live.getElementById("load-error").textContent);
  assert.strictEqual(live.querySelectorAll("[data-prerendered]").length, 0, "app.js did not redraw the rows");
  const titles = (d) => [...d.querySelectorAll(".evt .name")].map((n) => n.textContent);
  assert.deepStrictEqual(titles(live), titles(doc));
  for (const id of ["region", "type", "scope"]) {
    const values = [...live.querySelectorAll(`#${id} option`)].map((o) => o.value);
    assert.deepStrictEqual(values, [...new Set(values)], `#${id} options duplicated`);
    assert.strictEqual(values.length, doc.querySelectorAll(`#${id} option`).length);
  }
  const ids = [...live.querySelectorAll("[id]")].map((e) => e.id);
  assert.deepStrictEqual(ids, [...new Set(ids)], "duplicate element ids");
  dom.window.close();
});
