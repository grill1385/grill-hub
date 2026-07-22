-- ============================================================
-- GrillHub — Locais recorrentes de eventos
-- Correr UMA vez no SQL Editor do Supabase.
-- Locais onde os eventos acontecem com frequência; link do
-- Google Maps obrigatório. Escrita: só admins. Leitura pública
-- (qualquer membro os pode escolher ao criar um evento).
-- ============================================================

create table if not exists event_places (
  id text primary key,
  name text not null,
  url text not null,                 -- link Google Maps (obrigatório)
  created_at timestamptz not null default now()
);

alter table event_places enable row level security;
drop policy if exists "leitura publica" on event_places;
drop policy if exists "escrita admin" on event_places;
create policy "leitura publica" on event_places for select using (true);
create policy "escrita admin" on event_places for all using (is_admin()) with check (is_admin());

notify pgrst, 'reload schema';
