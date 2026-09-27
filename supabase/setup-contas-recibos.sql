-- ============================================================
-- GrillHub — contas, Fase 4: recibos (pagar várias contas de uma vez)
-- Correr UMA vez no SQL Editor do Supabase, DEPOIS de setup-contas-arquivo.sql
-- (pode repetir-se sem mal).
--
-- SÓ ADIÇÕES: duas tabelas novas e funções novas. Não apaga nem altera dados.
-- As funções mexem apenas em claimed[membro] / settled[membro] das compras do recibo.
--
-- Fluxo:
--   1. A (devedor) cria um recibo para B com tudo o que lhe deve por saldar.
--      As dívidas de B para A entram «a abater» (o total é o líquido).  → estado 'aberto'
--   2. A paga (MB Way / Revolut) com o ID do recibo no descritivo e marca-o
--      como pago → as contas de A passam todas a «por confirmar».     → 'pago'
--   3. B confirma → todas as linhas do recibo ficam saldadas.          → 'confirmado'
--   Em 'pago', A («afinal ainda não paguei») ou B («não recebi») podem reabrir → 'aberto'.
--   Em 'aberto', A pode cancelar → 'cancelado' (as contas voltam a ficar livres).
-- ============================================================

create table if not exists receipts (
  id text primary key,                    -- curto, ex.: GR-7K3P9Q (vai no descritivo da transferência)
  from_member_id text not null,           -- quem paga
  to_member_id text not null,             -- quem recebe
  total numeric(10,2) not null,           -- líquido a pagar (dívidas de A menos as de B a abater)
  status text not null default 'aberto',  -- aberto | pago | confirmado | cancelado
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  confirmed_at timestamptz
);

create table if not exists receipt_items (
  receipt_id text not null references receipts(id),
  origin text not null check (origin in ('event', 'vacation')),
  purchase_id text not null,
  member_id text not null,                -- o devedor desta linha (A = a pagar; B = a abater)
  amount numeric(10,2) not null,
  primary key (receipt_id, origin, purchase_id, member_id)
);

-- RLS: leitura pública (como o resto das contas); escrita só pelas funções abaixo.
alter table receipts enable row level security;
alter table receipt_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'receipts' and policyname = 'leitura publica') then
    create policy "leitura publica" on receipts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'receipt_items' and policyname = 'leitura publica') then
    create policy "leitura publica" on receipt_items for select using (true);
  end if;
end $$;

-- ------------------------------------------------------------
-- Ajudantes internos: marcar claimed/settled de UM membro numa compra
-- ------------------------------------------------------------
create or replace function _receipt_mark(p_origin text, p_purchase_id text, p_member text, p_field text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_origin = 'event' and p_field = 'claimed' then
    update purchases set claimed = jsonb_set(coalesce(claimed, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id and not coalesce((settled->>p_member)::boolean, false);
  elsif p_origin = 'vacation' and p_field = 'claimed' then
    update vacation_purchases set claimed = jsonb_set(coalesce(claimed, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id and not coalesce((settled->>p_member)::boolean, false);
  elsif p_origin = 'event' and p_field = 'settled' then
    update purchases set settled = jsonb_set(coalesce(settled, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id;
  elsif p_origin = 'vacation' and p_field = 'settled' then
    update vacation_purchases set settled = jsonb_set(coalesce(settled, '{}'::jsonb), array[p_member], to_jsonb(p_value))
     where id = p_purchase_id;
  end if;
end $$;
revoke execute on function _receipt_mark(text, text, text, text, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1) Criar recibo. p_items = [{origin, purchase_id, member_id, amount}, ...]
--    Cada linha tem de ser uma dívida real e por saldar entre mim e p_to,
--    e não pode estar noutro recibo em aberto.
-- ------------------------------------------------------------
create or replace function create_receipt(p_to text, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  mid text; it jsonb; o text; pid text; debtor text; amt numeric;
  payer text; parts jsonb; sett jsonb; net numeric := 0; rid text; n int := 0;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  if p_to is null or p_to = mid or not exists (select 1 from members where id = p_to) then
    raise exception 'Destinatário inválido';
  end if;
  if exists (select 1 from receipts where from_member_id = mid and to_member_id = p_to and status in ('aberto', 'pago')) then
    raise exception 'Já tens um recibo em aberto para esta pessoa';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    o := it->>'origin'; pid := it->>'purchase_id'; debtor := it->>'member_id'; amt := (it->>'amount')::numeric;
    if amt is null or amt <= 0 then raise exception 'Valor inválido numa linha'; end if;
    if debtor not in (mid, p_to) then raise exception 'Linha que não é entre vocês os dois'; end if;
    if o = 'event' then
      select payer_member_id, participants, settled into payer, parts, sett from purchases where id = pid;
    elsif o = 'vacation' then
      select payer_member_id, participants, settled into payer, parts, sett from vacation_purchases where id = pid;
    else
      raise exception 'Origem inválida: %', o;
    end if;
    if not found then raise exception 'Compra % não existe', pid; end if;
    if payer is distinct from (case when debtor = mid then p_to else mid end) then
      raise exception 'A compra % não foi paga pela pessoa certa', pid;
    end if;
    if not coalesce(parts ? debtor, false) then raise exception 'Membro não participa na compra %', pid; end if;
    if coalesce((sett->>debtor)::boolean, false) then raise exception 'A compra % já está saldada', pid; end if;
    if exists (select 1 from receipt_items ri join receipts r on r.id = ri.receipt_id
                where r.status in ('aberto', 'pago') and ri.origin = o and ri.purchase_id = pid and ri.member_id = debtor) then
      raise exception 'A compra % já está noutro recibo em aberto', pid;
    end if;
    net := net + case when debtor = mid then amt else -amt end;
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'Recibo sem contas'; end if;
  if net <= 0 then raise exception 'Depois de abater, não deves nada a esta pessoa'; end if;

  -- ID curto sem caracteres ambíguos (0/O, 1/I/L), fácil de escrever no MB Way
  loop
    select 'GR-' || string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
      into rid from generate_series(1, 6);
    exit when not exists (select 1 from receipts where id = rid);
  end loop;

  insert into receipts (id, from_member_id, to_member_id, total, status)
  values (rid, mid, p_to, round(net, 2), 'aberto');
  insert into receipt_items (receipt_id, origin, purchase_id, member_id, amount)
  select rid, x->>'origin', x->>'purchase_id', x->>'member_id', round((x->>'amount')::numeric, 2)
    from jsonb_array_elements(p_items) x;
  return rid;
end $$;

-- ------------------------------------------------------------
-- 2) Quem paga marca o recibo como pago → as SUAS linhas ficam «por confirmar»
-- ------------------------------------------------------------
create or replace function pay_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; r receipts; it receipt_items;
begin
  mid := my_member_id();
  select * into r from receipts where id = p_id for update;
  if not found or r.from_member_id is distinct from mid then raise exception 'Recibo inexistente ou não é teu'; end if;
  if r.status <> 'aberto' then raise exception 'Este recibo não está em aberto'; end if;
  update receipts set status = 'pago', paid_at = now() where id = p_id;
  for it in select * from receipt_items where receipt_id = p_id and member_id = mid loop
    perform _receipt_mark(it.origin, it.purchase_id, it.member_id, 'claimed', true);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) Quem recebe confirma → todas as linhas do recibo ficam saldadas
-- ------------------------------------------------------------
create or replace function confirm_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; r receipts; it receipt_items;
begin
  mid := my_member_id();
  select * into r from receipts where id = p_id for update;
  if not found or r.to_member_id is distinct from mid then raise exception 'Recibo inexistente ou não é para ti'; end if;
  if r.status <> 'pago' then raise exception 'Este recibo ainda não foi marcado como pago'; end if;
  update receipts set status = 'confirmado', confirmed_at = now() where id = p_id;
  for it in select * from receipt_items where receipt_id = p_id loop
    perform _receipt_mark(it.origin, it.purchase_id, it.member_id, 'settled', true);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4) Reabrir um recibo pago (quem pagou: «afinal ainda não paguei»;
--    quem recebe: «não recebi») → volta a 'aberto' e tira o «por confirmar»
-- ------------------------------------------------------------
create or replace function reopen_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; r receipts; it receipt_items;
begin
  mid := my_member_id();
  select * into r from receipts where id = p_id for update;
  if not found or mid is null or mid not in (r.from_member_id, r.to_member_id) then raise exception 'Recibo inexistente ou não é teu'; end if;
  if r.status <> 'pago' then raise exception 'Só se reabre um recibo marcado como pago'; end if;
  update receipts set status = 'aberto', paid_at = null where id = p_id;
  for it in select * from receipt_items where receipt_id = p_id and member_id = r.from_member_id loop
    perform _receipt_mark(it.origin, it.purchase_id, it.member_id, 'claimed', false);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5) Cancelar um recibo ainda em aberto (só quem o criou). Não mexe nas compras.
-- ------------------------------------------------------------
create or replace function cancel_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare mid text; r receipts;
begin
  mid := my_member_id();
  select * into r from receipts where id = p_id for update;
  if not found or r.from_member_id is distinct from mid then raise exception 'Recibo inexistente ou não é teu'; end if;
  if r.status <> 'aberto' then raise exception 'Só se cancela um recibo em aberto'; end if;
  update receipts set status = 'cancelado' where id = p_id;
end $$;

revoke execute on function create_receipt(text, jsonb) from public, anon;
revoke execute on function pay_receipt(text) from public, anon;
revoke execute on function confirm_receipt(text) from public, anon;
revoke execute on function reopen_receipt(text) from public, anon;
revoke execute on function cancel_receipt(text) from public, anon;
grant execute on function create_receipt(text, jsonb) to authenticated;
grant execute on function pay_receipt(text) to authenticated;
grant execute on function confirm_receipt(text) to authenticated;
grant execute on function reopen_receipt(text) to authenticated;
grant execute on function cancel_receipt(text) to authenticated;

notify pgrst, 'reload schema';
