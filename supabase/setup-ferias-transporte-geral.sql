-- ============================================================
-- GrillHub — Férias: transportes gerais
-- Correr UMA vez no SQL Editor do Supabase (depois de setup-ferias.sql).
-- Um transporte geral (ex.: carrinha alugada) tem nome, período
-- de uso (date/date_end), preço, links e estado, e pode ser
-- associado a vários deslocamentos entre locais (general_id).
-- ============================================================

alter table vacation_transports add column if not exists is_general boolean not null default false;
alter table vacation_transports add column if not exists name text;
alter table vacation_transports add column if not exists date_end date;
alter table vacation_transports add column if not exists general_id text references vacation_transports(id) on delete set null;
