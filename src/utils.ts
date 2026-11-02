export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(n), min), max);
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const JUNK_EMAIL_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp|pdf)$/i,
  /example\.(com|org|net)/i,
  /sentry\./i,
  /wixpress\./i,
  /@2x/i,
  /noreply/i,
  /no-reply/i,
  /yourname/i,
  /yourdomain/i,
  /domain\.com/i,
  /email@/i,
];

export function extractEmails(text: string): string[] {
  const raw = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];
  const unique = [...new Set(raw)];
  return unique.filter((e) => !JUNK_EMAIL_PATTERNS.some((p) => p.test(e)));
}

export function safeJsonParse<T>(raw: string): T | null {
  let cleaned = raw.trim();

  // Remove markdown fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  // Extract first JSON object/array
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ─── Console logger ────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export const log = {
  info: (msg: string) => console.log(`${CYAN}${msg}${RESET}`),
  ok: (step: string, extra?: string) =>
    console.log(`  ${GREEN}✓${RESET} ${step}${extra ? ` ${DIM}${extra}${RESET}` : ""}`),
  err: (step: string, error?: string) =>
    console.log(`  ${RED}✗${RESET} ${step}${error ? `: ${DIM}${error}${RESET}` : ""}`),
  warn: (msg: string) => console.log(`  ${YELLOW}⚠${RESET} ${msg}`),
  dim: (msg: string) => console.log(`  ${DIM}${msg}${RESET}`),
  section: (msg: string) => console.log(`\n${YELLOW}${msg}${RESET}`),
  summary: (msg: string) => console.log(`${GREEN}${msg}${RESET}`),
};
