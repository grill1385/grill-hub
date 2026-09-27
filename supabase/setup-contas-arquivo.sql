-- ============================================================
-- GrillHub — contas, Fase 3: arquivar contas saldadas
--           + confirmação de pagamentos por RPC cirúrgica.
-- Correr UMA vez no SQL Editor do Supabase (pode repetir-se sem mal).
-- Requer: setup-perfil-rsvp.sql (my_member_id), setup-auth.sql (is_admin),
--         setup-contas-pagamentos.sql e setup-contas-parcelas.sql.
--
-- SÓ ADIÇÕES: não apaga nem altera dados existentes.
--   - coluna nova `archived` (default false → todas as contas atuais ficam por arquivar)
--   - funções novas que mexem só no campo em causa de uma compra
-- ============================================================

-- 1) Coluna de arquivo. Arquivar NÃO mexe em valores: a conta continua lá,
--    visível com o filtro «Ver contas arquivadas».
alter table purchases add column if not exists archived boolean not null default false;
alter table vacation_purchases add column if not exists archived boolean not null default false;

-- 2) Uma compra está saldada quando todos os participantes com parte > 0
--    (exceto quem pagou) estão marcados como saldados.
--    Espelha o shareOf da app: parcelas → só conta quem está numa parcela com preço;
--    valores individuais → só conta quem tem valor > 0; divisão por todos → todos.
create or replace function purchase_is_settled(p_payer text, p_participants jsonb, p_settled jsonb,
                                               p_split text, p_shares jsonb, p_parcels jsonb)
returns boolean language sql immutable as $$
  select not exists (
    select 1 from jsonb_array_elements_text(coalesce(p_participants, '[]'::jsonb)) as p(mid)
     where p.mid <> coalesce(p_payer, '')
       and not coalesce((p_settled->>p.mid)::boolean, false)
       and case
             when coalesce(p_split, 'equal') <> 'custom' then true
             when jsonb_array_length(coalesce(p_parcels, '[]'::jsonb)) > 0 then exists (
               select 1 from jsonb_array_elements(p_parcels) pc
                where coalesce(pc->'members', '[]'::jsonb) ? p.mid
                  and coalesce((pc->>'price')::numeric, 0) > 0)
             else coalesce((p_shares->>p.mid)::numeric, 0) > 0
           end
  );
$$;

-- 3) Arquivar / desarquivar. Só o credor (quem pagou) ou um admin.
--    Arquivar exige a compra saldada; desarquivar é sempre possível.
--    p_origin = 'event' (purchases) | 'vacation' (vacation_purchases).
create or replace function set_purchase_archived(p_origin text, p_purchase_id text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; n integer;
begin
  mid := my_member_id();
  if mid is null and not is_admin() then raise exception 'Sem membro associado a esta conta'; end if;
  if p_origin = 'event' then
    update purchases set archived = p_value
     where id = p_purchase_id
       and (is_admin() or payer_member_id = mid)
       and (not p_value or purchase_is_settled(payer_member_id, participants, settled, split, shares, parcels));
  elsif p_origin = 'vacation' then
    update vacation_purchases set archived = p_value
     where id = p_purchase_id
       and (is_admin() or payer_member_id = mid)
       and (not p_value or purchase_is_settled(payer_member_id, participants, settled, split, shares, parcels));
  else
    raise exception 'Origem inválida: %', p_origin;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Só quem pagou (ou um admin) pode arquivar, e só contas já saldadas'; end if;
end $$;

-- 4) Confirmar / desfazer um pagamento de UM participante, sem reescrever a linha
--    inteira (o upsert antigo podia pisar alterações feitas entretanto por outra pessoa).
--    Só o credor; admins continuam como válvula de manutenção.
create or replace function set_purchase_settled(p_origin text, p_purchase_id text, p_member text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; n integer;
begin
  mid := my_member_id();
  if mid is null and not is_admin() then raise exception 'Sem membro associado a esta conta'; end if;
  if p_origin = 'event' then
    update purchases
       set settled = jsonb_set(coalesce(settled, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id and (is_admin() or payer_member_id = mid) and participants ? p_member;
  elsif p_origin = 'vacation' then
    update vacation_purchases
       set settled = jsonb_set(coalesce(settled, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id and (is_admin() or payer_member_id = mid) and participants ? p_member;
  else
    raise exception 'Origem inválida: %', p_origin;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Só quem pagou pode confirmar pagamentos desta compra'; end if;
end $$;

revoke execute on function set_purchase_archived(text, text, boolean) from public, anon;
revoke execute on function set_purchase_settled(text, text, text, boolean) from public, anon;
grant execute on function set_purchase_archived(text, text, boolean) to authenticated;
grant execute on function set_purchase_settled(text, text, text, boolean) to authenticated;

-- atualizar a cache do schema da API
notify pgrst, 'reload schema';
