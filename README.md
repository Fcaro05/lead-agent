# lead-agent

> **EN:** TypeScript CLI that finds local businesses with Google Places, audits their website
> (Firecrawl + PageSpeed Insights), scores the sales opportunity with an LLM and writes a
> ready-to-review outreach email into a Google Sheet. It never sends emails on its own.
> Stack: Node.js, TypeScript, OpenAI, Google Places / Sheets APIs. Setup instructions below (in Italian).

Agente CLI per trovare lead commerciali: cerca aziende con Google Places, analizza il loro sito web e genera score opportunità, mini-audit e email pronta.

## Cosa fa

```
Google Places → Firecrawl → PageSpeed → LLM → Google Sheet
```

1. Cerca aziende per query (es. "dentisti Varese")
2. Filtra quelle con sito web e rating decente
3. Analizza ogni sito (Firecrawl + PageSpeed mobile)
4. Genera con GPT-4o-mini: score, problemi, mini-audit, email commerciale
5. Salva tutto su Google Sheet

## Setup

### 1. Installa dipendenze

```bash
npm install
```

### 2. Configura le chiavi API

```bash
cp .env.example .env
```

Poi riempi `.env` con le chiavi seguenti.

---

### 3. Google Places API

1. Vai su [Google Cloud Console](https://console.cloud.google.com/)
2. Abilita **Places API (New)**
3. Crea una API Key e incollala in `GOOGLE_PLACES_API_KEY`

---

### 4. Firecrawl

1. Crea account su [firecrawl.dev](https://www.firecrawl.dev/)
2. Copia la API key in `FIRECRAWL_API_KEY`

---

### 5. PageSpeed Insights

1. Vai su [Google Cloud Console](https://console.cloud.google.com/)
2. Abilita **PageSpeed Insights API**
3. Crea una API Key e incollala in `PAGESPEED_API_KEY`
   - Oppure usa la stessa di Places se vuoi (sono API diverse ma la stessa key funziona se le abiliti entrambe)

---

### 6. OpenAI

1. Crea account su [platform.openai.com](https://platform.openai.com/)
2. Genera una API key in Settings → API keys
3. Incollala in `OPENAI_API_KEY`

---

### 7. Google Sheet + Service Account

1. Vai su [Google Cloud Console](https://console.cloud.google.com/)
2. Vai su **IAM & Admin → Service Accounts**
3. Crea un nuovo service account (nome a piacere)
4. Clicca sul service account → **Keys → Add Key → JSON**
5. Scarica il file JSON
6. Apri il JSON e copia:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (incolla tutta la stringa, incluso `-----BEGIN...`)
7. Abilita **Google Sheets API** in Cloud Console
8. Crea un nuovo Google Sheet
9. Clicca **Condividi** e aggiungi il `client_email` del service account con ruolo **Editor**
10. Copia l'ID del Sheet dall'URL (`/spreadsheets/d/<ID>/edit`) → `GOOGLE_SHEET_ID`

> **Nota:** La prima riga del Sheet viene impostata automaticamente come intestazione al primo avvio.

---

## Utilizzo

### Smoke test (senza scrivere su Sheet)

```bash
npm run agent -- --query "dentisti Varese" --limit 5 --dry-run
```

Output in console + file `out/debug-<timestamp>.json`.

### Run reale

```bash
npm run agent -- --query "dentisti Varese" --limit 30
```

### Altre query

```bash
npm run agent -- --query "parrucchieri Milano" --limit 20
npm run agent -- --query "ristoranti Roma centro" --limit 15 --dry-run
```

---

## Output console

```
30 aziende trovate
18 con sito
3 duplicate saltate
12 analizzate
4 lead alta priorità
12 righe salvate su Google Sheet
```

Progresso per lead:

```
[1/12] Studio Dentistico Rossi
  ✓ Firecrawl  3 pagine
  ✓ PageSpeed  perf=42 seo=87
  ✓ LLM        score=82 HIGH
  ✓ Salvato su Google Sheet
```

---

## Colonne Google Sheet

| Colonna | Contenuto |
|---|---|
| Status | OK / PARTIAL / ERROR |
| Query | Query usata |
| Place ID | ID univoco Google Places |
| Nome business | Nome azienda |
| Categoria | Tipo di business |
| Città | Città |
| Indirizzo | Indirizzo completo |
| Telefono | Numero di telefono |
| Sito | URL sito web |
| Google Maps URL | Link Google Maps |
| Rating | Voto Google |
| Numero recensioni | Numero recensioni |
| Email trovata | Email pubblica estratta dal sito |
| Fonte email | Pagina da cui è stata estratta |
| PageSpeed Performance | Score performance mobile (0-100) |
| PageSpeed SEO | Score SEO mobile |
| PageSpeed Accessibility | Score accessibilità |
| PageSpeed Best Practices | Score best practices |
| Business Value Score | Score valore commerciale (0-100) |
| Website Pain Score | Score problemi sito (0-100) |
| Activity Score | Score attività recente (0-100) |
| Contactability Score | Score facilità di contatto (0-100) |
| Opportunity Score | Score opportunità composito (0-100) |
| Priorità | HIGH / MEDIUM / LOW |
| Problemi principali | Lista problemi separati da `\|` |
| Sales Angle | Angolo commerciale personalizzato |
| Mini Audit | Audit concreto del sito |
| Email Subject | Oggetto email pronta |
| Email Draft | Corpo email pronto da usare |
| Errori | Eventuali errori per lead |
| Created At | Timestamp analisi |

---

## Formula Opportunity Score

```
Opportunity Score =
  Business Value Score × 30%
  + Website Pain Score × 35%
  + Activity Score × 20%
  + Contactability Score × 15%
```

**Priority:**
- `HIGH` = score ≥ 75
- `MEDIUM` = score 55–74
- `LOW` = score < 55

---

## FASE 2 — Gmail Draft (in arrivo)

Dopo validazione della FASE 1, aggiunta di `gmailDraft.ts` per creare bozze Gmail automatiche per i lead HIGH con email trovata.

**Regole:** mai invio automatico, solo bozze da approvare manualmente.

---

## TypeScript check

```bash
npm run typecheck
```
