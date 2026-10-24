// ============================================================
// scripts/lib/taxonomy.js
//
// Petites fonctions "get or create" pour les tables normalisées
// series / runs / arcs (migration du 2026-10-24 — voir
// supabase/migration_series_runs_arcs.sql). Avant cette migration,
// chaque ligne de `issues` portait son propre texte libre
// series_title / run_name / arc_name / color, dupliqué à l'identique
// sur des centaines de lignes — source de fautes de frappe
// (ex. "Marvel Super Heroes" vs "Marvel Super-Heroes" jamais
// reconnus comme la même série) et de requêtes de rapprochement
// fragiles. Désormais :
//   - `series`   : un id (= issues.series_id, ex. "cvvol-54428" ou
//                  un slug legacy comme "ff") -> titre + couleur.
//   - `runs`     : un id généré -> (series_id, titre). Notion
//                  purement "maison" (lecture par run éditorial),
//                  Comic Vine n'en a pas — toujours null pour les
//                  imports Comic Vine.
//   - `arcs`     : un id généré -> (series_id, titre). Vient du
//                  story_arc_credits de Comic Vine, ou d'une
//                  intégrale/omnibus "maison" pour les lignes legacy.
//
// Chaque fonction est idempotente : appelée plusieurs fois avec le
// même (series_id, titre), elle renvoie toujours le même id, qu'elle
// vienne de le créer ou qu'il existait déjà (y compris en cas de
// course entre deux appels concurrents — géré via le code d'erreur
// Postgres 23505, violation de contrainte unique).
// ============================================================

export async function getOrCreateSeries(supabase, seriesId, title, color) {
  const { data: existing, error: selErr } = await supabase
    .from("series")
    .select("id")
    .eq("id", seriesId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { error: insErr } = await supabase
    .from("series")
    .insert({ id: seriesId, title, color });
  if (insErr && insErr.code !== "23505") throw insErr;
  return seriesId;
}

export async function getOrCreateRun(supabase, seriesId, title) {
  if (!title) return null;
  const { data: existing, error: selErr } = await supabase
    .from("runs")
    .select("id")
    .eq("series_id", seriesId)
    .eq("title", title)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data: inserted, error: insErr } = await supabase
    .from("runs")
    .insert({ series_id: seriesId, title })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again, error: again_err } = await supabase
        .from("runs").select("id").eq("series_id", seriesId).eq("title", title).single();
      if (again_err) throw again_err;
      return again.id;
    }
    throw insErr;
  }
  return inserted.id;
}

export async function getOrCreateArc(supabase, seriesId, title) {
  if (!title) return null;
  const { data: existing, error: selErr } = await supabase
    .from("arcs")
    .select("id")
    .eq("series_id", seriesId)
    .eq("title", title)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data: inserted, error: insErr } = await supabase
    .from("arcs")
    .insert({ series_id: seriesId, title })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again, error: again_err } = await supabase
        .from("arcs").select("id").eq("series_id", seriesId).eq("title", title).single();
      if (again_err) throw again_err;
      return again.id;
    }
    throw insErr;
  }
  return inserted.id;
}
