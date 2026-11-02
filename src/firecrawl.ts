import { FIRECRAWL_API_KEY, MAX_PAGES_PER_SITE, MAX_MARKDOWN_CHARS, FIRECRAWL_TIMEOUT_MS } from "./config";
import { FirecrawlResult } from "./types";
import { extractEmails, truncate, domainOf } from "./utils";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

const SERVICE_KEYWORDS = ["servizi", "trattamenti", "prestazioni", "cosa-facciamo", "cosa_facciamo", "soluzioni", "offerta"];
const CONTACT_KEYWORDS = ["contatti", "contatto", "contact", "prenota", "appuntamento", "booking"];

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    links?: string[];
  };
  error?: string;
}

async function scrapePage(url: string): Promise<{ markdown: string; links: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS);

  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY()}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as FirecrawlScrapeResponse;
    if (!data.success) throw new Error(data.error ?? "Firecrawl returned success=false");

    return {
      markdown: data.data?.markdown ?? "",
      links: data.data?.links ?? [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function matchesKeywords(url: string, keywords: string[]): boolean {
  const path = url.toLowerCase();
  return keywords.some((kw) => path.includes(kw));
}

function filterInternalLinks(links: string[], baseUrl: string): string[] {
  const baseDomain = domainOf(baseUrl);
  return links.filter((link) => {
    try {
      return domainOf(link) === baseDomain;
    } catch {
      return false;
    }
  });
}

function pickPage(links: string[], keywords: string[]): string | null {
  return links.find((l) => matchesKeywords(l, keywords)) ?? null;
}

function pickBestEmail(
  emails: { email: string; source: string }[]
): { contactEmail: string; emailFoundSource: string } {
  if (emails.length === 0) return { contactEmail: "", emailFoundSource: "" };
  // Prefer email from contact page
  const fromContact = emails.find((e) => CONTACT_KEYWORDS.some((kw) => e.source.toLowerCase().includes(kw)));
  const best = fromContact ?? emails[0];
  return { contactEmail: best.email, emailFoundSource: best.source };
}

export async function scrapeSite(websiteUrl: string): Promise<FirecrawlResult> {
  const pagesScraped: string[] = [];
  const markdownParts: string[] = [];
  const collectedEmails: { email: string; source: string }[] = [];

  try {
    // 1. Homepage
    const home = await scrapePage(websiteUrl);
    pagesScraped.push(websiteUrl);
    markdownParts.push(home.markdown);

    const emails = extractEmails(home.markdown);
    emails.forEach((e) => collectedEmails.push({ email: e, source: websiteUrl }));

    // 2. Find internal links
    const internal = filterInternalLinks(home.links, websiteUrl);

    let servicePage: string | null = null;
    let contactPage: string | null = null;

    if (pagesScraped.length < MAX_PAGES_PER_SITE) {
      servicePage = pickPage(internal, SERVICE_KEYWORDS);
      if (servicePage && servicePage !== websiteUrl) {
        try {
          const sp = await scrapePage(servicePage);
          pagesScraped.push(servicePage);
          markdownParts.push(sp.markdown);
          extractEmails(sp.markdown).forEach((e) =>
            collectedEmails.push({ email: e, source: servicePage! })
          );
        } catch {
          // skip silently — not critical
        }
      }
    }

    if (pagesScraped.length < MAX_PAGES_PER_SITE) {
      contactPage = pickPage(internal, CONTACT_KEYWORDS);
      if (contactPage && contactPage !== websiteUrl && contactPage !== servicePage) {
        try {
          const cp = await scrapePage(contactPage);
          pagesScraped.push(contactPage);
          markdownParts.push(cp.markdown);
          extractEmails(cp.markdown).forEach((e) =>
            collectedEmails.push({ email: e, source: contactPage! })
          );
        } catch {
          // skip silently — not critical
        }
      }
    }

    const { contactEmail, emailFoundSource } = pickBestEmail(collectedEmails);
    const markdown = truncate(markdownParts.join("\n\n---\n\n"), MAX_MARKDOWN_CHARS);

    return { markdown, pagesScraped, contactEmail, emailFoundSource };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      markdown: "",
      pagesScraped,
      contactEmail: "",
      emailFoundSource: "",
      error: message,
    };
  }
}
