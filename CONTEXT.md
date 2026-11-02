# lead-agent — Documento di Contesto

## Scopo del progetto

`lead-agent` è uno strumento CLI personale per il prospecting commerciale. Dato un tipo di business e una città (es. "dentisti Varese"), trova aziende locali, analizza il loro sito web e produce una scheda qualificata con score, audit e un'email commerciale pronta da usare.

L'obiettivo finale è avere righe nel Google Sheet del tipo:

```
Studio Dentistico Rossi | sito.it | score 82 | HIGH | problemi | mini-audit | email pronta
```

Non è una piattaforma. È uno script professionale con un unico punto di ingresso.

---

## Stack tecnologico

| Strumento | Uso |
|---|---|
| Node.js v24 | Runtime (usa `fetch` nativo, `parseArgs` nativo) |
| TypeScript | Tipizzazione, niente errori runtime per dati mancanti |
| Google Places API v1 | Trova aziende per query |
| Firecrawl | Legge il sito in markdown pulito |
| PageSpeed Insights API | Misura performance/SEO/accessibilità mobile |
| OpenAI `gpt-4o-mini` | Analisi, scoring LLM, audit, email |
| Google Sheets API | Database dei lead |
| `googleapis` SDK | Auth service account per Sheets (e futuro Gmail) |
| `openai` SDK | Client OpenAI |
| `dotenv` | Carica `.env` |

**Non usato:** LangChain, framework agenti, axios, database relazionali, dashboard, n8n/Make, invio email automatico.

---

## Comando principale

```bash
npm run agent -- --query "dentisti Varese" --limit 30
```

Con dry-run (nessuna scrittura su Sheet, output in console + JSON locale):

```bash
npm run agent -- --query "dentisti Varese" --limit 5 --dry-run
```

---

## Pipeline completa (FASE 1)

```
CLI args
  └─ Google Places API
       └─ filtri lead (sito presente, rating, recensioni)
            └─ dedup vs Google Sheet (Place ID / sito / nome+città)
                 └─ per ogni lead:
                      ├─ Firecrawl   → markdown sito + email pubblica
                      ├─ PageSpeed   → score mobile
                      ├─ LLM         → 4 score + problemi + audit + email
                      └─ Scoring     → opportunityScore + priority (calcolo deterministico)
                           └─ Google Sheet → append riga
```

Ogni lead è isolato in un `try/catch`. Se Firecrawl fallisce, si prosegue con PageSpeed e LLM con dati parziali. Se LLM fallisce, il lead viene salvato con `status: ERROR`. La pipeline non si blocca mai per un singolo lead.

---

## Struttura file

```
lead-agent/
  src/
    index.ts         Orchestratore: args → pipeline → summary
    config.ts        Carica .env, valida chiavi, costanti
    types.ts         Interfacce TypeScript
    utils.ts         Funzioni di supporto (sleep, logger, parsing)
    googlePlaces.ts  Ricerca aziende
    firecrawl.ts     Scraping sito
    pagespeed.ts     Metriche mobile
    llmAnalyze.ts    Analisi LLM
    scoring.ts       Formula opportunity score
    googleSheets.ts  Lettura/scrittura Sheet
    gmailDraft.ts    Stub FASE 2
  .env.example
  .gitignore
  package.json
  tsconfig.json
  README.md
  CONTEXT.md         (questo file)
```

---

## Moduli — dettaglio

### `types.ts`

Definisce le interfacce usate in tutta la codebase.

- **`PlaceResult`** — dati grezzi da Google Places (placeId, name, website, rating, reviewCount, phone, address, city, category, mapsUrl)
- **`FirecrawlResult`** — risultato scraping (markdown, pagesScraped, contactEmail, emailFoundSource, error?)
- **`PageSpeedResult`** — score Lighthouse mobile (performance, accessibility, seo, bestPractices, topIssues, error?)
- **`LlmOutput`** — output grezzo dell'LLM (4 score + mainProblems + salesAngle + miniAudit + emailSubject + emailDraft)
- **`AnalysisResult`** — schema finale (LlmOutput + opportunityScore calcolato + priority + email da Firecrawl)
- **`Lead`** — oggetto completo per riga Sheet (query, placeData, firecrawl?, pagespeed?, analysis?, errors[], status, createdAt)

---

### `config.ts`

Carica `.env` con `dotenv`. Espone funzioni che leggono le variabili richieste e lanciano errore se mancanti. Non leggono al momento dell'import ma al momento dell'uso (evita crash su dry-run parziale).

Costanti importanti:
- `RATE_LIMIT_MS = 1200` — pausa tra lead
- `MAX_PAGES_PER_SITE = 3` — max pagine scraping per sito
- `MAX_MARKDOWN_CHARS = 18000` — troncamento markdown mandato all'LLM (~4k token)
- `PAGESPEED_TIMEOUT_MS = 20000`
- `FIRECRAWL_TIMEOUT_MS = 30000`
- `MIN_RATING = 3.8`, `MIN_REVIEWS = 10` — soglie filtro lead

---

### `utils.ts`

Funzioni di supporto condivise.

- **`sleep(ms)`** — pausa asincrona tra richieste
- **`safeJsonParse<T>(raw)`** — parsing JSON robusto: rimuove backtick/fence markdown, estrae primo oggetto `{...}`, tenta `JSON.parse`. Ritorna `null` se fallisce.
- **`extractEmails(text)`** — regex su markdown, filtra indirizzi junk (immagini, noreply, example.com, wixpress, sentry, ecc.)
- **`clamp(n, min, max)`** — usato per tenere gli score in `[0, 100]`
- **`truncate(str, max)`** — troncamento sicuro con `…`
- **`domainOf(url)`** — estrae hostname senza `www.` per confronto link interni
- **`log`** — logger colorato con livelli: `info`, `ok`, `err`, `warn`, `dim`, `section`, `summary`

---

### `googlePlaces.ts`

Usa la **New Places API v1** (`places.googleapis.com/v1/places:searchText`) con field mask.

La field mask richiede tutti i campi in una sola chiamata POST (no Place Details separato):
```
places.id, displayName, websiteUri, rating, userRatingCount,
nationalPhoneNumber, formattedAddress, addressComponents,
primaryType, types, googleMapsUri, nextPageToken
```

Parametri: `languageCode: "it"`, `regionCode: "IT"`. Paginazione via `nextPageToken` fino al `--limit` richiesto (max 20 per pagina).

La città viene estratta da `addressComponents` (tipo `locality`), con fallback su `formattedAddress`.

---

### `firecrawl.ts`

Legge il sito in markdown tramite `api.firecrawl.dev/v1/scrape`.

**Flusso per ogni sito:**
1. Scraping homepage (`formats: ["markdown", "links"]`, `onlyMainContent: true`)
2. Filtra i link interni allo stesso dominio
3. Cerca una pagina servizi (keyword: servizi, trattamenti, prestazioni, soluzioni, offerta, cosa-facciamo)
4. Cerca una pagina contatti (keyword: contatti, contatto, contact, prenota, appuntamento, booking)
5. Scraping delle pagine trovate, fino a `MAX_PAGES_PER_SITE = 3`
6. Estrazione email pubblica da tutto il markdown (preferisce quella dalla pagina contatti)

Se Firecrawl fallisce su homepage → ritorna `error`, pipeline continua. Se fallisce su pagine secondarie → silenzioso, non blocca.

`contactEmail` e `emailFoundSource` sono stringa vuota se non trovate — mai `null` o `undefined`.

---

### `pagespeed.ts`

Chiama `googleapis.com/pagespeedonline/v5/runPagespeed` con `strategy=mobile` e tutte e 4 le categorie.

I 4 score Lighthouse (0.0–1.0 → moltiplicati ×100 e arrotondati):
- `performance` — velocità mobile
- `accessibility` — accessibilità
- `seo` — ottimizzazione motori di ricerca
- `bestPractices` — pratiche consigliate

`topIssues`: titoli degli audit Lighthouse con score < 0.9, ordinati per score crescente, massimo 5. Usati nel prompt LLM e nell'output finale.

`AbortController` con timeout `PAGESPEED_TIMEOUT_MS`. Errori non bloccanti.

---

### `llmAnalyze.ts`

Chiama OpenAI `gpt-4o-mini` con `response_format: { type: "json_object" }`.

**System prompt** istruisce l'LLM a:
- Restituire solo JSON valido, zero markdown
- Non inventare dati o metriche non presenti nel contesto
- Non usare frasi vaghe ("migliorare la presenza online")
- Ragionare su UX mobile, chiarezza offerta, percorso verso contatto/prenotazione
- Scrivere email breve (max 120 parole), naturale, non spam, tono professionale diretto
- Proporre mini-audit o call — non vendere un sito nuovo subito

**User message** = JSON strutturato con: dati Places, PageSpeed, markdown Firecrawl, email trovata.

**Schema JSON richiesto all'LLM:**
```json
{
  "businessValueScore": 0-100,
  "websitePainScore": 0-100,
  "activityScore": 0-100,
  "contactabilityScore": 0-100,
  "mainProblems": ["...", "...", "..."],
  "salesAngle": "...",
  "miniAudit": "...",
  "emailSubject": "...",
  "emailDraft": "..."
}
```

**Gestione errori JSON:** `safeJsonParse` → se fallisce, 1 retry (chiede all'LLM di correggere) → se fallisce ancora, eccezione (lead salvato con `ERROR`).

Dopo il parsing, i 4 score vengono clampati `[0, 100]`.

---

### `scoring.ts`

Calcola `opportunityScore` e `priority` **nel codice**, non dall'LLM. Garanzia che la formula sia sempre quella corretta.

**Formula:**
```
opportunityScore =
  businessValueScore × 0.30
  + websitePainScore × 0.35
  + activityScore × 0.20
  + contactabilityScore × 0.15
```

**Priority:**
- `HIGH` = score ≥ 75
- `MEDIUM` = score ≥ 55 e < 75
- `LOW` = score < 55

`buildAnalysisResult(llmOut, firecrawl)` assembla l'`AnalysisResult` finale: inserisce lo score calcolato, la priority, e sovrascrive `contactEmail`/`emailFoundSource` con quelli estratti da Firecrawl (non dall'LLM).

---

### `googleSheets.ts`

Auth tramite `google.auth.JWT` con service account (email + chiave privata). Scope: `spreadsheets`.

**Funzioni:**
- `ensureHeader()` — scrive la riga di intestazione se la cella A1 è vuota. Eseguito una volta a inizio run.
- `loadExistingKeys()` — legge le colonne A:K per costruire i Set di dedup (placeId, website normalizzato, nome+città). Chiamato una volta prima del loop.
- `isDuplicate(place, keys)` — controlla se il lead è già presente nel Sheet
- `appendLead(lead)` — append di una riga da 31 colonne in fondo al Sheet

**Colonne (31):**

| # | Colonna |
|---|---|
| 1 | Status |
| 2 | Query |
| 3 | Place ID |
| 4 | Nome business |
| 5 | Categoria |
| 6 | Città |
| 7 | Indirizzo |
| 8 | Telefono |
| 9 | Sito |
| 10 | Google Maps URL |
| 11 | Rating |
| 12 | Numero recensioni |
| 13 | Email trovata |
| 14 | Fonte email |
| 15 | PageSpeed Performance |
| 16 | PageSpeed SEO |
| 17 | PageSpeed Accessibility |
| 18 | PageSpeed Best Practices |
| 19 | Business Value Score |
| 20 | Website Pain Score |
| 21 | Activity Score |
| 22 | Contactability Score |
| 23 | Opportunity Score |
| 24 | Priorità |
| 25 | Problemi principali |
| 26 | Sales Angle |
| 27 | Mini Audit |
| 28 | Email Subject |
| 29 | Email Draft |
| 30 | Errori |
| 31 | Created At |

---

### `index.ts`

Punto di ingresso. Gestisce:

1. **`parseArgs`** — `--query` (obbligatorio), `--limit` (default 20), `--dry-run`
2. **Validazione env** — completa in run reale, solo 4 chiavi API in dry-run
3. **Google Places** — ricerca + paginazione
4. **Filtri lead** — sito presente; rating ≥ 3.8 (se disponibile); recensioni ≥ 10 (se disponibili)
5. **Dedup** — carica chiavi esistenti dallo Sheet, poi dedup anche intra-batch
6. **Loop per ogni lead** — Firecrawl → PageSpeed → LLM → scoring → Sheet (o debug JSON)
7. **Log `[i/N]`** con ✓/✗ per ogni step
8. **Summary finale** — trovate / con sito / duplicate / analizzate / HIGH / salvate
9. **Dry-run** — scrive `out/debug-<timestamp>.json` invece di usare lo Sheet

---

### `gmailDraft.ts` (stub FASE 2)

Attualmente esporta solo `createGmailDraft(_lead)` che ritorna `false`. Presente per typecheck.

---

## Decisioni di design

**Perché il calcolo dello score è nel codice e non nell'LLM?**
L'LLM non è affidabile per operazioni aritmetiche precise. La formula ponderata applicata deterministicamente garantisce che il numero nel Google Sheet sia sempre quello corretto.

**Perché `contactEmail` viene da Firecrawl e non dall'LLM?**
L'LLM potrebbe inventare email. L'estrazione via regex da HTML/markdown è deterministica e verificabile.

**Perché `response_format: json_object` e non parsing libero?**
OpenAI con `json_object` garantisce output parseable. `safeJsonParse` + retry gestisce i rari casi di wrapper markdown o testo spuri.

**Perché fetch nativo invece di axios?**
Node 24 ha `fetch` stabile. Zero dipendenze extra, meno superficie di attacco.

**Perché service account per Sheets invece di OAuth utente?**
Lo script gira in CLI senza browser. Il service account non richiede interazione umana per l'auth. L'unico requisito è condividere lo Sheet con la email del service account.

**Perché max 3 pagine per sito in Firecrawl?**
Bilanciamento costo API / qualità dati. Homepage + servizi + contatti coprono il 90% delle informazioni commercialmente rilevanti. Un crawl completo sarebbe lento e costoso per un MVP.

---

## Variabili d'ambiente

```env
# Google Places (New Places API v1)
GOOGLE_PLACES_API_KEY=

# Firecrawl
FIRECRAWL_API_KEY=

# PageSpeed Insights
PAGESPEED_API_KEY=

# OpenAI
OPENAI_API_KEY=

# Google Sheet ID (dalla URL: /spreadsheets/d/<ID>/edit)
GOOGLE_SHEET_ID=

# Google Service Account
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=           # intera stringa PEM con \n letterali

# Gmail OAuth2 (FASE 2, opzionale in FASE 1)
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
```

> `GOOGLE_PRIVATE_KEY`: se copiata da JSON, i `\n` nei file `.env` vengono letti come `\\n`. `config.ts` li normalizza automaticamente in newline reali.

---

## FASE 2 — Gmail Draft (non ancora implementata)

Da implementare in `gmailDraft.ts` dopo validazione della FASE 1.

**Logica trigger** (in `index.ts`):
```
se opportunityScore >= 75
  e contactEmail non vuoto
  e emailSubject non vuoto
  e emailDraft non vuoto
  e Gmail configurato
  e NON dry-run
  → crea bozza Gmail
```

**Regole assolute:**
- MAI `messages.send` — solo `users.drafts.create`
- Se manca `contactEmail`, non creare bozza
- Le bozze vanno approvate e inviate manualmente
- Logga nel Sheet (colonna aggiuntiva "Bozza Gmail": `creata` / `non creata — motivo`)

**Auth:** `google.auth.OAuth2` con `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Il refresh token si ottiene una volta con OAuth playground o script dedicato (documentare nel README).

---

## Come testare

```bash
# 1. Installa
npm install

# 2. Configura
cp .env.example .env
# → compila le chiavi in .env

# 3. Smoke test (no Sheet)
npm run agent -- --query "dentisti Varese" --limit 5 --dry-run

# 4. Run reale
npm run agent -- --query "dentisti Varese" --limit 30

# 5. Typecheck
npm run typecheck
```

**Checklist verifica:**
- Lead con sito rotto → status `PARTIAL`/`ERROR`, altri lead continuano
- Seconda run stessa query → lead già presenti saltati come duplicati
- `out/debug-*.json` creato in dry-run con struttura `Lead[]` completa
- Google Sheet ha intestazione riga 1 + righe dati con tutti i campi
