# GrillHub × Discord — o que já está feito e o que tens de fazer

O código está todo pronto. Falta só a parte que envolve credenciais e cliques no
Discord/Supabase, que tens de ser tu a fazer (não tenho acesso às tuas contas).

## O que já ficou feito (código)

- **`supabase/setup-discord.sql`** — adiciona a coluna `discord_id` aos membros e
  deixa cada membro gravar o seu próprio ID.
- **`supabase/functions/discord-notify/index.ts`** — a Edge Function (o "cérebro"
  do bot) que envia mensagens ao Discord. Só admins a podem disparar.
- **Frontend** — campo *Discord ID* no formulário de membro (admin) e na "Minha área"
  (cada membro liga o seu). Botões novos, só para admins:
  - **😳 Envergonhar no Discord** — na ficha de cada membro.
  - **📣 Anunciar no Discord** — no detalhe de cada evento.
  - **💸 (cobrar)** — em cada compra, menciona quem a tem por saldar.

## Passos que tens de fazer tu (uma vez)

### 1. Criar o bot no Discord (~5 min)
1. Vai a https://discord.com/developers/applications → **New Application** → nome `GrillHub`.
2. Menu **Bot** → **Reset Token** → copia o **token** (guarda-o, é secreto).
3. Ainda em **Bot**, ativa **Message Content Intent** (por segurança; não é preciso
   para enviar, mas útil para features futuras).
4. Menu **OAuth2 → URL Generator**: marca **scope `bot`** e as permissões
   **Send Messages** + **Read Messages/View Channels**. Copia o URL gerado, abre-o
   e adiciona o bot ao vosso servidor.

### 2. Descobrir os IDs dos canais
No Discord: **Definições → Avançado → Modo de programador** (ativar). Depois botão
direito no canal geral → **Copiar ID do canal**. (Opcional: um canal só para vergonhas.)

### 3. Pôr os secrets no Supabase
No painel Supabase → **Edge Functions → Manage secrets** (ou `supabase secrets set`), adiciona:

| Secret | Valor |
|---|---|
| `DISCORD_BOT_TOKEN` | o token do passo 1.2 |
| `DISCORD_CHANNEL_ID` | ID do canal geral |
| `DISCORD_SHAME_CHANNEL_ID` | *(opcional)* canal das vergonhas; sem isto usa o geral |

### 4. Correr o SQL
Supabase → **SQL Editor** → cola e corre o conteúdo de `supabase/setup-discord.sql`.

### 5. Publicar a Edge Function
- **Via CLI:** `supabase functions deploy discord-notify`
- **Ou no painel:** Edge Functions → nova função `discord-notify` → cola o conteúdo de
  `supabase/functions/discord-notify/index.ts`.

### 6. Fazer deploy do frontend
`git add . && git commit -m "Integração Discord" && git push` — o workflow já publica
sozinho no GitHub Pages.

## Como usar depois
1. Cada membro entra na "Minha área" e cola o seu **Discord ID** (ou o admin preenche-o
   na ficha do membro). Sem ID, esse membro não pode ser mencionado.
2. Admin abre a ficha de um membro → **😳 Envergonhar**, ou um evento → **📣 Anunciar**,
   ou uma compra → **💸**. O bot publica no canal e faz ping às pessoas certas.

## Para o futuro (a base já aguenta)
A função aceita também `{ kind: "custom", text, memberIds }` para mensagens livres.
Comandos do bot (slash commands), reações, aniversários automáticos, etc. podem ser
adicionados como novos `kind` nesta mesma função, ou — para o bot *responder* a
interações — configurando um "Interactions Endpoint URL" no Developer Portal a apontar
para outra Edge Function.
