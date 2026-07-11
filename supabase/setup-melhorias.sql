-- ============================================================
-- GrillHub — melhorias: dispensar associação + divisão custom
-- Correr UMA vez no SQL Editor do Supabase.
-- ============================================================

-- contas que não correspondem a membros (ex.: conta do admin)
alter table profiles add column if not exists dismissed boolean not null default false;
create policy "admins atualizam perfis" on profiles for update using (is_admin()) with check (is_admin());

-- divisão de compras: 'equal' (por todos) ou 'custom' (só pago o que como)
alter table purchases add column if not exists split text not null default 'equal';
alter table purchases add column if not exists shares jsonb not null default '{}'::jsonb;
