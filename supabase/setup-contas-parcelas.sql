-- ============================================================
-- GrillHub — contas: parcelas nas compras "só pago o que como"
-- Correr UMA vez no SQL Editor do Supabase.
-- parcels = [{id, name, price, members: [memberId,...]}, ...]
-- Cada parcela divide o seu preço pelos membros associados;
-- a associação pode ficar por preencher (parcela "por atribuir").
-- ============================================================
alter table purchases add column if not exists parcels jsonb not null default '[]'::jsonb;
alter table vacation_purchases add column if not exists parcels jsonb not null default '[]'::jsonb;
