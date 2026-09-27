-- ============================================================
-- GrillHub — contas: «Já me pagou tudo» (acerto direto pelo credor)
-- Correr UMA vez no SQL Editor do Supabase, DEPOIS de setup-contas-recibos.sql
-- (pode repetir-se sem mal).
--
-- Quando alguém te paga tudo o que te deve sem criar recibo no GrillHub
-- (MB Way, dinheiro…), o credor valida de uma vez todas as contas entre os dois.
-- Fica registado como um recibo já confirmado, com kind = 'direto', para se
-- saber depois o que foi pago em conjunto.
--
-- SÓ ADIÇÕES: uma coluna nova em receipts (default 'recibo' — os recibos existentes
-- não mudam) e uma função nova que mexe só em settled[membro] das compras em causa.
-- ============================================================

alter table receipts add column if not exists kind text not null default 'recibo';  -- recibo | direto

-- p_from = quem te pagou; p_items = [{origin, purchase_id, member_id, amount}, ...]
--   member_id = p_from → o que essa pessoa te devia (compras pagas por ti)
--   member_id = tu     → o que tu lhe devias, abatido (compras pagas por ela)
create or replace function settle_all_from(p_from text, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  mid text; it jsonb; o text; pid text; debtor text; amt numeric;
  payer text; parts jsonb; sett jsonb; net numeric := 0; rid text; n int := 0;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  if p_from is null or p_from = mid or not exists (select 1 from members where id = p_from) then
    raise exception 'Pessoa inválida';
  end if;
  if exists (select 1 from receipts where from_member_id = p_from and to_member_id = mid and status in ('aberto', 'pago')) then
    raise exception 'Esta pessoa tem um recibo em aberto para ti — confirma-o nesse recibo';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    o := it->>'origin'; pid := it->>'purchase_id'; debtor := it->>'member_id'; amt := (it->>'amount')::numeric;
    if amt is null or amt <= 0 then raise exception 'Valor inválido numa linha'; end if;
    if debtor not in (mid, p_from) then raise exception 'Linha que não é entre vocês os dois'; end if;
    if o = 'event' then
      select payer_member_id, participants, settled into payer, parts, sett from purchases where id = pid;
    elsif o = 'vacation' then
      select payer_member_id, participants, settled into payer, parts, sett from vacation_purchases where id = pid;
    else
      raise exception 'Origem inválida: %', o;
    end if;
    if not found then raise exception 'Compra % não existe', pid; end if;
    if payer is distinct from (case when debtor = p_from then mid else p_from end) then
      raise exception 'A compra % não foi paga pela pessoa certa', pid;
    end if;
    if not coalesce(parts ? debtor, false) then raise exception 'Membro não participa na compra %', pid; end if;
    if coalesce((sett->>debtor)::boolean, false) then raise exception 'A compra % já está saldada', pid; end if;
    if exists (select 1 from receipt_items ri join receipts r on r.id = ri.receipt_id
                where r.status in ('aberto', 'pago') and ri.origin = o and ri.purchase_id = pid and ri.member_id = debtor) then
      raise exception 'A compra % está num recibo em aberto', pid;
    end if;
    net := net + case when debtor = p_from then amt else -amt end;
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'Sem contas para validar'; end if;
  if net <= 0 then raise exception 'Depois de abater, esta pessoa não te deve nada'; end if;

  loop
    select 'GR-' || string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
      into rid from generate_series(1, 6);
    exit when not exists (select 1 from receipts where id = rid);
  end loop;

  insert into receipts (id, from_member_id, to_member_id, total, status, kind, paid_at, confirmed_at)
  values (rid, p_from, mid, round(net, 2), 'confirmado', 'direto', now(), now());
  insert into receipt_items (receipt_id, origin, purchase_id, member_id, amount)
  select rid, x->>'origin', x->>'purchase_id', x->>'member_id', round((x->>'amount')::numeric, 2)
    from jsonb_array_elements(p_items) x;
  for it in select * from jsonb_array_elements(p_items) loop
    perform _receipt_mark(it->>'origin', it->>'purchase_id', it->>'member_id', 'settled', true);
  end loop;
  return rid;
end $$;

revoke execute on function settle_all_from(text, jsonb) from public, anon;
grant execute on function settle_all_from(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
