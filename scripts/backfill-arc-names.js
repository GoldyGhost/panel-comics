// ============================================================
// scripts/backfill-arc-names.js
//
// Corrige les `arc_name` déjà en base, posés à tort sur le TITRE de
// l'issue elle-même (ex. "Utopia Chapter 1") par un bug de
// import-comicvine.js, au lieu du vrai Story Arc Comic Vine partagé
// par toutes les issues d'un même événement (ex. "Utopia"). C'est ce
// qui empêchait le regroupement "Storyline (across series)" de Browse
// de fonctionner : chaque chapitre avait un arc_name différent.
//
// import-comicvine.js est déjà corrigé pour les FUTURS imports (il
// demande maintenant story_arc_credits à Comic Vine). Ce script-ci ne
// fait que rattraper les lignes déjà importées avant le correctif —
// il ne touche à RIEN d'autre (cover_url, writer, artist, run_name,
// number, year… tous inchangés).
//
// Pour chaque issue "cv-..." déjà en base : récupère son détail Comic
// Vine (story_arc_credits + name), recalcule arc_name avec la même
// règle que import-comicvine.js, et met à jour la ligne SEULEMENT si
// la valeur change.
//
// Reprise après interruption : chaque id déjà traité (changé ou pas)
// est écrit au fur et à mesure dans un fichier de progression (par
// défaut arc-backfill-done.txt, un id par ligne), relu au lancement
// suivant pour ne jamais re-dépenser de quota Comic Vine sur une
// issue déjà vérifiée. Pour tout retraiter, supprime ce fichier (ou
// passe --progress un/autre/chemin.txt).
//
// Usage :
//   node scripts/backfill-arc-names.js
//   node scripts/backfill-arc-names.js --series "Uncanny X-Men"
//   node scripts/backfill-arc-names.js --dry-run     (affiche les changements sans écrire)
//   node scripts/backfill-arc-names.js --progress mon-fichier.txt
// ============================================================

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cvGet, sleep } from "./lib/comicvine.js";
import { getOrCreateArc } from "./lib/taxonomy.js";

const HAS_COMICVINE_KEY = !!(process.env.COMICVINE_API_KEYS || process.env.COMICVINE_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!HAS_COMICVINE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables d'environnement manquantes. Copie .env.example vers .env et remplis-le.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DELAY_MS = 0; // pacing et limites de débit gérés par lib/comicvine.js

function parseArgs() {
  const args = process.argv.slice(2);
  const series = args.includes("--series") ? args[args.indexOf("--series") + 1] : null;
  const dryRun = args.includes("--dry-run");
  const progressFile = args.includes("--progress") ? args[args.indexOf("--progress") + 1] : "arc-backfill-done.txt";
  return { series, dryRun, progressFile };
}

function loadProgress(progressFile) {
  if (!fs.existsSync(progressFile)) return new Set();
  const lines = fs.readFileSync(progressFile, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return new Set(lines);
}

function markDone(progressFile, id) {
  fs.appendFileSync(progressFile, id + "\n", "utf-8");
}

// Même règle que toIssueRow() dans import-comicvine.js.
function computeArcName(detail) {
  return (detail.story_arc_credits && detail.story_arc_credits.length)
    ? detail.story_arc_credits[0].name
    : (detail.name || null);
}

async function fetchAllIssues(seriesFilter) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    // series_title/arc_name ne sont plus des colonnes de `issues` depuis la
    // migration series/runs/arcs (2026-10-24) — lus ici via la vue de
    // compatibilité `issues_view`. series_id est en plus nécessaire pour
    // résoudre/créer le bon arc_id au moment d'écrire (voir plus bas).
    let q = supabase.from("issues_view").select("id, series_id, series_title, arc_name, number, year").like("id", "cv-%").range(from, from + PAGE - 1);
    if (seriesFilter) q = q.eq("series_title", seriesFilter);
    const { data, error } = await q;
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const { series, dryRun, progressFile } = parseArgs();
  const done = loadProgress(progressFile);

  const issues = await fetchAllIssues(series);
  const todo = issues.filter((i) => !done.has(i.id));
  console.log(`${issues.length} issue(s) Comic Vine en base${series ? ` pour "${series}"` : ""}, ${todo.length} à vérifier (${done.size} déjà traitées lors d'un lancement précédent).`);
  if (dryRun) console.log("(--dry-run : rien ne sera écrit, juste affiché)\n");

  let changed = 0, unchanged = 0, failed = 0;
  for (let idx = 0; idx < todo.length; idx++) {
    const row = todo[idx];
    const cvIssueId = row.id.replace(/^cv-/, "");
    let detail;
    try {
      detail = await cvGet(`/issue/4000-${cvIssueId}/`, "field_list=name,story_arc_credits");
      detail = detail.results;
    } catch (e) {
      console.log(`  ✗ ${row.series_title} #${row.number} (${row.id}) — échec Comic Vine : ${e.message}`);
      failed++;
      continue; // pas marqué "done" : sera retenté au prochain lancement
    }

    const newArcName = computeArcName(detail);
    if (newArcName !== row.arc_name) {
      console.log(`  ${row.series_title} #${row.number}${row.year ? " (" + row.year + ")" : ""} : "${row.arc_name ?? "—"}" → "${newArcName ?? "—"}"`);
      if (!dryRun) {
        // arc_name est maintenant résolu en arc_id (table `arcs`, créé au
        // besoin) plutôt qu'écrit en texte libre sur `issues`.
        const newArcId = await getOrCreateArc(supabase, row.series_id, newArcName);
        const { error } = await supabase.from("issues").update({ arc_id: newArcId }).eq("id", row.id);
        if (error) { console.log(`    (échec écriture : ${error.message})`); failed++; continue; }
      }
      changed++;
    } else {
      unchanged++;
    }

    if (!dryRun) markDone(progressFile, row.id); // checkpoint même si inchangé, pour ne jamais re-dépenser de quota dessus
    if ((idx + 1) % 50 === 0) console.log(`  … ${idx + 1}/${todo.length}`);
    await sleep(DELAY_MS);
  }

  console.log(`\nTerminé. ${changed} arc_name corrigé(s), ${unchanged} déjà correct(s), ${failed} échec(s)${dryRun ? " — rien n'a été écrit (--dry-run)" : ""}.`);
  if (failed) console.log("Relance la même commande pour retenter les échecs (les succès ne seront pas redemandés à Comic Vine).");
}

main().catch((err) => { console.error("ERREUR FATALE : " + err.message); process.exit(1); });
