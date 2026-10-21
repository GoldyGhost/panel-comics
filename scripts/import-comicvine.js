// ============================================================
// scripts/import-comicvine.js
//
// Importe des comics depuis l'API Comic Vine (comicvine.gamespot.com)
// dans la table `issues` de Supabase. Remplace scripts/import-marvel.js
// depuis la fermeture du portail développeur Marvel (29 octobre 2025,
// plus aucune nouvelle inscription possible).
//
// Comic Vine référence tous les éditeurs (pas seulement Marvel) : on
// filtre par éditeur pour rester sur des comics Marvel si besoin.
//
// Pas de mode "tout importer" : il faut toujours préciser --title,
// --volume ou --file. C'est volontaire — Comic Vine n'offre aucune
// liste fiable de "tous les comics Marvel" à parcourir, et même en
// bidouillant une liste, ça représenterait des dizaines de milliers
// de requêtes, bien au-delà du quota horaire. Le script importe un
// volume vérifié à la fois, jamais à l'aveugle.
//
// Un titre exact (ex. "Avengers") importe TOUS les volumes Comic Vine
// portant exactement ce nom, toutes années confondues (1963, 1998,
// 2010, 2012…) — chacun garde son propre series_id (basé sur l'id de
// volume Comic Vine), donc aucun risque de les mélanger entre eux.
//
// Remplacement des doublons non-Comic-Vine : Comic Vine est la source
// de vérité. Avant d'écrire un numéro, on cherche dans TOUTE la table
// issues une ligne NON "cv-" (ajoutée à la main, un autre site, etc.)
// qui représente le même comic (titre normalisé + numéro + année à
// ±1 an). Si trouvée, elle est REMPLACÉE : les logs, listes de lecture
// et liens héros qui pointaient dessus sont repointés vers la nouvelle
// ligne Comic Vine, puis l'ancienne ligne est supprimée.
//
// ⚠️ Règle de sécurité (bug "Moon Knight", corrigé) : on ne compare et
// on ne remplace JAMAIS deux lignes Comic Vine ("cv-...") entre elles,
// même très proches en année. Deux volumes Comic Vine distincts (ex.
// une série relancée 2 ans plus tard) ne sont jamais des doublons l'un
// de l'autre — seule une ligne NON "cv-" peut être remplacée. Et comme
// chaque numéro Comic Vine est désormais TOUJOURS importé (jamais sauté
// à cause d'un faux doublon), un vrai nouveau numéro ne peut plus être
// perdu silencieusement comme ça l'a été pour Moon Knight #1/#2 2016.
//
// Reprise après interruption, à deux niveaux :
//  - entre séries (--file) : voir plus bas.
//  - À L'INTÉRIEUR d'une série : avant de dépenser une requête Comic
//    Vine coûteuse (le détail d'un numéro, pour ses crédits), le
//    script vérifie d'abord — via une simple requête Supabase, qui ne
//    compte pas dans le quota Comic Vine — si ce numéro est déjà en
//    base. Si oui, il est sauté sans appel API, MAIS le remplacement
//    de doublon non-Comic-Vine est quand même tenté pour ce numéro
//    (à coût nul en quota), pour que relancer le script sur une série
//    déjà importée nettoie aussi les doublons découverts depuis.
//
// Import en lot (--file) : un fichier texte, une série par ligne
// (le "- " ou "* " de puce est optionnel, les lignes vides et celles
// commençant par # sont ignorées). Après CHAQUE série importée avec
// succès, le script réécrit le fichier en préfixant sa ligne de "✓ " ;
// une série introuvable sur Comic Vine est préfixée de "✗ " plutôt que
// réessayée indéfiniment. Ce marquage se fait ligne par ligne au fur
// et à mesure (pas seulement à la toute fin) : une interruption —
// quota Comic Vine, ordinateur éteint, Ctrl+C — ne fait jamais perdre
// la progression déjà faite. Relancer la même commande reprend
// exactement où ça s'est arrêté. Pour retenter une ligne en ✓ ou ✗,
// il suffit de retirer le symbole à la main dans le fichier.
//
// Fichier de log : chaque numéro réellement ajouté (et chaque série
// traitée) est aussi écrit, avec horodatage, dans un fichier log en
// plus de l'affichage dans le terminal — par défaut import-log.txt,
// changeable avec --log chemin/vers/fichier.txt. Les lignes
// s'ajoutent au fichier (jamais écrasées), donc plusieurs lancements
// successifs gardent tout l'historique.
//
// Nécessite Node.js 18+ et les variables listées dans .env.example
// (COMICVINE_API_KEY ou COMICVINE_API_KEYS, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY).
//
// Usage :
//   node scripts/import-comicvine.js --title "Amazing Spider-Man"
//   node scripts/import-comicvine.js --volume 2005      (id de volume Comic Vine précis)
//   node scripts/import-comicvine.js --file series.txt
//   node scripts/import-comicvine.js --file series.txt --log mon-log.txt
// ============================================================

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cvGet, sleep } from "./lib/comicvine.js";

// La clé Comic Vine elle-même est lue par lib/comicvine.js (COMICVINE_API_KEYS,
// une ou plusieurs clés séparées par des virgules) — on vérifie juste ici
// qu'au moins une des deux variantes est renseignée.
const HAS_COMICVINE_KEY = !!(process.env.COMICVINE_API_KEYS || process.env.COMICVINE_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!HAS_COMICVINE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables d'environnement manquantes. Copie .env.example vers .env et remplis-le.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PAGE_LIMIT = 100;
const DELAY_MS = 0; // pacing and rate limits are handled by lib/comicvine.js

// Tolérance d'année pour considérer qu'une ligne NON Comic Vine
// représente le même comic qu'une ligne Comic Vine qu'on importe.
// Volontairement étroite (±1 an) : au-delà, deux séries distinctes
// portant le même titre et réutilisant les mêmes numéros (ex. Moon
// Knight relancé 2 à 3 ans plus tard) deviennent trop probables pour
// qu'un rapprochement automatique soit sûr.
const LEGACY_MATCH_YEAR_TOLERANCE = 1;

// ---------------- Fichier de log (console + fichier, jamais écrasé) ----------------
let LOG_FILE = "import-log.txt";
function logLine(msg) {
  const stamped = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, stamped + "\n", "utf-8"); }
  catch (e) { /* le log est un plus, jamais bloquant si l'écriture échoue */ }
}

function pickRole(personCredits, keywords) {
  if (!personCredits) return null;
  const hit = personCredits.find((p) => keywords.some((k) => (p.role || "").toLowerCase().includes(k)));
  return hit?.name || null;
}

// Comic Vine issue numbers aren't always clean numbers: special/bonus
// chapters get a letter suffix glued onto a base number (e.g. "10AI" and
// "10AU", both real, distinct issues of Age of Ultron 2013), or are pure
// letters ("AU", "NOW"). A plain parseFloat() stops at the first non-digit
// character, so "10AI" silently became 10 — colliding with the real #10
// on the (series_id, number, year) upsert key and getting skipped by the
// collision guard in upsertIssues() instead of being imported.
//
// Fix: split a numeric prefix (if any) from the rest, and when there IS a
// non-numeric remainder, nudge `number` by a tiny deterministic offset
// (derived from the suffix itself, so re-running the import always gives
// back the exact same value and two different suffixes on the same base
// essentially never collide) so it sorts right after its base number
// without ever equalling it. The exact original string ("10AI") is kept
// in number_label for display — index.html shows that instead of the
// numeric value whenever it's set.
function parseIssueNumber(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(.*)$/);
  const base = m ? parseFloat(m[1]) : (parseFloat(s) || 0);
  const suffix = (m ? m[2] : s).trim();
  if (!suffix) return { number: base, label: null }; // clean number (10, 25.1…) — no label needed
  let offset = 0, scale = 1 / 37;
  for (const ch of suffix.toUpperCase()) {
    const code = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : (ch >= "A" && ch <= "Z" ? ch.charCodeAt(0) - 55 : 0);
    offset += (code / 36) * scale;
    scale /= 37;
  }
  return { number: base + Math.min(offset, 0.9), label: s };
}

function toIssueRow(issue, seriesTitle, volumeId) {
  const writer = pickRole(issue.person_credits, ["writer", "script"]);
  const artist = pickRole(issue.person_credits, ["penciler", "artist", "penciller"]);
  const year = issue.cover_date ? issue.cover_date.slice(0, 4) : null;
  // The real Comic Vine Story Arc (shared by every chapter/tie-in of the
  // same event, e.g. "Utopia") — NOT issue.name, which is this single
  // issue's own title (e.g. "Utopia Chapter 1") and used to be used here
  // by mistake, fragmenting the "storyline" grouping in Browse into one
  // group per issue instead of one group per arc. Falls back to the
  // issue's own title when Comic Vine lists no story arc for it (a lot
  // of standalone issues genuinely have none).
  const arcName = (issue.story_arc_credits && issue.story_arc_credits.length)
    ? issue.story_arc_credits[0].name
    : (issue.name || null);
  const { number, label } = parseIssueNumber(issue.issue_number);
  return {
    id: `cv-${issue.id}`,
    series_id: `cvvol-${volumeId}`,
    series_title: seriesTitle,
    color: "#1E3A8A",
    run_name: null,
    arc_name: arcName,
    number,
    number_label: label,
    year: year ? parseInt(year, 10) : null,
    writer,
    artist,
    cover_url: issue.image?.original_url || issue.image?.medium_url || null,
    custom: false,
  };
}

// Normalise un titre pour comparaison (insensible à "The", la casse,
// les tirets/points/apostrophes) — même convention que les scripts SQL
// de ce projet (restore_issues.sql, les scripts de watchlist, etc.).
function normTitle(t) {
  return (t || "").toLowerCase().replace(/^the\s+/, "").replace(/[-.:,'’]+/g, "").replace(/\s+/g, " ").trim();
}

function isComicVineId(id) {
  return typeof id === "string" && id.startsWith("cv-");
}

// Postgres refuse qu'un seul upsert touche deux fois la même clé de
// conflit (ex. deux couvertures variantes du même numéro renvoyées par
// Comic Vine avec le même series_id/number/year) — "ON CONFLICT DO
// UPDATE command cannot affect row a second time". On ne garde donc
// qu'une ligne par clé avant d'écrire.
function dedupeWithinBatch(rows) {
  const byKey = new Map();
  const dupes = [];
  for (const r of rows) {
    const key = `${r.series_id}|${r.number}|${r.year}`;
    if (byKey.has(key)) dupes.push(r); else byKey.set(key, r);
  }
  if (dupes.length) {
    logLine(`  ${dupes.length} variante(s) interne(s) au même lot (même numéro/année), une seule gardée : ` +
      dupes.map((r) => `${r.series_title} #${r.number}`).join(", "));
  }
  return [...byKey.values()];
}

// ---------------- Remplacement des doublons NON Comic Vine ----------------
// Tables qui référencent une issue par son id, et comment les repointer.
//  - "logs" a sa propre colonne id (clé primaire), donc un repointage
//    par lot (.in("id", …)) est possible.
//  - "watchlist_items" et "issue_heroes" n'ont PAS de colonne id propre
//    (clé primaire composite), donc chaque ligne doit être traitée
//    individuellement par sa vraie clé composite.
const REPOINT_TABLES = [
  { table: "logs", mode: "id", matchColumn: "user_id" },
  { table: "watchlist_items", mode: "composite", keyColumn: "watchlist_id" },
  { table: "issue_heroes", mode: "composite", keyColumn: "hero_id" },
];

async function repointTableById(table, matchColumn, oldId, newId) {
  const { data: onNew, error: e1 } = await supabase.from(table).select(matchColumn).eq("issue_id", newId);
  if (e1) { logLine(`  (repoint ${table} impossible : ${e1.message})`); return; }
  const already = new Set((onNew || []).map((r) => r[matchColumn]));

  const { data: onOld, error: e2 } = await supabase.from(table).select(`id, ${matchColumn}`).eq("issue_id", oldId);
  if (e2) { logLine(`  (repoint ${table} impossible : ${e2.message})`); return; }

  const toDelete = (onOld || []).filter((r) => already.has(r[matchColumn])).map((r) => r.id);
  const toUpdate = (onOld || []).filter((r) => !already.has(r[matchColumn])).map((r) => r.id);

  if (toDelete.length) {
    // Déjà présent sur la nouvelle ligne pour ce même user : l'ancienne
    // ligne redondante est supprimée plutôt que de créer un doublon.
    const { error } = await supabase.from(table).delete().in("id", toDelete);
    if (error) logLine(`  (suppression ${table} redondants impossible : ${error.message})`);
  }
  if (toUpdate.length) {
    const { error } = await supabase.from(table).update({ issue_id: newId }).in("id", toUpdate);
    if (error) logLine(`  (repoint ${table} impossible : ${error.message})`);
  }
}

async function repointTableByCompositeKey(table, keyColumn, oldId, newId) {
  const { data: onNew, error: e1 } = await supabase.from(table).select(keyColumn).eq("issue_id", newId);
  if (e1) { logLine(`  (repoint ${table} impossible : ${e1.message})`); return; }
  const already = new Set((onNew || []).map((r) => r[keyColumn]));

  const { data: onOld, error: e2 } = await supabase.from(table).select(keyColumn).eq("issue_id", oldId);
  if (e2) { logLine(`  (repoint ${table} impossible : ${e2.message})`); return; }

  for (const r of onOld || []) {
    const keyValue = r[keyColumn];
    if (already.has(keyValue)) {
      const { error } = await supabase.from(table).delete().eq("issue_id", oldId).eq(keyColumn, keyValue);
      if (error) logLine(`  (suppression ${table} redondant impossible : ${error.message})`);
    } else {
      const { error } = await supabase.from(table).update({ issue_id: newId }).eq("issue_id", oldId).eq(keyColumn, keyValue);
      if (error) logLine(`  (repoint ${table} impossible : ${error.message})`);
    }
  }
}

async function replaceLegacyIssue(oldId, newId, seriesTitle, number, year) {
  for (const t of REPOINT_TABLES) {
    if (t.mode === "id") await repointTableById(t.table, t.matchColumn, oldId, newId);
    else await repointTableByCompositeKey(t.table, t.keyColumn, oldId, newId);
  }
  const { error } = await supabase.from("issues").delete().eq("id", oldId);
  if (error) { logLine(`  (suppression de l'ancienne ligne ${oldId} impossible : ${error.message})`); return; }
  logLine(`  ↺ remplacé : ${seriesTitle} #${number}${year ? " (" + year + ")" : ""} — ${oldId} → ${newId}`);
}

// Pour chaque ligne Comic Vine déjà écrite (ou déjà présente) dans
// `rows`, cherche une ligne NON Comic Vine qui représente le même
// comic (titre normalisé + numéro + année à ±1 an) et la remplace.
// Ne compare et ne remplace jamais deux lignes "cv-" entre elles.
async function replaceLegacyDuplicates(rows) {
  const numbers = [...new Set(rows.map((r) => r.number))];
  if (!numbers.length) return;
  const { data: existing, error } = await supabase
    .from("issues")
    .select("id, series_title, number, year")
    .in("number", numbers);
  if (error) { logLine("  (vérif doublons à remplacer impossible : " + error.message + ")"); return; }

  const legacy = (existing || []).filter((e) => !isComicVineId(e.id));
  for (const row of rows) {
    const match = legacy.find(
      (e) => e.number === row.number && normTitle(e.series_title) === normTitle(row.series_title) &&
        (e.year == null || row.year == null || Math.abs(e.year - row.year) <= LEGACY_MATCH_YEAR_TOLERANCE)
    );
    if (match) await replaceLegacyIssue(match.id, row.id, row.series_title, row.number, row.year);
  }
}

async function upsertIssues(rows) {
  if (!rows.length) return;
  const deduped = dedupeWithinBatch(rows);
  if (!deduped.length) return;

  // L'upsert ci-dessous se fait sur la contrainte (series_id, number,
  // year), PAS sur id. Si Comic Vine donne deux issues RÉELLEMENT
  // différentes (deux id Comic Vine distincts — variante, numérotation
  // double lors d'une renumérotation éditoriale…) qui tombent sur le
  // même (series_id, number, year), l'upsert tenterait de changer l'id
  // de la ligne déjà en base — ce que Postgres refuse dès qu'une autre
  // table (issue_heroes, logs…) référence cet id par clé étrangère.
  // On détecte ce cas AVANT d'upserter : si le "slot" est déjà occupé
  // par un id différent, on garde l'existant et on log l'écart pour
  // vérification manuelle, plutôt que de planter tout l'import.
  const seriesIds = [...new Set(deduped.map((r) => r.series_id))];
  const { data: existingSlots, error: slotErr } = await supabase
    .from("issues")
    .select("id, series_id, number, year")
    .in("series_id", seriesIds);
  if (slotErr) logLine(`  (vérif des slots impossible, on tente l'upsert tel quel : ${slotErr.message})`);
  const bySlot = new Map((existingSlots || []).map((e) => [`${e.series_id}|${e.number}|${e.year}`, e.id]));

  const toWrite = [];
  for (const r of deduped) {
    const slotKey = `${r.series_id}|${r.number}|${r.year}`;
    const existingId = bySlot.get(slotKey);
    if (existingId && existingId !== r.id) {
      logLine(`  ⚠ collision Comic Vine : ${r.series_title} #${r.number}${r.year ? " (" + r.year + ")" : ""} existe déjà sous un autre id (${existingId} ≠ ${r.id}) — gardé tel quel, à vérifier à la main`);
      continue;
    }
    toWrite.push(r);
  }
  if (!toWrite.length) return;

  const { error } = await supabase.from("issues").upsert(toWrite, { onConflict: "series_id,number,year" });
  if (error) throw error;
  for (const r of toWrite) {
    logLine(`  + ${r.series_title} #${r.number}${r.year ? " (" + r.year + ")" : ""} — ${r.id}`);
  }
  logLine(`  → ${toWrite.length} issue(s) synchronisée(s)`);
  await replaceLegacyDuplicates(toWrite);
}

// Récupère le détail d'une issue (nécessaire pour avoir les rôles des
// créateurs — les listes paginées ne donnent que le nom, sans le rôle).
async function fetchIssueDetail(issueId) {
  const json = await cvGet(`/issue/4000-${issueId}/`, "field_list=id,issue_number,name,cover_date,image,person_credits,story_arc_credits");
  return json.results;
}

async function importVolume(volumeId, seriesTitleOverride) {
  const volInfo = await cvGet(`/volume/4050-${volumeId}/`, "field_list=id,name,start_year,publisher");
  const seriesTitle = seriesTitleOverride || volInfo.results.name;
  logLine(`Import de "${seriesTitle}" (volume ${volumeId})…`);

  let offset = 0, total = Infinity, rows = [];
  let skippedAlreadyDone = 0;
  while (offset < total) {
    const page = await cvGet(
      "/issues/",
      `filter=volume:${volumeId}&limit=${PAGE_LIMIT}&offset=${offset}&sort=issue_number:asc&field_list=id,issue_number`
    );
    total = page.number_of_total_results;

    // Reprise efficace : vérifie (requête Supabase, hors quota Comic
    // Vine) lesquels de cette page sont déjà en base avant de dépenser
    // un appel Comic Vine coûteux pour leur détail.
    const candidateIds = page.results.map((l) => `cv-${l.id}`);
    const alreadyMap = new Map();
    if (candidateIds.length) {
      const { data: already, error } = await supabase.from("issues").select("id, number, year").in("id", candidateIds);
      if (!error && already) for (const r of already) alreadyMap.set(r.id, r);
    }

    // Numéros déjà en base : à coût nul en quota Comic Vine, on tente
    // quand même le remplacement d'un éventuel doublon non-Comic-Vine
    // découvert depuis le dernier lancement.
    const alreadyRows = [];

    for (const light of page.results) {
      const rowId = `cv-${light.id}`;
      if (alreadyMap.has(rowId)) {
        skippedAlreadyDone++;
        const a = alreadyMap.get(rowId);
        alreadyRows.push({ id: rowId, series_title: seriesTitle, number: a.number, year: a.year });
        continue;
      }
      await sleep(DELAY_MS);
      const full = await fetchIssueDetail(light.id);
      rows.push(toIssueRow(full, seriesTitle, volumeId));
      if (rows.length >= 20) { await upsertIssues(rows); rows = []; }
    }

    if (alreadyRows.length) await replaceLegacyDuplicates(alreadyRows);
    offset += PAGE_LIMIT;
  }
  await upsertIssues(rows);
  if (skippedAlreadyDone) logLine(`  (${skippedAlreadyDone} numéro(s) déjà importé(s) lors d'un lancement précédent, sauté(s) sans requête Comic Vine)`);
}

// Retourne true si au moins un volume correspondant au titre a été
// trouvé (et importé), false si Comic Vine n'a rien donné du tout —
// pour que l'appelant (notamment --file) sache distinguer "importé"
// de "introuvable" plutôt que de traiter les deux comme un succès.
async function importByTitle(title) {
  // /volumes/?filter=name: lists every volume whose name contains the title
  // (broader than /search/, which sometimes truncates before the real hit).
  const res = await cvGet("/volumes/", `filter=name:${encodeURIComponent(title)}&field_list=id,name,start_year,publisher&limit=100`);
  const norm = (s) => (s || "").trim().toLowerCase().replace(/^the\s+/, "");
  const targetNorm = norm(title);
  const exact = res.results.filter((v) => norm(v.name) === targetNorm);
  const pool = exact.length ? exact : res.results;
  const marvelResults = pool.filter((v) => v.publisher?.name === "Marvel");
  const candidates = marvelResults.length ? marvelResults : pool;
  if (!candidates.length) {
    logLine(`Aucune série trouvée pour "${title}"`);
    return false;
  }
  candidates.sort((a, b) => (a.start_year || 0) - (b.start_year || 0));
  logLine(`${candidates.length} volume(s) Marvel exactement nommé(s) "${title}" trouvé(s) :`);
  candidates.forEach((v) => logLine(`  - volume ${v.id} : "${v.name}" (${v.start_year || "?"})`));
  for (const v of candidates) {
    await importVolume(v.id, title); // garde le titre demandé comme series_title, pour rester cohérent
    await sleep(DELAY_MS);
  }
  return true;
}

// --file : lit un fichier texte (une série par ligne), importe chacune
// à son tour, et réécrit le fichier au fur et à mesure pour ne jamais
// reperdre la progression en cas d'interruption.
async function importFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    logLine(`Fichier introuvable : ${filePath}`);
    return;
  }
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const persist = () => fs.writeFileSync(filePath, lines.join("\n"), "utf-8");

  const pending = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("✓") || t.startsWith("✗")) return;
    pending.push(i);
  });
  logLine(`${pending.length} série(s) à importer dans ${filePath} (les lignes déjà ✓ ou ✗ sont ignorées).`);

  for (const i of pending) {
    const title = lines[i].trim().replace(/^[-*•]\s*/, "");
    if (!title) continue;
    logLine(`\n=== ${title} ===`);
    try {
      const found = await importByTitle(title);
      lines[i] = found ? `✓ ${title}` : `✗ ${title}`;
      persist(); // checkpoint tout de suite, pas seulement à la fin
    } catch (e) {
      // Erreur inattendue (réseau, Supabase…) : on laisse la ligne telle
      // quelle (ni ✓ ni ✗) pour qu'elle soit retentée au prochain lancement.
      // Les numéros déjà écrits avant le plantage restent en base (voir
      // upsertIssues, appelé par lots de 20 au fur et à mesure) et ne
      // seront pas redemandés à Comic Vine au prochain passage.
      logLine(`  Erreur sur "${title}", retentée au prochain lancement : ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  logLine("\nTerminé (ou interrompu en cours de route — relance la même commande pour reprendre où ça s'est arrêté).");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--log")) LOG_FILE = args[args.indexOf("--log") + 1];
  logLine(`--- Lancement (log: ${LOG_FILE}) ---`);
  if (args.includes("--volume")) {
    await importVolume(args[args.indexOf("--volume") + 1]);
  } else if (args.includes("--title")) {
    await importByTitle(args[args.indexOf("--title") + 1]);
  } else if (args.includes("--file")) {
    await importFromFile(args[args.indexOf("--file") + 1]);
  } else {
    console.log('Usage : node scripts/import-comicvine.js --title "Amazing Spider-Man"');
    console.log("        node scripts/import-comicvine.js --volume 2005");
    console.log("        node scripts/import-comicvine.js --file series.txt");
    console.log("        (ajoute --log chemin/vers/fichier.txt pour changer le fichier de log)");
  }
}

main().catch((err) => { logLine("ERREUR FATALE : " + err.message); process.exit(1); });

// ============================================================
// NOTES :
// 1. Comic Vine limite le nombre de requêtes par heure (vérifie le
//    chiffre actuel sur ton compte comicvine.gamespot.com/api/) — ce
//    script fait UNE requête détaillée par issue (pour les crédits),
//    donc une série de 100 numéros = ~100 requêtes, SAUF pour les
//    numéros déjà en base lors d'un lancement précédent (sautés sans
//    requête Comic Vine, voir importVolume).
// 2. Comic Vine couvre tous les éditeurs : le filtre "Marvel" n'est
//    appliqué qu'à la recherche par titre (--title et --file), pas
//    par --volume où tu donnes directement l'id exact.
// 3. Comme pour Marvel, `run_name` (notion de run éditorial) n'existe
//    pas dans Comic Vine : laissé vide, à compléter à la main si besoin.
// 4. Un numéro Comic Vine est TOUJOURS importé, jamais sauté à cause
//    d'un doublon présumé — seul le remplacement d'une éventuelle ligne
//    NON Comic Vine (±1 an, jamais deux lignes "cv-" entre elles) se
//    produit en plus de l'import. C'est ce qui évite le bug "Moon
//    Knight" : plus aucun vrai numéro ne peut être perdu silencieusement.
// ============================================================
