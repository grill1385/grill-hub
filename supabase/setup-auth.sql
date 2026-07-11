-- ============================================================
-- Presenças do Grill — migração para Supabase Auth + tabelas
-- Correr UMA vez no SQL Editor do Supabase.
-- ============================================================

-- 1) Tabelas
create table if not exists roles (
  id text primary key,
  label text not null,
  level int not null default 0
);

create table if not exists members (
  id text primary key,
  name text not null,
  email text,
  birth_date date,
  join_date date,
  role_id text references roles(id) on delete set null
);

create table if not exists events (
  id text primary key,
  name text not null,
  date_start date not null,
  date_end date,
  description text,
  location text,
  location_url text,
  status text not null default 'Por planear',
  presences jsonb not null default '{}'::jsonb
);

create table if not exists admins (
  email text primary key,
  is_main boolean not null default false
);

-- 2) Funções de verificação de permissões
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(auth.jwt()->>'email'));
$$;

create or replace function is_main_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(auth.jwt()->>'email') and is_main);
$$;

-- 3) RLS: leitura pública, escrita só para admins
alter table roles enable row level security;
alter table members enable row level security;
alter table events enable row level security;
alter table admins enable row level security;

create policy "leitura publica" on roles for select using (true);
create policy "leitura publica" on members for select using (true);
create policy "leitura publica" on events for select using (true);
create policy "leitura publica" on admins for select using (true);

create policy "escrita admin" on roles for all using (is_admin()) with check (is_admin());
create policy "escrita admin" on members for all using (is_admin()) with check (is_admin());
create policy "escrita admin" on events for all using (is_admin()) with check (is_admin());

create policy "adicionar admins" on admins for insert with check (is_main_admin());
create policy "remover admins" on admins for delete using (is_main_admin() and not is_main);

-- 4) ADMIN principal (AJUSTA O EMAIL se usares outro para entrar no site)
insert into admins (email, is_main) values ('filipesalazar95@gmail.com', true)
on conflict (email) do update set is_main = true;

-- 5) Migrar dados existentes do blob kv (se houver)
do $$
declare v jsonb;
begin
  select value::jsonb into v from kv where key = 'grill:data';
  if v is null then return; end if;

  insert into roles (id, label, level)
  select r->>'id', r->>'label', coalesce((r->>'level')::int, 0)
  from jsonb_array_elements(coalesce(v->'roles','[]'::jsonb)) r
  on conflict (id) do nothing;

  insert into members (id, name, email, birth_date, join_date, role_id)
  select m->>'id', m->>'name', nullif(m->>'email',''),
         nullif(m->>'birthDate','')::date, nullif(m->>'joinDate','')::date, nullif(m->>'roleId','')
  from jsonb_array_elements(coalesce(v->'members','[]'::jsonb)) m
  on conflict (id) do nothing;

  insert into events (id, name, date_start, date_end, description, location, location_url, status, presences)
  select e->>'id', e->>'name', (e->>'dateStart')::date, nullif(e->>'dateEnd','')::date,
         nullif(e->>'description',''), nullif(e->>'location',''), nullif(e->>'locationUrl',''),
         case when e->>'status' = 'Planeado' then 'Agendado' else coalesce(e->>'status','Por planear') end,
         coalesce(e->'presences','{}'::jsonb)
  from jsonb_array_elements(coalesce(v->'events','[]'::jsonb)) e
  on conflict (id) do nothing;
end $$;

-- 6) Fechar a escrita pública no kv antigo (deixa de ser usado pela app)
drop policy if exists "escrita publica" on kv;
drop policy if exists "update publico" on kv;
