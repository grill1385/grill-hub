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

### Fase 3 — arquivar contas saldadas (feature 4). FEITA (27 set 2026).
Migração `supabase/setup-contas-arquivo.sql` (só adições):
- coluna `archived boolean not null default false` em `purchases` e `vacation_purchases`
  (fora de fromPurchase/fromVPurchase, para os upserts não a pisarem);
- `purchase_is_settled(...)` — mesma regra do `isFullySettled` (ledger.js): todos com parte > 0 saldados;
- RPC `set_purchase_archived(origin, id, value)` — só credor ou admin; arquivar exige saldada;
- RPC `set_purchase_settled(origin, id, member, value)` — confirmar um pagamento mexe só em
  `settled[member]` (antes era upsert da linha inteira, que podia pisar recibos confirmados entretanto).
  App.jsx/Ferias.jsx usam-no e só caem para o upsert antigo se a função ainda não existir.
UI: botão Arquivar/Desarquivar no detalhe do evento, no detalhe da compra das férias e em
«As Minhas Contas» (+ «Arquivar as N saldadas que pagaste»); filtro «Ver arquivadas» nos três.
Nos saldos as arquivadas valem 0 de qualquer forma (estão saldadas).

### Fase 4 — recibos (features 3 e 1). FEITA (27 set 2026).
Migração `supabase/setup-contas-recibos.sql` (só adições; correr depois da Fase 3):
- `receipts` (id «GR-XXXXXX» sem caracteres ambíguos, from/to, total líquido, status
  aberto|pago|confirmado|cancelado, created/paid/confirmed_at) e `receipt_items`
  (receipt_id, origin, purchase_id, member_id = devedor da linha, amount). Leitura pública; escrita só por RPC.
- `create_receipt(p_to, p_items)`: valida cada linha (dívida real entre os dois, por saldar, não
  presa noutro recibo em aberto), 1 recibo em aberto por par/sentido, total = líquido > 0.
  **Decisão:** o recibo inclui também as dívidas de B para A «a abater», para o valor bater com o
  saldo líquido que a app mostra; ao confirmar, essas linhas também ficam saldadas.
- `pay_receipt` (A): recibo → pago; `claimed[A]=true` nas linhas de A (feature 1).
- `confirm_receipt` (B): → confirmado; `settled[devedor]=true` em todas as linhas.
- `reopen_receipt` (A «afinal ainda não paguei» / B «não recebi»): pago → aberto; tira o claimed.
- `cancel_receipt` (A, só em aberto). Ajudante `_receipt_mark` sem execute para ninguém.
UI (Contas.jsx): «Criar recibo» no detalhe de cada pessoa a quem deves (pré-visualização com
linhas a pagar e a abater); cartões de recibos ativos no topo; detalhe com ID para copiar e ações;
histórico; «Pago em recibo» no detalhe de cada conta e etiqueta «recibo GR-…» na lista.
Notificação: badge na barra lateral (recibos pagos a mim por confirmar) e linha na Home em
«Pagamentos a confirmar» (as compras desse recibo deixam de aparecer uma a uma).

Os botões novos só aparecem depois das migrações (`archiveReady` / `receiptsReady` em api.js),
por isso o código pode ser publicado antes ou depois de correr o SQL.

Testado: SQL em Postgres local (PGlite, 28 verificações, incluindo «os valores das compras nunca
mudam»); UI de ponta a ponta com PGlite no browser e dados falsos (criar, pagar, reabrir, confirmar,
cancelar, arquivar, com e sem migração, secretária e telemóvel).

### Ideias para depois
- Email ao credor quando um recibo é marcado como pago (Edge Function, como `birthday-wish`).
- `send-debt-reminders.mjs` podia mencionar recibos em aberto.

## Decisões tomadas com o David

- Confirmar pagamento: só o credor, nem admins.
- Cartão de compra das férias: descrição, total, quem pagou e progresso; resto no detalhe.
- «Já paguei, por confirmar» não conta nas somas dos saldos; aparece à parte.
- Nas tabelas de contas, clicar numa compra salta para a lista e destaca-a.
- Férias › Contas tem 3 vistas: Compras, Minhas contas, Contas gerais (matriz compensada).
