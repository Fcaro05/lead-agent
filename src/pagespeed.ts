import { PAGESPEED_API_KEY, PAGESPEED_TIMEOUT_MS } from "./config";
import { PageSpeedResult } from "./types";

const PAGESPEED_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

interface LighthouseAudit {
  id?: string;
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
}

interface LighthouseCategoryResult {
  score?: number | null;
}

interface LighthouseResult {
  categories?: {
    performance?: LighthouseCategoryResult;
    accessibility?: LighthouseCategoryResult;
    seo?: LighthouseCategoryResult;
    "best-practices"?: LighthouseCategoryResult;
  };
  audits?: Record<string, LighthouseAudit>;
}

interface PageSpeedApiResponse {
  lighthouseResult?: LighthouseResult;
}

function toScore(raw?: number | null): number | undefined {
  if (raw == null) return undefined;
  return Math.round(raw * 100);
}

function extractTopIssues(audits?: Record<string, LighthouseAudit>): string[] {
  if (!audits) return [];
  return Object.values(audits)
    .filter(
      (a) =>
        a.score != null &&
        a.score < 0.9 &&
        a.scoreDisplayMode !== "notApplicable" &&
        a.scoreDisplayMode !== "informative" &&
        a.scoreDisplayMode !== "manual" &&
        a.title
    )
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 5)
    .map((a) => a.title!);
}

export async function runPageSpeed(url: string): Promise<PageSpeedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGESPEED_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      url,
      strategy: "mobile",
      category: ["performance", "accessibility", "seo", "best-practices"].join("&category="),
      key: PAGESPEED_API_KEY(),
    });

    // URLSearchParams doesn't handle repeated keys cleanly — build manually
    const qs =
      `url=${encodeURIComponent(url)}&strategy=mobile` +
      `&category=performance&category=accessibility&category=seo&category=best-practices` +
      `&key=${encodeURIComponent(PAGESPEED_API_KEY())}`;

    const res = await fetch(`${PAGESPEED_URL}?${qs}`, { signal: controller.signal });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PageSpeed API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as PageSpeedApiResponse;
    const lr = data.lighthouseResult;

    return {
      performance: toScore(lr?.categories?.performance?.score),
      accessibility: toScore(lr?.categories?.accessibility?.score),
      seo: toScore(lr?.categories?.seo?.score),
      bestPractices: toScore(lr?.categories?.["best-practices"]?.score),
      topIssues: extractTopIssues(lr?.audits),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { topIssues: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}
