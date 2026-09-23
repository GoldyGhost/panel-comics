-- À coller dans Supabase > SQL Editor > New query, une seule fois.
-- Ajoute la colonne des visuels de couverture sans toucher aux données déjà présentes.

alter table public.issues add column if not exists cover_url text;
