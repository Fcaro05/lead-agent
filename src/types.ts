export interface PlaceResult {
  placeId: string;
  name: string;
  website: string;
  rating?: number;
  reviewCount?: number;
  phone?: string;
  address: string;
  city: string;
  category: string;
  mapsUrl?: string;
}

export interface FirecrawlResult {
  markdown: string;
  pagesScraped: string[];
  contactEmail: string;
  emailFoundSource: string;
  error?: string;
}

export interface PageSpeedResult {
  performance?: number;
  accessibility?: number;
  seo?: number;
  bestPractices?: number;
  topIssues: string[];
  error?: string;
}

export interface LlmOutput {
  businessValueScore: number;
  websitePainScore: number;
  activityScore: number;
  contactabilityScore: number;
  mainProblems: string[];
  salesAngle: string;
  miniAudit: string;
  emailSubject: string;
  emailDraft: string;
}

export interface AnalysisResult {
  businessValueScore: number;
  websitePainScore: number;
  activityScore: number;
  contactabilityScore: number;
  opportunityScore: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  contactEmail: string;
  emailFoundSource: string;
  mainProblems: string[];
  salesAngle: string;
  miniAudit: string;
  emailSubject: string;
  emailDraft: string;
}

export interface Lead {
  query: string;
  placeData: PlaceResult;
  firecrawl?: FirecrawlResult;
  pagespeed?: PageSpeedResult;
  analysis?: AnalysisResult;
  errors: string[];
  status: "OK" | "PARTIAL" | "ERROR";
  createdAt: string;
}
