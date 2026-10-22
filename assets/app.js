// gophercon.dev — fetches events from events.json, renders and filters them.
// terminal-style output: ISO dates, relative day offsets, keyboard navigation.
(function () {
  "use strict";

  var EVENTS_URL = "events.json";
  var events = [];
  var DAY = 86400000;

  var els = {
    counts: document.getElementById("counts"),
    cmd: document.getElementById("cmd"),
    heroNext: document.getElementById("hero-next"),
    heroMeta: document.getElementById("hero-meta"),
    loadError: document.getElementById("load-error"),
    search: document.getElementById("search"),
    region: document.getElementById("region"),
    type: document.getElementById("type"),
    scope: document.getElementById("scope"),
    showPast: document.getElementById("show-past"),
    showPastLabel: document.getElementById("show-past-label"),
    clearFilters: document.getElementById("clear-filters"),
    meta: document.getElementById("meta"),
    listUpcoming: document.getElementById("list-upcoming"),
    pastSeparator: document.getElementById("past-separator"),
    listPast: document.getElementById("list-past"),
    empty: document.getElementById("empty"),
    resetEmpty: document.getElementById("reset-empty")
  };

  // ---------- date helpers ----------

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Parse "YYYY-MM-DD" as local midnight (naive dates would be UTC otherwise).
  function parseDate(s) {
    return new Date(s + "T00:00:00");
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function iso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function endDateOf(ev) {
    return parseDate(ev.endDate || ev.startDate);
  }

  // ISO-ish ranges: "2026-11-01/03", "2026-06-15/18", "2026-10-31/11-02", "2027-02-13"
  function fmtIsoRange(start, end) {
    if (+end === +start) return iso(start);
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return iso(start) + "/" + pad(end.getDate());
    }
    if (start.getFullYear() === end.getFullYear()) {
      return iso(start) + "/" + iso(end).slice(5);
    }
    return iso(start) + "/" + iso(end);
  }

  // "+10d", "today", "now" (ongoing), "-4d", "+4mo", "+2y"
  function relCompact(start, end, today) {
    if (start < today && end >= today) return "now";
    var days = Math.round((start - today) / DAY);
    if (days === 0) return "today";
    var out;
    if (Math.abs(days) < 45) {
      out = Math.abs(days) + "d";
    } else if (Math.abs(days) < 365) {
      out = Math.round(Math.abs(days) / 30.44) + "mo";
    } else {
      out = (Math.round(Math.abs(days) / 365.25 * 10) / 10) + "y";
    }
    return (days > 0 ? "+" : "-") + out;
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return url;
    }
  }

  // ---------- state ----------

  var DEFAULT_SCOPE = "dedicated"; // go: default — go-track events stay out of
  // the default view until asked for (the list is about Go events, after all)
  var state = { q: "", region: "all", type: "all", scope: DEFAULT_SCOPE, showPast: false };
  var selIndex = -1;      // j/k row selection
  var linkIndex = 0;      // which link of the selected row is "entered" (\u2190/\u2192, 1-9)
  var renderedRows = [];

  // ---------- schema helpers (v2+ with v1 fallbacks) ----------

  // v1 used a single "location" object; v2 uses a "locations" array.
  // Tentative events may have no location yet at all.
  function locationsOf(ev) {
    if (ev.locations && ev.locations.length) return ev.locations;
    if (ev.location) return [ev.location];
    return [{ city: "TBD", country: "", region: "" }];
  }

  // v1 used a top-level cfpDeadline; v2 puts startsAt/endsAt on the link.
  function linksOf(ev) {
    var links = (ev.links || []).map(function (l) { return l; });
    if (ev.cfpDeadline) {
      var cfp = links.filter(function (l) { return /cfp/i.test(l.label); })[0];
      if (cfp) {
        if (!cfp.endsAt) cfp.endsAt = ev.cfpDeadline;
      } else {
        links.push({ label: "CFP", url: ev.website, endsAt: ev.cfpDeadline });
      }
    }
    return links;
  }

  // v3: "cancelled" events stay listed (struck through) until their normal
  // date window passes, but never count as "next up".
  function isCancelled(ev) {
    return ev.status === "cancelled";
  }

  // v4: dates move in either direction (postponed / pulled forward) =
  // "rescheduled". status:"rescheduled" = moved but new date TBD;
  // rescheduledFrom = the old start date, kept for information once the
  // new dates are in the entry. Neither cancelled nor TBD counts as next up.
  function isCountdownEligible(ev) {
    return !isCancelled(ev) && ev.status !== "rescheduled";
  }

  // v5: announced but dates not confirmed — the entry's dates are a curator
  // estimate, rendered with "\u2248" and "tbc" instead of a day countdown.
  function isTentative(ev) {
    return ev.status === "tentative";
  }

  function statusTag(ev) {
    if (isCancelled(ev)) return { cls: "cancelled", text: "\u2715 cancelled" };
    if (ev.status === "rescheduled")
      return { cls: "moved", text: "\u219D rescheduled \u2014 new date tbd" };
    if (ev.status === "tentative")
      return { cls: "tentative", text: "\u21BB dates tbc" };
    if (ev.rescheduledFrom)
      return { cls: "moved", text: "\u219D rescheduled from " + ev.rescheduledFrom };
    return null;
  }

  // Window status for a dated link: opens / closes / closed.
  function periodOf(link, today) {
    var s = link.startsAt ? parseDate(link.startsAt) : null;
    var e = link.endsAt ? parseDate(link.endsAt) : null;
    if (s && s > today) return { cls: "per-future", text: "opens " + link.startsAt };
    if (e && e < today) return { cls: "per-closed", text: "closed " + link.endsAt };
    if (e) return { cls: "per-open", text: "closes " + link.endsAt };
    return null;
  }

  // ---------- filtering ----------

  function matchesSearch(ev) {
    if (!state.q) return true;
    var parts = [ev.title, ev.description, ev.type];
    locationsOf(ev).forEach(function (l) {
      parts.push(l.city + " " + l.country + " " + l.region);
    });
    var hay = parts.join(" ").toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  }

  function matchesFilters(ev) {
    return matchesSearch(ev) &&
      (state.region === "all" || locationsOf(ev).some(function (l) {
        return l.region === state.region;
      })) &&
      (state.type === "all" || ev.type === state.type) &&
      // v8: scope — "go:" filter. dedicated = Go-focused (no scope field),
      // track = broader conference with a Go track/devroom.
      (state.scope === "all" ||
        (state.scope === "track") === (ev.scope === "track"));
  }

  // An event is hidden by default if it ended more than a week ago — but an
  // event still waiting on its new date ("rescheduled") never auto-hides:
  // attendees are waiting for the update, not the archive.
  function isHiddenByDefault(ev, today) {
    if (ev.status === "rescheduled") return false;
    return endDateOf(ev) < new Date(today.getTime() - 7 * DAY);
  }

  // ---------- filter state in the URL (refresh/share restores the view) ----------

  // Only non-default filters appear: ?q= &region= &type= &go= &past=1 — the
  // bare URL is the default view. Discrete control changes push a history
  // entry (back steps through the filter sequence); search typing and init
  // normalize in place. On file:// browsers block History, so sync no-ops.

  function currentQuery() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.region !== "all") p.set("region", state.region);
    if (state.type !== "all") p.set("type", state.type);
    if (state.scope !== DEFAULT_SCOPE) p.set("go", state.scope);
    if (state.showPast) p.set("past", "1");
    return p.toString();
  }

  function syncURL(push) {
    var qs = currentQuery();
    var target = location.pathname + (qs ? "?" + qs : "");
    if (target === location.pathname + location.search) return;
    try {
      if (push) history.pushState(null, "", target);
      else history.replaceState(null, "", target);
    } catch (e) { /* History unavailable (file://) — URL is a nicety, not core */ }
  }

  function stateFromURL() {
    var p = new URLSearchParams(location.search);
    state.q = (p.get("q") || "").trim();
    state.region = p.get("region") || "all";
    state.type = p.get("type") || "all";
    var go = p.get("go");
    state.scope = (go === "all" || go === "dedicated" || go === "track")
      ? go : DEFAULT_SCOPE;
    state.showPast = p.get("past") === "1";
    selIndex = -1;
  }

  // push parsed URL state into the controls; typo'd region/type values
  // from hand-edited share links fall back to "all"
  function applyControls() {
    els.search.value = state.q;
    els.region.value = state.region;
    if (els.region.value !== state.region) {
      state.region = "all";
      els.region.value = "all";
    }
    els.type.value = state.type;
    if (els.type.value !== state.type) {
      state.type = "all";
      els.type.value = "all";
    }
    els.scope.value = state.scope;
    els.showPast.checked = state.showPast;
  }

  // ---------- rendering ----------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function chip(label, url, period) {
    var a = el("a", "chip");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.appendChild(el("span", "lbl", "\u2197 " + String(label).toLowerCase()));
    if (period) {
      a.appendChild(el("span", "per " + period.cls, " \u00B7 " + period.text));
      if (period.cls === "per-closed") a.classList.add("chip-closed");
    }
    return a;
  }

  function renderRow(ev, today) {
    var start = parseDate(ev.startDate);
    var end = endDateOf(ev);
    var isPast = end < today;

    var tr = el("tr", "evt" + (isPast ? " past" : "") +
      (isCancelled(ev) ? " cancelled" : "") + (isTentative(ev) ? " tentative" : ""));

    var d = el("td", "col-date");
    d.appendChild(el("span", "iso",
      (isTentative(ev) ? "\u2248 " : "") + fmtIsoRange(start, end)));
    tr.appendChild(d);

    var cell = el("td", "col-event");
    var line = el("div", "line");
    line.appendChild(el("span", "arw", "\u203A"));
    line.appendChild(el("span", "name", ev.title));
    var tag = statusTag(ev);
    if (tag) line.appendChild(el("span", "status-tag " + tag.cls, tag.text));
    if (ev.scope === "track")
      line.appendChild(el("span", "status-tag scope", "\u25D0 go track"));
    if (ev.unverified) {
      var uv = el("span", "status-tag unverified", "?");
      uv.title = "unverified \u2014 nobody has checked this entry against a " +
        "source yet; verify it, then delete \u201Cunverified\u201D from its events.json entry";
      line.appendChild(uv);
    }
    cell.appendChild(line);

    var note = el("div", "note");
    note.appendChild(el("span", "desc", ev.description));
    cell.appendChild(note);

    var chips = el("div", "chips");
    chips.appendChild(chip("website", ev.website, null));
    linksOf(ev).forEach(function (link) {
      chips.appendChild(chip(link.label, link.url, periodOf(link, today)));
    });
    cell.appendChild(chips);
    tr.appendChild(cell);

    var locs = locationsOf(ev);
    var regs = uniqueSorted(locs.map(function (l) {
      return l.region;
    }).filter(Boolean));
    var loc = el("td", "col-loc");
    var leadText = locs[0].city + (locs[0].country ? ", " + locs[0].country : "");
    var lead;
    if (locs[0].url) {
      var isMap = /openstreetmap\.org/.test(locs[0].url);
      lead = el("a", "loc-link",
        leadText + " " + (isMap ? "\u2316" : "\u2197"));
      lead.href = locs[0].url;
      lead.target = "_blank";
      lead.rel = "noopener noreferrer";
    } else {
      lead = el("span", null, leadText);
    }
    loc.appendChild(lead);
    var label = locs.length > 1 ? " +" + (locs.length - 1) + " more" : "";
    if (regs.length) label += " \u00B7 " + regs.join(" / ");
    loc.appendChild(el("span", null, label));
    loc.title = locs.map(function (l) {
      return l.city + (l.country ? ", " + l.country : "");
    }).join(" / ");
    tr.appendChild(loc);

    var when = el("td", "col-when");
    if (isTentative(ev)) {
      when.appendChild(el("span", "rel rel-tbc", "tbc"));
    } else {
      var rel = relCompact(start, end, today);
      when.appendChild(el("span", "rel " + (rel === "now" ? "rel-now" : isPast ? "rel-past" : "rel-future"), rel));
    }
    tr.appendChild(when);

    return tr;
  }

  function renderHero(next, today) {
    els.heroNext.textContent = "";
    els.heroMeta.textContent = "";
    var cmdParts = ["events", "--sort=soonest"];
    cmdParts.push(state.showPast ? "--show-past" : "--hide-past=7d");
    if (state.q) cmdParts.push('--query="' + state.q + '"');
    if (state.region !== "all") cmdParts.push('--region="' + state.region + '"');
    if (state.type !== "all") cmdParts.push('--type="' + state.type + '"');
    if (state.scope !== DEFAULT_SCOPE) cmdParts.push('--go="' + state.scope + '"');
    els.cmd.textContent = "\u276F " + cmdParts.join(" ");

    if (!next) {
      els.heroNext.appendChild(el("span", null, "next up: "));
      els.heroNext.appendChild(el("span", "t", "nothing confirmed"));
      els.heroNext.appendChild(el("span", "cursor"));
      return;
    }
    var start = parseDate(next.startDate);
    els.heroNext.appendChild(el("span", null, "next up: "));
    els.heroNext.appendChild(el("span", "t", next.title));
    els.heroNext.appendChild(el("span", "nd",
      isTentative(next) ? " tbc" : " " + relCompact(start, endDateOf(next), today)));
    els.heroNext.appendChild(el("span", "cursor"));
    var locs = locationsOf(next);
    var regs = uniqueSorted(locs.map(function (l) {
      return l.region;
    }).filter(Boolean));
    els.heroMeta.textContent = "";
    els.heroMeta.appendChild(el("span", null,
      (isTentative(next) ? "\u2248 " : "") +
      fmtIsoRange(start, endDateOf(next)) + " \u00B7 " +
      locs[0].city + (locs[0].country ? ", " + locs[0].country : "") +
      (locs.length > 1 ? " +" + (locs.length - 1) + " more" : "") +
      (regs.length ? " \u00B7 " + regs.join(" / ") : "") + " \u00B7 "));
    var siteLink = el("a", "hero-link", hostnameOf(next.website) + " \u2197");
    siteLink.href = next.website;
    siteLink.target = "_blank";
    siteLink.rel = "noopener noreferrer";
    els.heroMeta.appendChild(siteLink);
  }

  function render() {
    var today = startOfToday();

    var visible = [];
    var hiddenCount = 0;
    events.forEach(function (ev) {
      if (!matchesFilters(ev)) return;
      if (isHiddenByDefault(ev, today) && !state.showPast) {
        hiddenCount++;
        return;
      }
      visible.push(ev);
    });

    var upcoming = visible.filter(function (ev) {
      return endDateOf(ev) >= today;
    }).sort(function (a, b) {
      return parseDate(a.startDate) - parseDate(b.startDate);
    });
    var past = visible.filter(function (ev) {
      return endDateOf(ev) < today;
    }).sort(function (a, b) {
      return parseDate(b.startDate) - parseDate(a.startDate);
    });

    els.listUpcoming.textContent = "";
    els.listPast.textContent = "";
    renderedRows = [];
    upcoming.concat(past).forEach(function (ev) {
      var target = endDateOf(ev) >= today ? els.listUpcoming : els.listPast;
      target.appendChild(renderRow(ev, today));
    });
    renderedRows = Array.prototype.slice.call(
      document.querySelectorAll(".evt")
    );
    if (selIndex >= renderedRows.length) selIndex = -1;
    markSelected();

    els.pastSeparator.hidden = past.length === 0;
    els.empty.hidden = visible.length !== 0;
    els.clearFilters.hidden = !(state.q || state.region !== "all" ||
      state.type !== "all" || state.scope !== DEFAULT_SCOPE || state.showPast);

    renderHero(upcoming.filter(isCountdownEligible)[0], today);

    els.counts.textContent = "";
    els.counts.appendChild(el("span", "pulse", "\u25CF "));
    var cancelledShown = visible.filter(isCancelled).length;
    var reschedShown = visible.filter(function (ev) {
      return ev.status === "rescheduled";
    }).length;
    var tbcShown = visible.filter(isTentative).length;
    els.counts.appendChild(el("span", null,
      events.length + " listed \u00B7 " + visible.length + " shown" +
      (hiddenCount > 0 ? " \u00B7 " + hiddenCount + " past hidden" : "") +
      (cancelledShown > 0 ? " \u00B7 " + cancelledShown + " cancelled" : "") +
      (reschedShown > 0 ? " \u00B7 " + reschedShown + " rescheduled" : "") +
      (tbcShown > 0 ? " \u00B7 " + tbcShown + " tbc" : "")));

    els.meta.textContent = hiddenCount > 0
      ? hiddenCount + " past " + (hiddenCount === 1 ? "event" : "events") +
        " hidden (ended over a week ago) \u2014 press p to show"
      : "";

    var pastTotal = events.filter(function (ev) {
      return isHiddenByDefault(ev, today);
    }).length;
    els.showPastLabel.textContent =
      (state.showPast ? "hide " : "show ") +
      (pastTotal > 0 ? pastTotal + " past" : "past events");

    syncURL(false);
  }

  // ---------- keyboard navigation (j/k selection) ----------

  function markSelected() {
    renderedRows.forEach(function (row, i) {
      var isSel = i === selIndex;
      row.classList.toggle("sel", isSel);
      var chips = row.querySelectorAll(".chip");
      var want = Math.min(linkIndex, chips.length - 1);
      chips.forEach(function (chip, j) {
        chip.classList.toggle("chip-sel", isSel && j === want);
      });
    });
  }

  function selectedChips() {
    if (selIndex === -1) return [];
    return renderedRows[selIndex].querySelectorAll(".chip");
  }

  function moveLink(delta) {
    var chips = selectedChips();
    if (chips.length === 0) return;
    linkIndex = Math.max(0, Math.min(chips.length - 1, linkIndex + delta));
    markSelected();
  }

  function selectLink(n) {
    var chips = selectedChips();
    if (n < chips.length) {
      linkIndex = n;
      markSelected();
    }
  }

  function moveSel(delta) {
    if (renderedRows.length === 0) return;
    selIndex = Math.max(0, Math.min(renderedRows.length - 1, selIndex + delta));
    linkIndex = 0;
    markSelected();
    var row = renderedRows[selIndex];
    if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }

  function openSelected() {
    var chips = selectedChips();
    if (chips.length === 0) return;
    var chip = chips[Math.min(linkIndex, chips.length - 1)];
    window.open(chip.href, "_blank", "noopener");
  }

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (document.activeElement === els.search) {
        els.search.value = "";
        state.q = "";
        render();
      }
      document.activeElement.blur();
      selIndex = -1;
      linkIndex = 0;
      markSelected();
      return;
    }
    if (typing) {
      if (e.key === "Enter" && document.activeElement === els.search) {
        selIndex = -1;
        moveSel(1);
        e.preventDefault();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      els.search.focus();
      els.search.select();
      e.preventDefault();
    } else if (e.key === "p" || e.key === "P") {
      els.showPast.checked = !els.showPast.checked;
      state.showPast = els.showPast.checked;
      render();
    } else if (e.key === "j") {
      moveSel(1);
    } else if (e.key === "k") {
      moveSel(-1);
    } else if (e.key === "ArrowRight" || e.key === "l") {
      if (selIndex !== -1) { moveLink(1); e.preventDefault(); }
    } else if (e.key === "ArrowLeft" || e.key === "h") {
      if (selIndex !== -1) { moveLink(-1); e.preventDefault(); }
    } else if (e.key >= "1" && e.key <= "9") {
      if (selIndex !== -1) selectLink(parseInt(e.key, 10) - 1);
    } else if (e.key === "Enter") {
      openSelected();
    }
  });

  // ---------- wiring ----------

  els.search.addEventListener("input", function () {
    state.q = els.search.value.trim();
    selIndex = -1;
    render();
  });
  els.region.addEventListener("change", function () {
    state.region = els.region.value;
    selIndex = -1;
    syncURL(true);
    render();
  });
  els.type.addEventListener("change", function () {
    state.type = els.type.value;
    selIndex = -1;
    syncURL(true);
    render();
  });
  els.scope.addEventListener("change", function () {
    state.scope = els.scope.value;
    selIndex = -1;
    syncURL(true);
    render();
  });
  els.showPast.addEventListener("change", function () {
    state.showPast = els.showPast.checked;
    selIndex = -1;
    syncURL(true);
    render();
  });

  function resetFilters() {
    state = { q: "", region: "all", type: "all", scope: DEFAULT_SCOPE, showPast: false };
    els.search.value = "";
    els.region.value = "all";
    els.type.value = "all";
    els.scope.value = DEFAULT_SCOPE;
    els.showPast.checked = false;
    selIndex = -1;
    syncURL(true);
    render();
  }
  els.clearFilters.addEventListener("click", resetFilters);
  els.resetEmpty.addEventListener("click", resetFilters);

  // back/forward between pushed filter states
  window.addEventListener("popstate", function () {
    stateFromURL();
    applyControls();
    render();
  });

  function fillSelect(select, values) {
    var all = el("option", null, "all");
    all.value = "all";
    select.appendChild(all);
    values.forEach(function (v) {
      var o = el("option", null, v);
      o.value = v;
      select.appendChild(o);
    });
  }

  function uniqueSorted(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; }).sort();
  }

  function init(loaded) {
    events = loaded || [];
    fillSelect(els.region, uniqueSorted(events.reduce(function (acc, ev) {
      locationsOf(ev).forEach(function (l) {
        if (l.region) acc.push(l.region);
      });
      return acc;
    }, [])));
    fillSelect(els.type, uniqueSorted(events.map(function (ev) {
      return ev.type;
    })));
    stateFromURL();
    applyControls();
    render();
  }

  function showFetchError(err) {
    els.loadError.hidden = false;
    els.loadError.textContent = location.protocol === "file:"
      ? "events.json can't be fetched from file:// — serve this folder over http " +
        "(\u2018python3 -m http.server\u2019) and open http://localhost:8000"
      : "could not load " + EVENTS_URL + ": " + (err && err.message || err);
    els.cmd.textContent = "\u276F events";
  }

  function showRuntimeError(err) {
    els.loadError.hidden = false;
    els.loadError.textContent = "error while rendering " + EVENTS_URL +
      ": " + (err && err.message || err);
  }

  if (typeof fetch === "function") {
    var fetched = false;
    fetch(EVENTS_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) { fetched = true; init(data.events); })
      .catch(function (err) {
        if (fetched) showRuntimeError(err);
        else showFetchError(err);
      });
  } else {
    showFetchError(new Error("this browser has no fetch()"));
  }
})();
