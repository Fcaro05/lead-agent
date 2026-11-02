import { LlmOutput, FirecrawlResult, AnalysisResult } from "./types";
import { clamp } from "./utils";

export function computeOpportunityScore(scores: {
  businessValueScore: number;
  websitePainScore: number;
  activityScore: number;
  contactabilityScore: number;
}): number {
  const raw =
    scores.businessValueScore * 0.3 +
    scores.websitePainScore * 0.35 +
    scores.activityScore * 0.2 +
    scores.contactabilityScore * 0.15;
  return clamp(raw, 0, 100);
}

export function computePriority(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 75) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

export function buildAnalysisResult(
  llmOut: LlmOutput,
  firecrawl: FirecrawlResult | undefined
): AnalysisResult {
  const opportunityScore = computeOpportunityScore(llmOut);
  const priority = computePriority(opportunityScore);

  // Email comes from deterministic extraction, not LLM
  const contactEmail = firecrawl?.contactEmail ?? "";
  const emailFoundSource = firecrawl?.emailFoundSource ?? "";

  return {
    businessValueScore: llmOut.businessValueScore,
    websitePainScore: llmOut.websitePainScore,
    activityScore: llmOut.activityScore,
    contactabilityScore: llmOut.contactabilityScore,
    opportunityScore,
    priority,
    contactEmail,
    emailFoundSource,
    mainProblems: llmOut.mainProblems,
    salesAngle: llmOut.salesAngle,
    miniAudit: llmOut.miniAudit,
    emailSubject: llmOut.emailSubject,
    emailDraft: llmOut.emailDraft,
  };
}
