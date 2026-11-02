import { parseArgs } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateConfig } from "./config";
import { RATE_LIMIT_MS, MIN_RATING, MIN_REVIEWS } from "./config";
import { searchBusinesses } from "./googlePlaces";
import { scrapeSite } from "./firecrawl";
import { runPageSpeed } from "./pagespeed";
import { analyzeLead } from "./llmAnalyze";
import { buildAnalysisResult } from "./scoring";
import {
  ensureHeader,
  loadExistingKeys,
  isDuplicate,
  appendLead,
} from "./googleSheets";
import { Lead, PlaceResult } from "./types";
import { sleep, log } from "./utils";

// ─── CLI Args ──────────────────────────────────────────────────────────────────

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      query: { type: "string" },
      limit: { type: "string", default: "20" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  if (!values.query) {
    console.error('Usage: npm run agent -- --query "dentisti Varese" [--limit 30] [--dry-run]');
    process.exit(1);
  }

  return {
    query: values.query,
    limit: parseInt(values.limit ?? "20", 10),
    dryRun: values["dry-run"] ?? false,
  };
}

// ─── Lead filter ───────────────────────────────────────────────────────────────

function filterLeads(places: PlaceResult[]): {
  valid: PlaceResult[];
  noWebsite: number;
  filteredRating: number;
} {
  let noWebsite = 0;
  let filteredRating = 0;
  const valid: PlaceResult[] = [];

  for (const p of places) {
    if (!p.website) {
      noWebsite++;
      continue;
    }
    if (p.rating != null && p.rating < MIN_RATING) {
      filteredRating++;
      continue;
    }
    if (p.reviewCount != null && p.reviewCount < MIN_REVIEWS) {
      filteredRating++;
      continue;
    }
    valid.push(p);
  }

  return { valid, noWebsite, filteredRating };
}

// ─── Process one lead ──────────────────────────────────────────────────────────

async function processLead(
  place: PlaceResult,
  query: string,
  index: number,
  total: number
): Promise<Lead> {
  log.info(`[${index}/${total}] ${place.name}`);

  const lead: Lead = {
    query,
    placeData: place,
    errors: [],
    status: "OK",
    createdAt: new Date().toISOString(),
  };

  // ── Firecrawl ──
  try {
    lead.firecrawl = await scrapeSite(place.website);
    if (lead.firecrawl.error) {
      lead.errors.push(`Firecrawl: ${lead.firecrawl.error}`);
      lead.status = "PARTIAL";
      log.err("Firecrawl", lead.firecrawl.error.slice(0, 80));
    } else {
      log.ok("Firecrawl", `${lead.firecrawl.pagesScraped.length} pagine`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lead.errors.push(`Firecrawl: ${msg}`);
    lead.status = "PARTIAL";
    log.err("Firecrawl", msg.slice(0, 80));
  }

  // ── PageSpeed ──
  try {
    lead.pagespeed = await runPageSpeed(place.website);
    if (lead.pagespeed.error) {
      lead.errors.push(`PageSpeed: ${lead.pagespeed.error}`);
      lead.status = "PARTIAL";
      log.err("PageSpeed", lead.pagespeed.error.slice(0, 80));
    } else {
      log.ok(
        "PageSpeed",
        `perf=${lead.pagespeed.performance ?? "N/D"} seo=${lead.pagespeed.seo ?? "N/D"}`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lead.errors.push(`PageSpeed: ${msg}`);
    lead.status = "PARTIAL";
    log.err("PageSpeed", msg.slice(0, 80));
  }

  // ── LLM Analysis ──
  try {
    const llmOut = await analyzeLead({
      place,
      firecrawl: lead.firecrawl,
      pagespeed: lead.pagespeed,
    });
    lead.analysis = buildAnalysisResult(llmOut, lead.firecrawl);
    const errLabel = lead.errors.length > 0 ? " (dati parziali)" : "";
    log.ok(
      "LLM",
      `score=${lead.analysis.opportunityScore} ${lead.analysis.priority}${errLabel}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lead.errors.push(`LLM: ${msg}`);
    lead.status = "ERROR";
    log.err("LLM", msg.slice(0, 80));
  }

  return lead;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { query, limit, dryRun } = parseCliArgs();

  if (!dryRun) {
    validateConfig();
  } else {
    // In dry-run, validate only mandatory API keys (no Sheet/service account needed)
    const required = [
      "GOOGLE_PLACES_API_KEY",
      "FIRECRAWL_API_KEY",
      "PAGESPEED_API_KEY",
      "OPENAI_API_KEY",
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.error(`Missing env vars for dry-run:\n  ${missing.join("\n  ")}`);
      process.exit(1);
    }
  }

  if (dryRun) log.warn("DRY RUN — nessuna scrittura su Google Sheet");

  // ── 1. Google Places ──
  log.section("Ricerca aziende…");
  const places = await searchBusinesses(query, limit);
  log.info(`${places.length} aziende trovate`);

  // ── 2. Filter ──
  const { valid, noWebsite, filteredRating } = filterLeads(places);
  log.info(`${valid.length} con sito (${noWebsite} senza sito, ${filteredRating} filtrati per rating/recensioni)`);

  if (valid.length === 0) {
    log.warn("Nessun lead valido trovato. Termino.");
    return;
  }

  // ── 3. Dedup vs Sheet ──
  let existingKeys = { placeIds: new Set<string>(), websites: new Set<string>(), nameCity: new Set<string>() };
  if (!dryRun) {
    log.section("Carico dati esistenti da Google Sheet…");
    await ensureHeader();
    existingKeys = await loadExistingKeys();
  }

  const toProcess: PlaceResult[] = [];
  let duplicates = 0;
  const seenInBatch = { placeIds: new Set<string>(), websites: new Set<string>(), nameCity: new Set<string>() };

  for (const p of valid) {
    const combinedKeys = {
      placeIds: new Set([...existingKeys.placeIds, ...seenInBatch.placeIds]),
      websites: new Set([...existingKeys.websites, ...seenInBatch.websites]),
      nameCity: new Set([...existingKeys.nameCity, ...seenInBatch.nameCity]),
    };

    if (isDuplicate(p, combinedKeys)) {
      log.dim(`  Saltato (duplicato): ${p.name}`);
      duplicates++;
      continue;
    }

    toProcess.push(p);
    seenInBatch.placeIds.add(p.placeId);
    if (p.website) seenInBatch.websites.add(p.website.trim().toLowerCase().replace(/\/$/, ""));
    if (p.name && p.city) seenInBatch.nameCity.add(`${p.name.trim().toLowerCase()}|${p.city.trim().toLowerCase()}`);
  }

  if (duplicates > 0) log.info(`${duplicates} duplicate saltate`);

  if (toProcess.length === 0) {
    log.warn("Tutti i lead sono già presenti nel Google Sheet.");
    return;
  }

  // ── 4. Process leads ──
  log.section(`Analizzo ${toProcess.length} lead…`);
  const results: Lead[] = [];
  const savedLeads: Lead[] = [];
  let savedCount = 0;
  let highCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const place = toProcess[i]!;

    const lead = await processLead(place, query, i + 1, toProcess.length);
    results.push(lead);

    if (lead.analysis?.priority === "HIGH") highCount++;

    // ── Save ──
    if (!dryRun) {
      try {
        await appendLead(lead);
        savedCount++;
        log.ok("Salvato su Google Sheet");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.err("Google Sheet", msg.slice(0, 80));
      }
    } else {
      savedLeads.push(lead);
    }

    if (i < toProcess.length - 1) await sleep(RATE_LIMIT_MS);
  }

  // ── Summary ──
  log.section("─────────────────────────────────");
  log.summary(`${places.length} aziende trovate`);
  log.summary(`${valid.length} con sito`);
  log.summary(`${duplicates} duplicate saltate`);
  log.summary(`${toProcess.length} analizzate`);
  log.summary(`${highCount} lead alta priorità`);

  if (!dryRun) {
    log.summary(`${savedCount} righe salvate su Google Sheet`);
  } else {
    // Save debug JSON
    const outDir = "out";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const filename = path.join(outDir, `debug-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(results, null, 2), "utf-8");
    log.summary(`[DRY RUN] Output salvato in ${filename}`);
  }
}

main().catch((err) => {
  console.error("\nERRORE FATALE:", err instanceof Error ? err.message : err);
  process.exit(1);
});
