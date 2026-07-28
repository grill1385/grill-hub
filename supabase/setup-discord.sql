-- ============================================================
-- GrillHub — integração com Discord
-- Adiciona o Discord ID a cada membro e permite que o próprio
-- membro o edite (o admin edita via a tabela members, como sempre).
-- Correr UMA vez no SQL Editor do Supabase.
-- ============================================================

-- 1) coluna nova
alter table members add column if not exists discord_id text;

-- 2) o próprio membro passa a poder gravar tambem o discord_id.
--    Recriamos update_my_profile com um parametro extra (p_discord_id).
--    Apagamos a versao antiga (3 args) para nao ficarem duas assinaturas.
drop function if exists update_my_profile(text, date, text);

create or replace function update_my_profile(
  p_username text, p_birth_date date, p_avatar_url text, p_discord_id text
)
returns void language plpgsql security definer set search_path = public as $$
declare mid text;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  update members
     set username   = nullif(trim(p_username), ''),
         birth_date = p_birth_date,
         avatar_url = nullif(trim(p_avatar_url), ''),
         discord_id = nullif(trim(p_discord_id), '')
   where id = mid;
end $$;

revoke execute on function update_my_profile(text, date, text, text) from public, anon;
grant  execute on function update_my_profile(text, date, text, text) to authenticated;
