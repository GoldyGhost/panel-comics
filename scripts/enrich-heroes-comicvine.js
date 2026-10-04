// ============================================================
// scripts/enrich-heroes-comicvine.js
//
// Fills the heroes / issue_heroes tables for issues that haven't been
// checked yet (heroes_checked = false). Never touches cover_url,
// writer, artist, run_name or arc_name.
//
// Every character Comic Vine lists for an issue is stored (heroes and
// villains alike, as decided) — this script doesn't try to guess which
// ones are "the hero". Matches per RUN (series_title + run_name), same
// candidate-volume verification as the other enrich scripts.
//
// Marking: once an issue has been queried (found 0, 1 or more
// characters), heroes_checked is set to true so it's never re-queried
// by default. Pass --recheck to also reprocess already-checked issues.
//
// Usage :
//   node scripts/enrich-heroes-comicvine.js
//   node scripts/enrich-heroes-comicvine.js --series "Fantastic Four"
//   node scripts/enrich-heroes-comicvine.js --recheck
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

// In-memory cache: Comic Vine character id -> local heroes.id. Loaded
// once at startup, extended as new characters are met during the run.
const heroCache = new Map();

async function loadHeroCache() {
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase.from("heroes").select("id, comicvine_id").range(from, from + PAGE - 1);
    if (error) throw error;
    for (const h of data) if (h.comicvine_id != null) heroCache.set(h.comicvine_id, h.id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`${heroCache.size} known character(s) loaded from the heroes table.`);
}

async function getOrCreateHero(cvId, name) {
  if (heroCache.has(cvId)) return heroCache.get(cvId);
  const { data, error } = await supabase
    .from("heroes").upsert({ comicvine_id: cvId, name }, { onConflict: "comicvine_id" })
    .select("id").single();
  if (error) { console.error(`    couldn't upsert character "${name}":`, error.message); return null; }
  heroCache.set(cvId, data.id);
  return data.id;
}

// Same exact-name-first matching as the other enrich scripts.
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

async function fetchIssueCharacters(cvIssueId) {
  const json = await cvGet(`/issue/4000-${cvIssueId}/`, "field_list=character_credits");
  return json.results.character_credits || [];
}

async function markChecked(issueId) {
  const { error } = await supabase.from("issues").update({ heroes_checked: true }).eq("id", issueId);
  if (error) console.error(`    couldn't mark #${issueId} as checked:`, error.message);
}

// Tries one candidate volume: for every wanted number found in it,
// fetches the issue detail for its character list, upserts each
// character, links it to the issue, then marks the issue checked.
async function tryVolume(volume, wanted) {
  let offset = 0, total = Infinity, found = 0;
  while (offset < total) {
    const page = await cvGet("/issues/", `filter=volume:${volume.id}&limit=100&offset=${offset}&field_list=id,issue_number`);
    total = page.number_of_total_results;
    for (const issue of page.results) {
      const key = String(parseFloat(issue.issue_number));
      if (!wanted.has(key)) continue;
      const row = wanted.get(key);
      await sleep(DELAY_MS);
      let characters;
      try { characters = await fetchIssueCharacters(issue.id); }
      catch (e) { console.log(`    couldn't fetch characters for #${key}: ${e.message}`); continue; }

      const links = [];
      for (const c of characters) {
        const heroId = await getOrCreateHero(c.id, c.name);
        if (heroId) links.push({ issue_id: row.id, hero_id: heroId });
      }
      if (links.length) {
        const { error } = await supabase.from("issue_heroes").upsert(links, { onConflict: "issue_id,hero_id", ignoreDuplicates: true });
        if (error) console.error(`    couldn't link characters for #${key}:`, error.message);
      }
      await markChecked(row.id);
      found++;
      wanted.delete(key);
      console.log(`    ✓ #${key} — ${characters.length} character(s)${characters.length ? ": " + characters.slice(0, 5).map(c => c.name).join(", ") + (characters.length > 5 ? "…" : "") : ""}`);
    }
    offset += 100;
    if (wanted.size === 0) break;
  }
  return found;
}

async function enrichGroup(seriesTitle, runName, rows) {
  const years = rows.map((r) => r.year).filter(Boolean);
  const approxYear = years.length ? Math.round(years.reduce((a, y) => a + y, 0) / years.length) : null;
  const wanted = new Map(rows.map((r) => [String(r.number), r]));

  console.log(`\n"${seriesTitle}" — ${runName} (${rows.length} issue(s), ~${approxYear || "?"})`);
  const candidates = await findVolumeCandidates(seriesTitle, approxYear || 2000);
  if (!candidates.length) {
    console.log("  no Comic Vine volume found at all — marking checked anyway (nothing more to try).");
    for (const row of wanted.values()) await markChecked(row.id);
    return;
  }

  let totalFound = 0;
  for (const cand of candidates) {
    if (wanted.size === 0) break;
    console.log(`  trying volume ${cand.id} ("${cand.name}", ${cand.start_year || "?"})…`);
    const found = await tryVolume(cand, wanted);
    totalFound += found;
    if (found === 0) console.log("    no match in this volume, trying next candidate.");
  }
  // Whatever's left never matched a real issue in any candidate volume —
  // mark it checked anyway so it isn't retried forever for a lookup
  // failure rather than a genuine "no characters" case.
  for (const row of wanted.values()) await markChecked(row.id);
  console.log(`  → ${totalFound}/${rows.length} issue(s) processed for this run.`);
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

async function fetchRows(includeChecked) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase.from("issues").select("id, series_title, run_name, number, year").range(from, from + PAGE - 1);
    if (!includeChecked) q = q.eq("heroes_checked", false);
    const { data, error } = await q;
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const onlySeries = args.includes("--series") ? args[args.indexOf("--series") + 1] : null;
  const recheck = args.includes("--recheck");

  await loadHeroCache();

  const rows = buildGroups(await fetchRows(recheck), onlySeries);
  console.log(`${rows.length} run(s) to process${recheck ? " (--recheck: including already-checked issues)" : ""}.`);
  for (const g of rows) { await enrichGroup(g.seriesTitle, g.runName, g.rows); await sleep(DELAY_MS); }
}

main().catch((err) => { console.error(err); process.exit(1); });
