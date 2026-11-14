// Tests for scripts/validate.mjs — run with `npm test` (node --test).
//
// Every case feeds the validator its own small bundle through the optional
// file argument, so nothing here depends on the real events.json: editing
// the event list can never turn these red.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "scripts", "validate.mjs");

// A minimal bundle the validator accepts; each test bends one thing.
function bundle() {
  return {
    version: 11,
    updated: "2027-01-01",
    source: "https://example.org/",
    license: "CC0-1.0",
    schema: {},
    events: [{
      id: "example-conf-2027",
      title: "Example Conf 2027",
      description: "A fixture.",
      startDate: "2027-05-12",
      endDate: "2027-05-14",
      type: "conference",
      website: "https://example.org/",
      locations: [{ city: "Exampleville", country: "Exampleland", region: "Europe" }],
      links: [{ label: "CFP", url: "https://example.org/cfp", endsAt: "2027-01-15" }],
    }],
  };
}

// Runs the validator on `data`; returns its exit code and output.
function validate(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  try {
    const file = path.join(dir, "events.json");
    fs.writeFileSync(file, JSON.stringify(data));
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Applies `bend` to a fresh bundle and expects the validator to reject it
// with a message matching `pattern`.
function rejects(bend, pattern) {
  const data = bundle();
  bend(data, data.events[0]);
  const r = validate(data);
  assert.strictEqual(r.code, 1, "expected exit code 1, output was:\n" + r.out);
  assert.match(r.out, pattern);
}

test("accepts a well-formed bundle", () => {
  const r = validate(bundle());
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /all 1 events valid/);
});

test("accepts every optional field the site understands", () => {
  const data = bundle();
  Object.assign(data.events[0], {
    status: "tentative", scope: "track", unverified: true, rescheduledFrom: "2027-04-14",
  });
  data.events[0].locations.push({ city: "Online", country: "", region: "Online", url: "https://example.org/live" });
  data.events[0].links.push({ label: "Tickets", url: "https://example.org/t", startsAt: "2027-02-01", endsAt: "2027-05-01" });
  data.events.push({
    id: "example-meetup", title: "Example Meetup", description: "A recurring fixture.",
    startDate: "2020-01-01", repeat: { freq: "monthly", weekday: 2, week: -1 }, type: "meetup",
    website: "https://example.org/meetup", locations: [{ city: "Exampleville", country: "Exampleland", region: "Europe" }],
  });
  const r = validate(data);
  assert.strictEqual(r.code, 0, r.out);
});

// A misspelled optional field is silently ignored by the site, so the
// validator has to be the one to notice.
test("rejects a misspelled status — the cancelled event would look scheduled", () => {
  rejects((_, ev) => { ev.stauts = "cancelled"; }, /example-conf-2027: unknown field "stauts" — did you mean "status"\?/);
});

test("rejects a miscased endDate — four days would become one", () => {
  rejects((_, ev) => { ev.enddate = ev.endDate; delete ev.endDate; }, /unknown field "enddate" — did you mean "endDate"\?/);
});

test("rejects a misspelled link window — the deadline would vanish", () => {
  rejects((_, ev) => { ev.links[0].endAt = "2027-01-15"; }, /\(link CFP\): unknown field "endAt" — did you mean "endsAt"\?/);
});

test("rejects unknown fields on locations, repeat and the bundle itself", () => {
  rejects((_, ev) => { ev.locations[0].contry = "X"; }, /\(location 1\): unknown field "contry" — did you mean "country"\?/);
  rejects((_, ev) => { ev.repeat = { freq: "monthly", weekDay: 2, week: 1 }; }, /\(repeat\): unknown field "weekDay" — did you mean "weekday"\?/);
  rejects((data) => { data.lastUpdated = "2027-01-01"; }, /events\.json: unknown field "lastUpdated"/);
});

test("an unknown field with no near match gets no misleading hint", () => {
  for (const name of ["organizer", "x"]) { // nothing similar; too short to judge
    const data = bundle();
    data.events[0][name] = "Someone";
    const r = validate(data);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, new RegExp(`unknown field "${name}"`));
    assert.doesNotMatch(r.out, /did you mean/);
  }
});

test("hints survive the typos people actually make", () => {
  rejects((_, ev) => { ev.titel = "x"; }, /unknown field "titel" — did you mean "title"\?/);
  rejects((_, ev) => { ev.descripton = "x"; }, /unknown field "descripton" — did you mean "description"\?/);
  rejects((_, ev) => { ev.rescheduledfrom = "2027-04-14"; }, /did you mean "rescheduledFrom"\?/);
});

test("requires country on every location, empty for online ones", () => {
  rejects((_, ev) => { delete ev.locations[0].country; }, /\(location 1\): missing country/);
  const data = bundle();
  data.events[0].locations = [{ city: "Online", country: "", region: "Online" }];
  assert.strictEqual(validate(data).code, 0);
});

// The rules that were already there — pinned so later edits can't drop them.
test("rejects non-https and script URLs", () => {
  rejects((_, ev) => { ev.website = "http://example.org/"; }, /website is not https/);
  rejects((_, ev) => { ev.links[0].url = "javascript:alert(1)"; }, /url is not https/);
});

test("rejects impossible or reversed dates", () => {
  rejects((_, ev) => { ev.startDate = "2027-02-30"; }, /startDate is not a YYYY-MM-DD date/);
  rejects((_, ev) => { ev.endDate = "2027-05-11"; }, /endDate is before startDate/);
  rejects((_, ev) => { ev.links[0].startsAt = "2027-02-01"; }, /endsAt is before startsAt/);
});

test("rejects duplicate ids, unknown enum values and missing locations", () => {
  rejects((data, ev) => { data.events.push(Object.assign({}, ev)); }, /duplicate id/);
  rejects((_, ev) => { ev.type = "festival"; }, /unknown type: festival/);
  rejects((_, ev) => { ev.status = "postponed"; }, /unknown status: postponed/);
  rejects((_, ev) => { ev.locations[0].region = "Antarctica"; }, /unknown region: Antarctica/);
  rejects((_, ev) => { ev.locations = []; }, /needs at least one location/);
});
