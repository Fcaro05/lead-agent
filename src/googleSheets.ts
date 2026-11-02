import { google } from "googleapis";
import {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID,
} from "./config";
import { Lead } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_NAME = "Sheet1";

const HEADERS = [
  "Status",
  "Query",
  "Place ID",
  "Nome business",
  "Categoria",
  "Città",
  "Indirizzo",
  "Telefono",
  "Sito",
  "Google Maps URL",
  "Rating",
  "Numero recensioni",
  "Email trovata",
  "Fonte email",
  "PageSpeed Performance",
  "PageSpeed SEO",
  "PageSpeed Accessibility",
  "PageSpeed Best Practices",
  "Business Value Score",
  "Website Pain Score",
  "Activity Score",
  "Contactability Score",
  "Opportunity Score",
  "Priorità",
  "Problemi principali",
  "Sales Angle",
  "Mini Audit",
  "Email Subject",
  "Email Draft",
  "Errori",
  "Created At",
];

function getAuth() {
  return new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL(),
    key: GOOGLE_PRIVATE_KEY(),
    scopes: SCOPES,
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export async function ensureHeader(): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = GOOGLE_SHEET_ID();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:A1`,
  });

  const firstCell = res.data.values?.[0]?.[0];
  if (!firstCell) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
}

interface DedupeKeys {
  placeIds: Set<string>;
  websites: Set<string>;
  nameCity: Set<string>;
}

export async function loadExistingKeys(): Promise<DedupeKeys> {
  const sheets = getSheetsClient();
  const sheetId = GOOGLE_SHEET_ID();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:K`,
  });

  const rows = res.data.values ?? [];
  const placeIds = new Set<string>();
  const websites = new Set<string>();
  const nameCity = new Set<string>();

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const placeId = row[2] as string | undefined;
    const website = row[8] as string | undefined;
    const name = row[3] as string | undefined;
    const city = row[5] as string | undefined;

    if (placeId) placeIds.add(placeId.trim());
    if (website) websites.add(website.trim().toLowerCase().replace(/\/$/, ""));
    if (name && city) nameCity.add(`${name.trim().toLowerCase()}|${city.trim().toLowerCase()}`);
  }

  return { placeIds, websites, nameCity };
}

export function isDuplicate(placeData: Lead["placeData"], keys: DedupeKeys): boolean {
  if (keys.placeIds.has(placeData.placeId)) return true;
  const normalizedSite = placeData.website.trim().toLowerCase().replace(/\/$/, "");
  if (normalizedSite && keys.websites.has(normalizedSite)) return true;
  const key = `${placeData.name.trim().toLowerCase()}|${placeData.city.trim().toLowerCase()}`;
  if (keys.nameCity.has(key)) return true;
  return false;
}

export async function appendLead(lead: Lead): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = GOOGLE_SHEET_ID();
  const p = lead.placeData;
  const a = lead.analysis;
  const ps = lead.pagespeed;

  const row = [
    lead.status,
    lead.query,
    p.placeId,
    p.name,
    p.category,
    p.city,
    p.address,
    p.phone ?? "",
    p.website,
    p.mapsUrl ?? "",
    p.rating != null ? String(p.rating) : "",
    p.reviewCount != null ? String(p.reviewCount) : "",
    a?.contactEmail ?? "",
    a?.emailFoundSource ?? "",
    ps?.performance != null ? String(ps.performance) : "",
    ps?.seo != null ? String(ps.seo) : "",
    ps?.accessibility != null ? String(ps.accessibility) : "",
    ps?.bestPractices != null ? String(ps.bestPractices) : "",
    a?.businessValueScore != null ? String(a.businessValueScore) : "",
    a?.websitePainScore != null ? String(a.websitePainScore) : "",
    a?.activityScore != null ? String(a.activityScore) : "",
    a?.contactabilityScore != null ? String(a.contactabilityScore) : "",
    a?.opportunityScore != null ? String(a.opportunityScore) : "",
    a?.priority ?? "",
    a?.mainProblems?.join(" | ") ?? "",
    a?.salesAngle ?? "",
    a?.miniAudit ?? "",
    a?.emailSubject ?? "",
    a?.emailDraft ?? "",
    lead.errors.join("; "),
    lead.createdAt,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}
