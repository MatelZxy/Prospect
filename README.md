# Prospect — empresas sem site

## Rodar
    npm start        # abre em http://localhost:3000   (precisa do Node 18+, sem npm install)

## Fontes de dados
- **Padrão (sem chave):** OpenStreetMap (Nominatim + Overpass). Grátis, mas o cadastro é incompleto:
  "SEM SITE" significa "sem site *nos dados do OSM*". Confirme antes de abordar.
- **Mais preciso (opcional):** Google Places API (New).
  1. Google Cloud Console → crie projeto → ative "Places API (New)" → crie uma chave de API (ative faturamento).
  2. Rode com a chave:  `GOOGLE_PLACES_KEY=sua_chave npm start`   (Windows PowerShell: `$env:GOOGLE_PLACES_KEY="sua_chave"; npm start`)
  Traz site, telefone, nota e nº de avaliações (até 60 por busca).

## Classificação
- COM SITE: há endereço de site próprio (Instagram/Facebook/WhatsApp/Linktree NÃO contam).
- SEM SITE: sem site nos dados, mas com algum contato.
- NÃO VERIFICADO: sem site e sem nenhum contato (dado pobre demais para afirmar).

## Armazenamento
Histórico, favoritos, contatados e anotações ficam no localStorage do navegador.

## Publicar na Vercel
1. Suba a pasta para um repositório no GitHub (sem `node_modules`).
2. Em vercel.com → Add New → Project → importe o repositório → Deploy.
3. (Opcional) Settings → Environment Variables → `GOOGLE_PLACES_KEY` → Redeploy.
