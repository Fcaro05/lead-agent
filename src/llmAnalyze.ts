import OpenAI from "openai";
import { OPENAI_API_KEY, LLM_MODEL, LLM_TEMPERATURE } from "./config";
import { LlmOutput, PlaceResult, FirecrawlResult, PageSpeedResult } from "./types";
import { safeJsonParse, truncate } from "./utils";

const SYSTEM_PROMPT = `Sei un esperto di web marketing e conversion rate optimization per PMI italiane.
Analizzi siti web di piccole aziende e produci un audit commerciale concreto e un'email di contatto professionale.

REGOLE FONDAMENTALI:
- Restituisci SOLO JSON valido. Niente markdown, niente backtick, niente testo prima o dopo.
- Non inventare dati, problemi o metriche non supportati dai dati forniti.
- Non usare frasi vaghe come "migliorare la presenza online" o "sito poco professionale".
- Ogni problema deve essere specifico e derivare dai dati reali del sito.
- Ragiona su: UX mobile, chiarezza dell'offerta, percorso verso il contatto/prenotazione, velocità, SEO tecnico.
- Valuta soprattutto l'esperienza da smartphone (dati PageSpeed mobile).
- Se un dato manca (PageSpeed fallito, sito non scrapato), ragiona con i dati disponibili e abbassa gli score di conseguenza.

SCORING (0-100 per ciascuno):
- businessValueScore: valore commerciale del settore (rating, recensioni, tipo attività, domanda potenziale)
- websitePainScore: quanto il sito è un problema (performance bassa, UX mobile scarsa, offerta non chiara, difficoltà di contatto)
- activityScore: segnali di attività recente (contenuti aggiornati, blog, promozioni, menzione eventi)
- contactabilityScore: facilità di contatto (email pubblica trovata, form visibile, numero in chiaro, CTA evidenti)

EMAIL:
- Breve (max 120 parole), naturale, non spam.
- Tono professionale ma diretto, prima persona.
- Non vendere subito un sito nuovo. Proponi un mini-audit o una call.
- Non promettere risultati certi. Non inventare numeri.
- Usa il nome dell'azienda. Non usare "Spett.le" o formule antiquate.
- Esempio tono:
  "Ciao, ho dato un'occhiata al sito di [azienda] e ho notato 2-3 punti dove secondo me potreste recuperare più richieste da mobile. Te li segnalo al volo perché sono interventi abbastanza concreti, soprattutto su chiarezza dell'offerta, percorso verso il contatto e velocità da telefono."

OUTPUT JSON richiesto (rispetta esattamente questa struttura):
{
  "businessValueScore": <0-100>,
  "websitePainScore": <0-100>,
  "activityScore": <0-100>,
  "contactabilityScore": <0-100>,
  "mainProblems": ["Problema specifico 1", "Problema specifico 2", "Problema specifico 3"],
  "salesAngle": "Angolo commerciale personalizzato (1-2 frasi)",
  "miniAudit": "Mini audit concreto (2-4 frasi, problemi reali trovati)",
  "emailSubject": "Oggetto email",
  "emailDraft": "Corpo email (max 120 parole)"
}`;

interface AnalyzeInputs {
  place: PlaceResult;
  firecrawl: FirecrawlResult | undefined;
  pagespeed: PageSpeedResult | undefined;
}

function buildUserMessage(inputs: AnalyzeInputs): string {
  const { place, firecrawl, pagespeed } = inputs;

  const siteData = firecrawl?.error
    ? `ERRORE FIRECRAWL: ${firecrawl.error}`
    : firecrawl
    ? `PAGINE ANALIZZATE: ${firecrawl.pagesScraped.join(", ")}\nEMAIL TROVATA: ${firecrawl.contactEmail || "nessuna"}\n\nCONTENUTO SITO (markdown):\n${truncate(firecrawl.markdown, 12000)}`
    : "Sito non analizzato.";

  const psData = pagespeed?.error
    ? `ERRORE PAGESPEED: ${pagespeed.error}`
    : pagespeed
    ? `Performance mobile: ${pagespeed.performance ?? "N/D"}
Accessibility: ${pagespeed.accessibility ?? "N/D"}
SEO: ${pagespeed.seo ?? "N/D"}
Best Practices: ${pagespeed.bestPractices ?? "N/D"}
Problemi principali: ${pagespeed.topIssues.length > 0 ? pagespeed.topIssues.join("; ") : "nessuno rilevato"}`
    : "PageSpeed non disponibile.";

  return `DATI AZIENDA:
Nome: ${place.name}
Categoria: ${place.category}
Città: ${place.city}
Indirizzo: ${place.address}
Sito: ${place.website}
Rating Google: ${place.rating ?? "N/D"}
Recensioni: ${place.reviewCount ?? "N/D"}
Telefono: ${place.phone ?? "N/D"}

PAGESPEED (mobile):
${psData}

SITO WEB:
${siteData}`;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  return client;
}

async function callLlm(userMessage: string): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: LLM_MODEL,
    temperature: LLM_TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function analyzeLead(inputs: AnalyzeInputs): Promise<LlmOutput> {
  const userMessage = buildUserMessage(inputs);
  const raw = await callLlm(userMessage);

  let parsed = safeJsonParse<LlmOutput>(raw);
  if (!parsed) {
    // Single retry: ask LLM to fix its JSON
    const fixMessage = `Il tuo output precedente non era JSON valido. Riscrivi SOLO il JSON corretto, senza cambiare il contenuto, senza backtick, senza testo extra:\n\n${raw}`;
    const retried = await callLlm(fixMessage);
    parsed = safeJsonParse<LlmOutput>(retried);
    if (!parsed) {
      throw new Error("LLM returned invalid JSON after retry");
    }
  }

  // Validate and clamp required fields
  const clampScore = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return isNaN(n) ? 50 : Math.min(100, Math.max(0, Math.round(n)));
  };

  return {
    businessValueScore: clampScore(parsed.businessValueScore),
    websitePainScore: clampScore(parsed.websitePainScore),
    activityScore: clampScore(parsed.activityScore),
    contactabilityScore: clampScore(parsed.contactabilityScore),
    mainProblems: Array.isArray(parsed.mainProblems) ? parsed.mainProblems.slice(0, 5) : [],
    salesAngle: String(parsed.salesAngle ?? ""),
    miniAudit: String(parsed.miniAudit ?? ""),
    emailSubject: String(parsed.emailSubject ?? ""),
    emailDraft: String(parsed.emailDraft ?? ""),
  };
}
