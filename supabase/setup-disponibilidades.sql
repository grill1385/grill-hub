-- ============================================================
-- GrillHub — Mapa de Disponibilidade dos membros
-- Correr UMA vez no SQL Editor do Supabase.
-- Requer: setup-perfil-rsvp.sql (my_member_id) e setup-auth.sql (is_admin).
--
-- Uma linha por membro e por mês, com um jsonb dia -> estado:
--   { "2026-08-03": "livre", "2026-08-04": "ocupado", ... }
-- Estados possíveis: 'livre' | 'ocupado' | 'indeciso'.
-- (Guardar por mês em vez de por dia mantém o número de linhas baixo —
--  ~1 linha por membro/mês — e evita o limite de 1000 linhas do PostgREST.)
-- ============================================================

create table if not exists availabilities (
  member_id text not null references members(id) on delete cascade,
  month text not null,                                  -- 'YYYY-MM'
  days jsonb not null default '{}'::jsonb,              -- { 'YYYY-MM-DD': 'livre'|'ocupado'|'indeciso' }
  updated_at timestamptz not null default now(),
  primary key (member_id, month)
);

create index if not exists availabilities_month_idx on availabilities (month);

alter table availabilities enable row level security;

drop policy if exists "leitura publica" on availabilities;
create policy "leitura publica" on availabilities for select using (true);

-- o próprio membro gere a sua disponibilidade (a UI usa a RPC abaixo,
-- mas estas políticas permitem também escrita direta pelo próprio)
drop policy if exists "membro gere a sua" on availabilities;
create policy "membro gere a sua" on availabilities for all to authenticated
  using (member_id = my_member_id()) with check (member_id = my_member_id());

-- válvula de segurança para manutenção (a UI não expõe edição de outros)
drop policy if exists "escrita admin" on availabilities;
create policy "escrita admin" on availabilities for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------
-- Define (ou limpa, com p_state null) o estado de vários dias de
-- uma vez para o membro autenticado. Aceita dias de meses diferentes.
-- ------------------------------------------------------------
create or replace function set_my_availability(p_days text[], p_state text)
returns void language plpgsql security definer set search_path = public as $$
declare
  mid text;
  d text;
  m text;
  months text[];
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  if p_days is null or array_length(p_days, 1) is null then return; end if;
  if p_state is not null and p_state not in ('livre', 'ocupado', 'indeciso') then
    raise exception 'Estado inválido: %', p_state;
  end if;

  -- valida o formato das datas (rebenta a transação se alguma for inválida)
  foreach d in array p_days loop
    perform d::date;
  end loop;

  -- garante que existe linha para cada mês envolvido
  select array_agg(distinct substring(x from 1 for 7)) into months from unnest(p_days) as x;
  foreach m in array months loop
    insert into availabilities (member_id, month) values (mid, m)
      on conflict (member_id, month) do nothing;
  end loop;

  foreach d in array p_days loop
    m := substring(d from 1 for 7);
    if p_state is null then
      update availabilities set days = days - d, updated_at = now()
       where member_id = mid and month = m;
    else
      update availabilities set days = jsonb_set(days, array[d], to_jsonb(p_state)), updated_at = now()
       where member_id = mid and month = m;
    end if;
  end loop;

  -- limpeza: meses que ficaram sem nenhum dia classificado
  delete from availabilities where member_id = mid and month = any(months) and days = '{}'::jsonb;
end $$;

revoke execute on function set_my_availability(text[], text) from public, anon;
grant execute on function set_my_availability(text[], text) to authenticated;
