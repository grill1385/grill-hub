-- ============================================================
-- GrillHub — Férias: confirmações de participação
-- Correr UMA vez no SQL Editor do Supabase (depois de setup-ferias.sql).
-- Cada membro confirma a própria participação (RPC abaixo);
-- admins podem editar as confirmações de qualquer membro
-- (update direto, já permitido pelo RLS de vacations).
-- ============================================================

alter table vacations add column if not exists confirmations jsonb not null default '{}'::jsonb;

-- o próprio membro confirma/desconfirma participação em férias futuras
create or replace function set_my_vacation_confirmation(p_vacation_id text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; fim date;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  select coalesce(date_end, date_start) into fim from vacations where id = p_vacation_id;
  if fim is null then raise exception 'Férias inexistentes'; end if;
  if fim < current_date then raise exception 'Férias já realizadas'; end if;
  update vacations
     set confirmations = jsonb_set(coalesce(confirmations, '{}'::jsonb), array[mid], to_jsonb(p_value))
   where id = p_vacation_id;
end $$;

revoke execute on function set_my_vacation_confirmation(text, boolean) from public, anon;
grant execute on function set_my_vacation_confirmation(text, boolean) to authenticated;
