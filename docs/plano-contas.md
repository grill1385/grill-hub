# GrillHub — plano das novas funcionalidades das Contas

Estado: 27 set 2026. Ler junto com o CLAUDE.md da raiz.

## Regra que manda em tudo

Os dados reais das contas das férias já estão em produção. **Nenhuma alteração pode apagar
ou adulterar dados existentes.** Para cada fase:

1. Backup antes: Gestão › Cópia de segurança (descarrega um .json com todas as tabelas).
2. Migrações SQL só com `create table if not exists` e `add column if not exists`.
   Zero `drop`, zero `alter` de tipo, zero `update` em massa.
3. Escritas cirúrgicas: alterar `settled`/`claimed` por RPC que toca só no campo em causa
   (como `claim_my_payment`), nunca por upsert da linha inteira em fluxos novos.
4. Arquivar != apagar: coluna nova; a conta continua lá, visível num filtro.
5. Testar com dados falsos, nunca com os reais.
6. Antes de publicar, rever o diff: procurar `upsert|insert|update|delete|rpc|drop|alter`
   nas linhas adicionadas e confirmar que só lá está o esperado.

## Fases

### Fase 1 — FEITA e publicada
Sem qualquer escrita nova na base de dados (a única operação nova é um `select`).

- **Cópia de segurança**: `BACKUP_TABLES` + `fetchBackup` em api.js; painel `BackupPanel`
  em Gestão › «Cópia de segurança». Paginado a 1000 linhas.
- **Confirmar pagamentos (feature 2)**: `canConfirm = iAmPayer && mid !== pu.payerId` em
  App.jsx e Ferias.jsx — só o credor confirma, nem os admins. RLS inalterada.
- **Compras das Férias em resumo (feature 5)**: cartão `.vpu-row` (descrição, tipo, total,
  quem pagou, quanto falta, barra de progresso); o resto em `VPurchaseDetailModal`.

Ponto em aberto: se o credor de alguma compra antiga não tiver conta ligada a um membro,
ninguém a consegue confirmar pela interface. Verificar com o David.

### Fase 2 — aba «As Minhas Contas» (feature 0). FEITA (27 set 2026). Só leitura.
Única operação nova: `feriasApi.loadAccounts()` (dois `select`: `vacations` e `vacation_purchases`).

- `src/ledger.js`: `shareOf`, `buildLedger` (antigo `vacLedger`), `ledgerCell`, `ledgerNet` —
  partilhados por App.jsx, Ferias.jsx e Contas.jsx (as cópias locais foram removidas).
- `src/Contas.jsx` (aba «As Minhas Contas», na barra lateral só com membro ligado): totais
  a receber / a pagar / por confirmar; filtros por origem (eventos, férias, ou um evento/férias
  concreto), por data (data do evento ou do início das férias) e pesquisa sem acentos na conta
  e na origem; tabela «Saldo com cada pessoa» (verde/vermelho/branco, «por confirmar» à parte)
  → `PairModal`; lista das contas com «Ocultar saldadas» (ligado por omissão) → `AccountModal`
  só de leitura com botão para a origem.
- Ir à origem: evento → `EventDetailModal` com `highlightPurchase` (`pu-<id>` + `.pu-hl`);
  férias → `FeriasTab` com `jump={vacationId, purchaseId}`, abre Contas e destaca `vpu-<id>`.
- Testado com dados falsos (página local com o Supabase bloqueado), secretária e telemóvel.

### Fase 3 — arquivar contas saldadas (feature 4). Migração só de adição.
`alter table ... add column if not exists archived boolean not null default false` em
`purchases` e `vacation_purchases`. Filtro «Ver contas arquivadas». Arquivar não altera valores.

### Fase 4 — recibos (features 3 e 1). A maior.
- Tabelas novas (só `create table if not exists`): `receipts` (id curto para MB Way/Revolut,
  from_member_id, to_member_id, total, estado, created_at, paid_at) e `receipt_items`
  (receipt_id, origem 'event'|'vacation', purchase_id, member_id, amount).
- «Associar todas as contas de [membro]» junta num recibo tudo o que A deve a B por saldar.
- A marca o recibo como pago -> todas as contas do recibo passam a «por verificar» de uma vez
  (feature 1), em vez de uma a uma.
- B recebe notificação nas Contas com o ID do recibo, abre, vê o conteúdo e confirma; as contas
  ficam saldadas e associadas ao recibo, o que permite distinguir depois o que foi pago em
  conjunto e o que foi pago em separado.
- O ID serve para o descritivo da transferência MB Way/Revolut.
- Escrita por RPC `security definer` que altera só `settled[member]` de cada compra do recibo.

## Decisões tomadas com o David

- Confirmar pagamento: só o credor, nem admins.
- Cartão de compra das férias: descrição, total, quem pagou e progresso; resto no detalhe.
- «Já paguei, por confirmar» não conta nas somas dos saldos; aparece à parte.
- Nas tabelas de contas, clicar numa compra salta para a lista e destaca-a.
- Férias › Contas tem 3 vistas: Compras, Minhas contas, Contas gerais (matriz compensada).
