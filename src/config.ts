import "dotenv/config";

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional_env(key: string): string {
  return process.env[key] ?? "";
}

// Validate FASE 1 keys at import time
let validated = false;
export function validateConfig(): void {
  if (validated) return;
  const required = [
    "GOOGLE_PLACES_API_KEY",
    "FIRECRAWL_API_KEY",
    "PAGESPEED_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_SHEET_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars:\n  ${missing.join("\n  ")}\n\nCopy .env.example to .env and fill in the values.`);
  }
  validated = true;
}

// ─── Keys ──────────────────────────────────────────────────────────────────────

export const GOOGLE_PLACES_API_KEY = () => require_env("GOOGLE_PLACES_API_KEY");
export const FIRECRAWL_API_KEY = () => require_env("FIRECRAWL_API_KEY");
export const PAGESPEED_API_KEY = () => require_env("PAGESPEED_API_KEY");
export const OPENAI_API_KEY = () => require_env("OPENAI_API_KEY");
export const GOOGLE_SHEET_ID = () => require_env("GOOGLE_SHEET_ID");
export const GOOGLE_SERVICE_ACCOUNT_EMAIL = () => require_env("GOOGLE_SERVICE_ACCOUNT_EMAIL");

export const GOOGLE_PRIVATE_KEY = (): string => {
  const raw = require_env("GOOGLE_PRIVATE_KEY");
  // Handle escaped newlines from .env files
  return raw.replace(/\\n/g, "\n");
};

// Gmail (optional in FASE 1)
export const GMAIL_CLIENT_ID = () => optional_env("GMAIL_CLIENT_ID");
export const GMAIL_CLIENT_SECRET = () => optional_env("GMAIL_CLIENT_SECRET");
export const GMAIL_REFRESH_TOKEN = () => optional_env("GMAIL_REFRESH_TOKEN");
export const isGmailConfigured = (): boolean =>
  Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );

// ─── Constants ─────────────────────────────────────────────────────────────────

export const RATE_LIMIT_MS = 1200;          // pause between leads
export const MAX_PAGES_PER_SITE = 3;
export const MAX_MARKDOWN_CHARS = 18_000;   // ~4k tokens per lead to LLM
export const PAGESPEED_TIMEOUT_MS = 20_000;
export const FIRECRAWL_TIMEOUT_MS = 30_000;
export const LLM_MODEL = "gpt-4o-mini";
export const LLM_TEMPERATURE = 0.3;

// Lead filter thresholds
export const MIN_RATING = 3.8;
export const MIN_REVIEWS = 10;
