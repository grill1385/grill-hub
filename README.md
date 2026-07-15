# Presenças do Grill 🔥

Dashboard para gerir membros, eventos e presenças do Grill. Versão inicial — dados guardados em `localStorage` (por browser), com adaptador preparado para ligar um backend partilhado (Firebase/Supabase) mais tarde (`src/storage.js`).

## Desenvolvimento local

```bash
npm install
npm run dev
```

## Publicar no GitHub Pages

1. Cria um repositório no GitHub (ex.: `grill-hub`).
2. Faz push:

```bash
git remote add origin https://github.com/grill1385/grill-hub.git
git push -u origin main
```

3. No GitHub: **Settings → Pages → Source → GitHub Actions**.
4. O workflow (`.github/workflows/deploy.yml`) faz build e deploy automático a cada push para `main`.

O site fica em `https://grill1385.github.io/grill-hub/`.

## Notas

- A consulta é livre; o login é só para administração. Na primeira utilização cria-se a conta de ADMIN principal.
- A autenticação corre no browser — não uses passwords que utilizes noutros sítios.
- Com `localStorage`, cada visitante vê apenas os dados do seu próprio browser. Para dados partilhados, substitui o `backend` em `src/storage.js`.

## Férias do Grill

A aba "Férias do Grill" (planeamento de locais, alojamento, transportes e tarefas) usa tabelas próprias.
Antes da primeira utilização, correr `supabase/setup-ferias.sql` UMA vez no SQL Editor do Supabase.
Escrita permitida a admins e a membros com conta ligada (email do membro = email da conta).
