-- ============================================================
-- GrillHub — contas: membros criam compras e fluxo de pagamento
-- "já paguei" (devedor) → confirmação do credor.
-- Correr UMA vez no SQL Editor do Supabase.
-- Requer: setup-perfil-rsvp.sql (my_member_id) e setup-ferias.sql (is_member).
-- ============================================================

-- 1) claimed = {memberId: true} — o devedor diz que pagou; fica pendente
--    até o credor (ou um admin) marcar settled.
alter table purchases add column if not exists claimed jsonb not null default '{}'::jsonb;
alter table vacation_purchases add column if not exists claimed jsonb not null default '{}'::jsonb;

-- 2) Compras de eventos: membros criam/editam/eliminam compras de que
--    são o credor (payer_member_id = o próprio). Admins mantêm tudo
--    (política "escrita admin" existente continua válida — as políticas somam-se).
drop policy if exists "membro cria como credor" on purchases;
create policy "membro cria como credor" on purchases for insert to authenticated
  with check (payer_member_id = my_member_id());
drop policy if exists "membro edita as suas" on purchases;
create policy "membro edita as suas" on purchases for update to authenticated
  using (payer_member_id = my_member_id()) with check (payer_member_id = my_member_id());
drop policy if exists "membro elimina as suas" on purchases;
create policy "membro elimina as suas" on purchases for delete to authenticated
  using (payer_member_id = my_member_id());
-- (vacation_purchases já permite escrita a membros via "escrita membros")

-- 3) RPC: o devedor marca/desmarca "já paguei" (não mexe em mais nada;
--    bloqueado se já estiver saldado)
create or replace function claim_my_payment(p_purchase_id text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  update purchases
     set claimed = jsonb_set(coalesce(claimed, '{}'::jsonb), array[mid], to_jsonb(p_value))
   where id = p_purchase_id
     and participants ? mid
     and mid <> coalesce(payer_member_id, '')
     and not coalesce((settled->>mid)::boolean, false);
  if not found then raise exception 'Compra inexistente, não participas, ou já está saldada'; end if;
end $$;

create or replace function claim_my_vacation_payment(p_purchase_id text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare mid text;
begin
  mid := my_member_id();
  if mid is null then raise exception 'Sem membro associado a esta conta'; end if;
  update vacation_purchases
     set claimed = jsonb_set(coalesce(claimed, '{}'::jsonb), array[mid], to_jsonb(p_value))
   where id = p_purchase_id
     and participants ? mid
     and mid <> coalesce(payer_member_id, '')
     and not coalesce((settled->>mid)::boolean, false);
  if not found then raise exception 'Compra inexistente, não participas, ou já está saldada'; end if;
end $$;

revoke execute on function claim_my_payment(text, boolean) from public, anon;
revoke execute on function claim_my_vacation_payment(text, boolean) from public, anon;
grant execute on function claim_my_payment(text, boolean) to authenticated;
grant execute on function claim_my_vacation_payment(text, boolean) to authenticated;
