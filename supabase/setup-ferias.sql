-- ============================================================
-- GrillHub — Férias do Grill
-- Correr UMA vez no SQL Editor do Supabase.
-- Tabelas: vacations, vacation_places, vacation_stays,
--          vacation_transports, vacation_tasks
-- RLS: leitura pública; escrita para admins E membros
--      autenticados (conta ligada a um membro por email).
-- ============================================================

-- 1) Tabelas
create table if not exists vacations (
  id text primary key,
  name text not null,
  date_start date not null,
  date_end date not null,
  event_id text references events(id) on delete set null,
  notes text
);

create table if not exists vacation_places (
  id text primary key,
  vacation_id text not null references vacations(id) on delete cascade,
  city text not null,
  country text,
  arrive_date date,
  depart_date date,
  sort int not null default 0
);

create table if not exists vacation_stays (
  id text primary key,
  vacation_id text not null references vacations(id) on delete cascade,
  place_id text not null references vacation_places(id) on delete cascade,
  name text,
  check_in date,
  check_in_time text,
  check_out date,
  check_out_time text,
  price_night_person numeric,
  price_total numeric,
  links jsonb not null default '[]'::jsonb,
  status text not null default 'Por pesquisar'
);

create table if not exists vacation_transports (
  id text primary key,
  vacation_id text not null references vacations(id) on delete cascade,
  from_place_id text references vacation_places(id) on delete set null, -- null = Casinha
  to_place_id text references vacation_places(id) on delete set null,   -- null = Casinha
  date date,
  time text,
  kind text,                      -- Avião, Comboio, Autocarro, ...
  price_person numeric,
  links jsonb not null default '[]'::jsonb,
  status text not null default 'Por pesquisar'
);

create table if not exists vacation_tasks (
  id text primary key,
  vacation_id text not null references vacations(id) on delete cascade,
  auto_key text,                  -- null = tarefa manual; senão identifica a tarefa automática
  title text,                     -- só para manuais
  assignees jsonb not null default '[]'::jsonb,
  due_date date,                  -- só para manuais
  done boolean not null default false -- só para manuais (as automáticas resolvem-se sozinhas)
);

-- 2) Membro autenticado (conta ligada a um membro por email)
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where lower(coalesce(email, '')) = lower(auth.jwt()->>'email')
  );
$$;

-- 3) RLS: leitura pública, escrita para admins e membros
alter table vacations enable row level security;
alter table vacation_places enable row level security;
alter table vacation_stays enable row level security;
alter table vacation_transports enable row level security;
alter table vacation_tasks enable row level security;

create policy "leitura publica" on vacations for select using (true);
create policy "leitura publica" on vacation_places for select using (true);
create policy "leitura publica" on vacation_stays for select using (true);
create policy "leitura publica" on vacation_transports for select using (true);
create policy "leitura publica" on vacation_tasks for select using (true);

create policy "escrita membros" on vacations for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
create policy "escrita membros" on vacation_places for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
create policy "escrita membros" on vacation_stays for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
create policy "escrita membros" on vacation_transports for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
create policy "escrita membros" on vacation_tasks for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
