-- ============================================================
-- PANEL — schéma Supabase (Postgres)
-- À coller entièrement dans Supabase > SQL Editor > New query,
-- puis cliquer "Run". Peut être exécuté une seule fois.
-- ============================================================

-- Table des issues : catalogue PARTAGÉ entre tous les utilisateurs
create table if not exists public.issues (
  id            text primary key,
  series_id     text not null,
  series_title  text not null,
  color         text not null default '#1E3A8A',
  run_name      text,
  arc_name      text,
  number        int not null,
  year          int,
  writer        text,
  artist        text,
  custom        boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

-- Table des lectures loguées : PRIVÉE à chaque utilisateur
create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  issue_id    text not null references public.issues(id) on delete cascade,
  date_read   date not null,
  rating      int check (rating is null or (rating between 0 and 10)), -- demi-étoiles : 0..10
  review      text,
  logged_at   timestamptz not null default now()
);

create index if not exists logs_user_id_idx on public.logs(user_id);
create index if not exists logs_issue_id_idx on public.logs(issue_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

-- ISSUES : tout le monde peut lire (même les visiteurs non connectés) ;
-- seuls les utilisateurs connectés peuvent en ajouter (onglet "Ajouter").
alter table public.issues enable row level security;

create policy "issues: lecture publique"
  on public.issues for select
  using (true);

create policy "issues: ajout par utilisateurs connectés"
  on public.issues for insert
  to authenticated
  with check (true);

-- LOGS : chaque utilisateur ne voit et ne modifie que SES propres lectures.
alter table public.logs enable row level security;

create policy "logs: lecture de ses propres entrées"
  on public.logs for select
  to authenticated
  using (auth.uid() = user_id);

create policy "logs: création de ses propres entrées"
  on public.logs for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "logs: suppression de ses propres entrées"
  on public.logs for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "logs: modification de ses propres entrées"
  on public.logs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Données de départ (échantillon de runs emblématiques Marvel)
-- ============================================================
insert into public.issues (id, series_id, series_title, color, run_name, arc_name, number, year, writer, artist, custom) values
('asm-1-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 1, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-2-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 2, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-3-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 3, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-4-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 4, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-5-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 5, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-6-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Les débuts', 6, 1963, 'Stan Lee', 'Steve Ditko', false),
('asm-7-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Le Sinistre Sextet', 7, 1964, 'Stan Lee', 'Steve Ditko', false),
('asm-8-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Le Sinistre Sextet', 8, 1964, 'Stan Lee', 'Steve Ditko', false),
('asm-9-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Le Sinistre Sextet', 9, 1964, 'Stan Lee', 'Steve Ditko', false),
('asm-10-les', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Lee & Ditko', 'Le Sinistre Sextet', 10, 1964, 'Stan Lee', 'Steve Ditko', false),
('asm-648-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 648, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-649-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 649, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-650-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 650, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-651-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 651, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-652-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 652, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-653-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 653, 2010, 'Dan Slott', 'Humberto Ramos', false),
('asm-654-big', 'asm', 'The Amazing Spider-Man', '#C8202A', 'Dan Slott', 'Big Time', 654, 2010, 'Dan Slott', 'Humberto Ramos', false),
('xmen-129-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 129, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-130-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 130, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-131-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 131, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-132-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 132, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-133-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 133, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-134-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 134, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-135-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 135, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-136-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 136, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-137-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 137, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-138-las', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'La Saga du Phénix Noir', 138, 1980, 'Chris Claremont', 'John Byrne', false),
('xmen-141-days', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'Days of Future Past', 141, 1981, 'Chris Claremont', 'John Byrne', false),
('xmen-142-days', 'xmen', 'X-Men', '#1E3A8A', 'Claremont & Byrne', 'Days of Future Past', 142, 1981, 'Chris Claremont', 'John Byrne', false),
('ff-48-lat', 'ff', 'Fantastic Four', '#1E3A8A', 'Lee & Kirby', 'La Trilogie Galactus', 48, 1966, 'Stan Lee', 'Jack Kirby', false),
('ff-49-lat', 'ff', 'Fantastic Four', '#1E3A8A', 'Lee & Kirby', 'La Trilogie Galactus', 49, 1966, 'Stan Lee', 'Jack Kirby', false),
('ff-50-lat', 'ff', 'Fantastic Four', '#1E3A8A', 'Lee & Kirby', 'La Trilogie Galactus', 50, 1966, 'Stan Lee', 'Jack Kirby', false),
('ff-51-this', 'ff', 'Fantastic Four', '#1E3A8A', 'Lee & Kirby', 'This Man, This Monster', 51, 1966, 'Stan Lee', 'Jack Kirby', false),
('dd-227-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 227, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-228-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 228, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-229-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 229, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-230-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 230, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-231-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 231, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-232-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 232, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('dd-233-born', 'dd', 'Daredevil', '#97141C', 'Frank Miller', 'Born Again', 233, 1986, 'Frank Miller', 'David Mazzucchelli', false),
('hawkeye-1-myl', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'My Life as a Weapon', 1, 2012, 'Matt Fraction', 'David Aja', false),
('hawkeye-2-myl', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'My Life as a Weapon', 2, 2012, 'Matt Fraction', 'David Aja', false),
('hawkeye-3-myl', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'My Life as a Weapon', 3, 2012, 'Matt Fraction', 'David Aja', false),
('hawkeye-4-myl', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'My Life as a Weapon', 4, 2012, 'Matt Fraction', 'David Aja', false),
('hawkeye-5-myl', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'My Life as a Weapon', 5, 2012, 'Matt Fraction', 'David Aja', false),
('hawkeye-6-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 6, 2013, 'Matt Fraction', 'David Aja', false),
('hawkeye-7-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 7, 2013, 'Matt Fraction', 'David Aja', false),
('hawkeye-8-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 8, 2013, 'Matt Fraction', 'David Aja', false),
('hawkeye-9-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 9, 2013, 'Matt Fraction', 'David Aja', false),
('hawkeye-10-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 10, 2013, 'Matt Fraction', 'David Aja', false),
('hawkeye-11-litt', 'hawkeye', 'Hawkeye', '#E8A317', 'Fraction & Aja', 'Little Hits', 11, 2013, 'Matt Fraction', 'David Aja', false),
('msm-1-méta', 'msm', 'Ms. Marvel', '#2E8B57', 'G. Willow Wilson', 'Métamorphose', 1, 2014, 'G. Willow Wilson', 'Adrian Alphona', false),
('msm-2-méta', 'msm', 'Ms. Marvel', '#2E8B57', 'G. Willow Wilson', 'Métamorphose', 2, 2014, 'G. Willow Wilson', 'Adrian Alphona', false),
('msm-3-méta', 'msm', 'Ms. Marvel', '#2E8B57', 'G. Willow Wilson', 'Métamorphose', 3, 2014, 'G. Willow Wilson', 'Adrian Alphona', false),
('msm-4-méta', 'msm', 'Ms. Marvel', '#2E8B57', 'G. Willow Wilson', 'Métamorphose', 4, 2014, 'G. Willow Wilson', 'Adrian Alphona', false),
('msm-5-méta', 'msm', 'Ms. Marvel', '#2E8B57', 'G. Willow Wilson', 'Métamorphose', 5, 2014, 'G. Willow Wilson', 'Adrian Alphona', false),
('vision-1-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 1, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-2-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 2, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-3-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 3, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-4-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 4, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-5-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 5, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-6-litt', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'Little Better Than a Beast', 6, 2015, 'Tom King', 'Gabriel Walta', false),
('vision-7-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 7, 2016, 'Tom King', 'Gabriel Walta', false),
('vision-8-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 8, 2016, 'Tom King', 'Gabriel Walta', false),
('vision-9-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 9, 2016, 'Tom King', 'Gabriel Walta', false),
('vision-10-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 10, 2016, 'Tom King', 'Gabriel Walta', false),
('vision-11-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 11, 2016, 'Tom King', 'Gabriel Walta', false),
('vision-12-all-', 'vision', 'The Vision', '#8B1E3F', 'Tom King', 'All-New, All-Different', 12, 2016, 'Tom King', 'Gabriel Walta', false),
('ihulk-1-ori', 'ihulk', 'Immortal Hulk', '#2F5B2F', 'Al Ewing', 'Or Is He Both?', 1, 2018, 'Al Ewing', 'Joe Bennett', false),
('ihulk-2-ori', 'ihulk', 'Immortal Hulk', '#2F5B2F', 'Al Ewing', 'Or Is He Both?', 2, 2018, 'Al Ewing', 'Joe Bennett', false),
('ihulk-3-ori', 'ihulk', 'Immortal Hulk', '#2F5B2F', 'Al Ewing', 'Or Is He Both?', 3, 2018, 'Al Ewing', 'Joe Bennett', false),
('ihulk-4-ori', 'ihulk', 'Immortal Hulk', '#2F5B2F', 'Al Ewing', 'Or Is He Both?', 4, 2018, 'Al Ewing', 'Joe Bennett', false),
('ihulk-5-ori', 'ihulk', 'Immortal Hulk', '#2F5B2F', 'Al Ewing', 'Or Is He Both?', 5, 2018, 'Al Ewing', 'Joe Bennett', false),
('civilwar-1-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 1, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-2-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 2, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-3-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 3, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-4-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 4, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-5-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 5, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-6-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 6, 2006, 'Mark Millar', 'Steve McNiven', false),
('civilwar-7-civi', 'civilwar', 'Civil War', '#3B3B3B', 'Mark Millar', 'Civil War', 7, 2006, 'Mark Millar', 'Steve McNiven', false),
('hox-1-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 1, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-2-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 2, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-3-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 3, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-4-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 4, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-5-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 5, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-6-hous', 'hox', 'House of X / Powers of X', '#B08900', 'House of X', 'House of X', 6, 2019, 'Jonathan Hickman', 'Pepe Larraz', false),
('hox-1-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 1, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('hox-2-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 2, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('hox-3-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 3, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('hox-4-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 4, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('hox-5-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 5, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('hox-6-powe', 'hox', 'House of X / Powers of X', '#B08900', 'Powers of X', 'Powers of X', 6, 2019, 'Jonathan Hickman', 'R.B. Silva', false),
('oml-66-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 66, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-67-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 67, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-68-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 68, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-69-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 69, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-70-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 70, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-71-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 71, 2008, 'Mark Millar', 'Steve McNiven', false),
('oml-72-old', 'oml', 'Wolverine', '#4A2E1E', 'Mark Millar', 'Old Man Logan', 72, 2008, 'Mark Millar', 'Steve McNiven', false),
('secretwars-1-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 1, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-2-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 2, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-3-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 3, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-4-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 4, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-5-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 5, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-6-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 6, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-7-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 7, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-8-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 8, 2015, 'Jonathan Hickman', 'Esad Ribić', false),
('secretwars-9-secr', 'secretwars', 'Secret Wars', '#B22222', 'Jonathan Hickman', 'Secret Wars', 9, 2015, 'Jonathan Hickman', 'Esad Ribić', false)
on conflict (id) do nothing;
