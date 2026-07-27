-- ============================================================
-- GrillHub — aniversários: desejos de parabéns na homepage
-- Correr UMA vez no SQL Editor do Supabase.
-- Requer: setup-perfil-rsvp.sql (my_member_id) e setup-ferias.sql (is_member).
-- ============================================================
create table if not exists birthday_wishes (
  id text primary key,
  member_id text not null references members(id) on delete cascade,      -- aniversariante
  from_member_id text not null references members(id) on delete cascade, -- quem deseja
  year int not null,
  message text,
  created_at timestamptz default now(),
  unique (member_id, from_member_id, year)
);

alter table birthday_wishes enable row level security;
create policy "leitura publica" on birthday_wishes for select using (true);
create policy "escrita admin" on birthday_wishes for all using (is_admin()) with check (is_admin());
create policy "membro deseja" on birthday_wishes for insert to authenticated
  with check (from_member_id = my_member_id());
create policy "membro edita o seu desejo" on birthday_wishes for update to authenticated
  using (from_member_id = my_member_id()) with check (from_member_id = my_member_id());
create policy "membro apaga o seu desejo" on birthday_wishes for delete to authenticated
  using (from_member_id = my_member_id());
