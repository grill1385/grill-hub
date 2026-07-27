-- ============================================================
-- GrillHub — "Envergonha": gozar com devedores no scoreboard
-- Correr UMA vez no SQL Editor do Supabase.
-- Requer: setup-perfil-rsvp.sql (my_member_id).
-- 1 vergonha por dia por par (envergonhador → devedor).
-- ============================================================
create table if not exists debt_shames (
  id text primary key,
  member_id text not null references members(id) on delete cascade,      -- o devedor envergonhado
  from_member_id text not null references members(id) on delete cascade, -- quem envergonha
  amount numeric,
  creditors jsonb not null default '[]'::jsonb,                          -- nomes dos credores no momento
  day date not null default current_date,
  cleared boolean not null default false,
  created_at timestamptz default now(),
  unique (member_id, from_member_id, day)
);

alter table debt_shames enable row level security;
create policy "leitura publica" on debt_shames for select using (true);
create policy "escrita admin" on debt_shames for all using (is_admin()) with check (is_admin());
create policy "membro envergonha" on debt_shames for insert to authenticated
  with check (from_member_id = my_member_id() and member_id <> my_member_id());
create policy "envergonhado limpa" on debt_shames for update to authenticated
  using (member_id = my_member_id()) with check (member_id = my_member_id());
