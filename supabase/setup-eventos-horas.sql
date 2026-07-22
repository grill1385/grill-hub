-- ============================================================
-- GrillHub — Eventos: horas opcionais de início/fim
-- Correr UMA vez no SQL Editor do Supabase.
-- Guardadas como texto "HH:MM" (ou null). O evento passa a
-- "Concluído" após a hora de fim no dia final (se houver hora),
-- senão no fim do dia da marcação.
-- ============================================================

alter table events add column if not exists time_start text;
alter table events add column if not exists time_end text;

notify pgrst, 'reload schema';
