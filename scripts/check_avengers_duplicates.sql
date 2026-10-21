-- A lancer APRES un import Comic Vine de "Avengers", pour repérer les
-- doublons que le filtre automatique du script n'aurait pas pu voir
-- (meme numero, series_id different, ecart d'annee > 1 an).
-- Lecture seule : ne modifie rien, affiche juste les paires suspectes.

with n as (
  select id, series_id, series_title, number, year
  from public.issues
  where regexp_replace(lower(trim(series_title)), '^the\s+', '') = 'avengers'
)
select
  a.series_id as serie_a, a.id as id_a, a.year as annee_a,
  b.series_id as serie_b, b.id as id_b, b.year as annee_b,
  a.number as numero
from n a
join n b on a.number = b.number and a.id < b.id
where abs(coalesce(a.year, 0) - coalesce(b.year, 0)) > 1
order by a.number;
