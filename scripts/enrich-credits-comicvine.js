// ============================================================
// scripts/enrich-credits-comicvine.js
//
// Fills writer/artist for issues that still hold the "—" placeholder
// (mostly the big Kang & Multiverse batch, added without per-issue
// credits at the time). Never touches cover_url, run_name or arc_name.
// Matches per RUN (series_title + run_name) using the same
// candidate-volume verification as enrich-covers-comicvine.js, then
// does one extra per-issue detail call to read the actual credited
// roles (the issues list endpoint doesn't include roles, only names).
//
// "Not found" marker: same convention as enrich-covers-comicvine.js.
// An issue genuinely checked with no writer/artist found on Comic Vine
// gets both fields set to '' instead of staying at '—'. By default
// this script only searches rows where writer = '—' — never looked up
// yet — so re-running it never wastes quota re-searching the same
// misses. Pass --include-not-found to also retry the '' ones, always
// AFTER the never-tried ones.
//
// Usage :
//   node scripts/enrich-credits-comicvine.js
//   node scripts/enrich-credits-comicvine.js --series "Fantastic Four"
//   node scripts/enrich-credits-comicvine.js --include-not-found
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { cvGet, sleep } from "./lib/comicvine.js";

const COMICVINE_API_KEY = process.env.COMICVINE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!COMICVINE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing environment variables. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DELAY_MS = 0; // pacing and rate limits are handled by lib/comicvine.js
const MAX_CANDIDATES = 10;
// Matches a row whose writer is either untried ("—") or a previous
// confirmed miss (''), so an UPDATE still lands during a
// --include-not-found retry pass (where the row is already '', not "—").
const NOT_YET_FOUND = "writer.eq.—,writer.eq.";

// Same exact-name-first matching as enrich-covers-comicvine.js.
async function findVolumeCandidates(title, approxYear) {
  let pool = [];
  try {
    const res = await cvGet("/volumes/", `filter=name:${encodeURIComponent(title)}&field_list=id,name,start_year,publisher&limit=100`);
    pool = res.results || [];
  } catch (e) {
    console.log(`  [debug] /volumes/ lookup failed (${e.message}), falling back to /search/`);
  }
  if (!pool.length) {
    const res = await cvGet("/search/", `resources=volume&query=${encodeURIComponent(title)}&field_list=id,name,start_year,publisher&limit=50`);
    pool = res.results || [];
  }
  const marvel = pool.filter((v) => v.publisher?.name === "Marvel");
  if (marvel.length) pool = marvel;
  const norm = (s) => (s || "").trim().toLowerCase().replace(/^the\s+/, "");
  const targetNorm = norm(title);
  pool.sort((a, b) => {
    const aExact = norm(a.name) === targetNorm ? 0 : 1;
    const bExact = norm(b.name) === targetNorm ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return Math.abs((a.start_year || 0) - approxYear) - Math.abs((b.start_year || 0) - approxYear);
  });
  return pool.slice(0, MAX_CANDIDATES);
}

function pickRole(personCredits, keywords) {
  if (!personCredits) return null;
  const hit = personCredits.find((p) => keywords.some((k) => (p.role || "").toLowerCase().includes(k)));
  return hit?.name || null;
}

async function fetchIssueCredits(cvIssueId) {
  const json = await cvGet(`/issue/4000-${cvIssueId}/`, "field_list=person_credits");
  return json.results.person_credits;
}

// Tries one candidate volume: for every wanted number found in it,
// fetches the issue detail to read credited roles, then updates the
// matching row (only if it still holds the "—" or "" placeholder).
async function tryVolume(volume, seriesTitle, runName, wanted) {
  let offset = 0, total = Infinity, found = 0;
  while (offset < total) {
    const page = await cvGet("/issues/", `filter=volume:${volume.id}&limit=100&offset=${offset}&field_list=id,issue_number`);
    total = page.number_of_total_results;
    for (const issue of page.results) {
      const key = String(parseFloat(issue.issue_number));
      if (!wanted.has(key)) continue;
      await sleep(DELAY_MS);
      let credits;
      try { credits = await fetchIssueCredits(issue.id); }
      catch (e) { console.log(`    couldn't fetch credits for #${key}: ${e.message}`); continue; }
      const writer = pickRole(credits, ["writer"]);
      const artist = pickRole(credits, ["penciler", "penciller", "artist"]);
      if (!writer && !artist) continue;
      const row = wanted.get(key);
      const updates = {};
      if (writer) updates.writer = writer;
      if (artist) updates.artist = artist;
      const { error } = await supabase
        .from("issues").update(updates)
        .eq("series_title", seriesTitle).eq("run_name", runName).eq("number", row.number)
        .or(NOT_YET_FOUND);
      if (error) { console.error(`    update error #${key}:`, error.message); continue; }
      found++;
      wanted.delete(key);
      console.log(`    ✓ #${key} — ${writer || "?"}${artist ? " / " + artist : ""}`);
    }
    offset += 100;
    if (wanted.size === 0) break;
  }
  return found;
}

// Marks every number still left in `wanted` (no writer/artist found in
// ANY candidate volume) as '' rather than leaving it "—", so future
// default runs skip it instead of re-searching for credits that aren't
// findable on Comic Vine.
async function markNotFound(seriesTitle, runName, wanted) {
  if (!wanted.size) return;
  const numbers = [...wanted.values()].map((r) => r.number);
  const { error } = await supabase
    .from("issues").update({ writer: "", artist: "" })
    .eq("series_title", seriesTitle).eq("run_name", runName).in("number", numbers)
    .or(NOT_YET_FOUND);
  if (error) { console.error("  mark-not-found error:", error.message); return; }
  console.log(`  marked ${numbers.length} issue(s) as "not found" — won't be retried unless you pass --include-not-found.`);
}

async function enrichGroup(seriesTitle, runName, rows) {
  const years = rows.map((r) => r.year).filter(Boolean);
  const approxYear = years.length ? Math.round(years.reduce((a, y) => a + y, 0) / years.length) : null;
  const wanted = new Map(rows.map((r) => [String(r.number), r]));

  console.log(`\n"${seriesTitle}" — ${runName} (${rows.length} issue(s), ~${approxYear || "?"})`);
  const candidates = await findVolumeCandidates(seriesTitle, approxYear || 2000);
  if (!candidates.length) {
    console.log("  no Comic Vine volume found at all.");
    await markNotFound(seriesTitle, runName, wanted);
    return;
  }

  let totalFound = 0;
  for (const cand of candidates) {
    if (wanted.size === 0) break;
    console.log(`  trying volume ${cand.id} ("${cand.name}", ${cand.start_year || "?"})…`);
    const found = await tryVolume(cand, seriesTitle, runName, wanted);
    totalFound += found;
    if (found === 0) console.log("    no match in this volume, trying next candidate.");
    await sleep(DELAY_MS);
  }
  console.log(`  → ${totalFound}/${rows.length} credit(s) found for this run.`);
  await markNotFound(seriesTitle, runName, wanted);
}

function buildGroups(rows, onlySeries) {
  const groups = {};
  for (const r of rows) {
    if (onlySeries && r.series_title !== onlySeries) continue;
    const key = r.series_title + "|||" + (r.run_name || "");
    (groups[key] = groups[key] || { seriesTitle: r.series_title, runName: r.run_name || "", rows: [] }).rows.push(r);
  }
  return Object.values(groups);
}

async function fetchRows(wantEmpty) {
  const { data, error } = await supabase
    .from("issues").select("series_title, run_name, number, year")
    .eq("writer", wantEmpty ? "" : "—");
  if (error) throw error;
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const onlySeries = args.includes("--series") ? args[args.indexOf("--series") + 1] : null;
  const includeNotFound = args.includes("--include-not-found") || args.includes("--retry-not-found");

  const neverTried = buildGroups(await fetchRows(false), onlySeries);
  console.log(`${neverTried.length} run(s) never searched yet.`);
  for (const g of neverTried) { await enrichGroup(g.seriesTitle, g.runName, g.rows); await sleep(DELAY_MS); }

  if (includeNotFound) {
    const retry = buildGroups(await fetchRows(true), onlySeries);
    console.log(`\n${retry.length} previously "not found" run(s) to retry (--include-not-found).`);
    for (const g of retry) { await enrichGroup(g.seriesTitle, g.runName, g.rows); await sleep(DELAY_MS); }
  } else {
    console.log(`\nDone with never-tried issues. Add --include-not-found to also retry ones already marked "not found".`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });