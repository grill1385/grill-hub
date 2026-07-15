-- ============================================================
-- GrillHub — Férias: contas (compras partilhadas)
-- Correr UMA vez no SQL Editor do Supabase (depois de setup-ferias.sql).
-- Igual às purchases dos eventos, mas ligadas a umas férias.
-- created_at serve para os lembretes de dívida (3 dias depois
-- da compra e depois semanalmente, via scripts/send-debt-reminders.mjs).
-- ============================================================

create table if not exists vacation_purchases (
  id text primary key,
  vacation_id text not null references vacations(id) on delete cascade,
  description text not null,
  total numeric not null,
  payer_member_id text references members(id) on delete set null,
  participants jsonb not null default '[]'::jsonb,
  settled jsonb not null default '{}'::jsonb,
  split text not null default 'equal',       -- equal | custom
  shares jsonb not null default '{}'::jsonb, -- split=custom: {memberId: valor}
  created_at timestamptz not null default now()
);

alter table vacation_purchases enable row level security;
create policy "leitura publica" on vacation_purchases for select using (true);
create policy "escrita membros" on vacation_purchases for all
  using (is_admin() or is_member()) with check (is_admin() or is_member());
