-- ============================================================
-- GrillHub — fase B: ligação membro-conta, perfil e RSVP
-- Correr UMA vez no SQL Editor do Supabase.
-- ============================================================

-- colunas novas
alter table members add column if not exists username text;
alter table members add column if not exists avatar_url text;
alter table events add column if not exists confirmations jsonb not null default '{}'::jsonb;

-- membro associado à conta autenticada (por email)
create or replace function my_member_id() returns text
language sql stable security definer set search_path = public as $$
  select id from members where lower(email) = lower(auth.jwt()->>'email') limit 1;
$$;

-- o próprio membro edita username / nascimento / avatar
create or replace function update_my_profile(p_username text, p_birth_date date, p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
declare mid text;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  update members
     set username = nullif(trim(p_username), ''),
         birth_date = p_birth_date,
         avatar_url = nullif(trim(p_avatar_url), '')
   where id = mid;
end $$;

-- o próprio membro confirma/desconfirma presença em eventos abertos
create or replace function set_my_confirmation(p_event_id text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; st text; fim date;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  select status, coalesce(date_end, date_start) into st, fim from events where id = p_event_id;
  if st is null then raise exception 'Evento inexistente'; end if;
  if st = 'Concluído' or fim < current_date then raise exception 'Evento já concluído'; end if;
  update events
     set confirmations = jsonb_set(coalesce(confirmations, '{}'::jsonb), array[mid], to_jsonb(p_value))
   where id = p_event_id;
end $$;

revoke execute on function update_my_profile(text, date, text) from public, anon;
revoke execute on function set_my_confirmation(text, boolean) from public, anon;
grant execute on function update_my_profile(text, date, text) to authenticated;
grant execute on function set_my_confirmation(text, boolean) to authenticated;
