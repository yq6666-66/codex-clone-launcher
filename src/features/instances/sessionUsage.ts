import type { CodexSessionUsageModelSummary, CodexSessionUsageSummary } from '../../shared/types';

type SessionUsagePricingRule = {
  pattern: RegExp;
  label: string;
  source: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type SessionUsageCostEstimate = {
  model: string;
  priced: boolean;
  pricingLabel: string;
  pricingSource: string;
  billableInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

export type SessionUsageCostSummary = {
  totalCostUsd: number;
  pricedModels: number;
  unpricedModels: number;
  billableInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheHitRate: number;
  byModel: SessionUsageCostEstimate[];
};

const sessionUsagePricingRules: SessionUsagePricingRule[] = [
  {
    pattern: /gpt-5\.5|gpt-5|codex/i,
    label: 'GPT/Codex family estimate',
    source: 'local reference',
    inputUsdPerMillion: 1.25,
    cachedInputUsdPerMillion: 0.125,
    outputUsdPerMillion: 10,
  },
  {
    pattern: /gpt-4\.1|gpt-4o/i,
    label: 'GPT-4 class estimate',
    source: 'local reference',
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  },
  {
    pattern: /\bo3\b|o3-|o1/i,
    label: 'reasoning model estimate',
    source: 'local reference',
    inputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 2.5,
    outputUsdPerMillion: 40,
  },
  {
    pattern: /o4-mini|gpt-4\.1-mini|gpt-4o-mini/i,
    label: 'mini model estimate',
    source: 'local reference',
    inputUsdPerMillion: 0.6,
    cachedInputUsdPerMillion: 0.15,
    outputUsdPerMillion: 2.4,
  },
  {
    pattern: /deepseek|qwen|kimi|glm|moonshot|yi-|minimax|mimo/i,
    label: 'domestic gateway estimate',
    source: 'local reference',
    inputUsdPerMillion: 0.4,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 1.6,
  },
  {
    pattern: /ollama|llama|local|localhost|127\.0\.0\.1/i,
    label: 'local model',
    source: 'local runtime',
    inputUsdPerMillion: 0,
    cachedInputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  },
];

function sessionUsagePricingForModel(model: string): SessionUsagePricingRule | null {
  const normalized = model.trim();
  if (!normalized) return null;
  return sessionUsagePricingRules.find((rule) => rule.pattern.test(normalized)) ?? null;
}

function estimateSessionUsageModelCost(
  model: CodexSessionUsageModelSummary,
  unpricedLabel: string,
): SessionUsageCostEstimate {
  const pricing = sessionUsagePricingForModel(model.model);
  const inputTokens = Math.max(0, model.inputTokens ?? 0);
  const cachedInputTokens = Math.min(Math.max(0, model.cachedInputTokens ?? 0), inputTokens);
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = Math.max(0, model.outputTokens ?? 0);
  if (!pricing) {
    return {
      model: model.model,
      priced: false,
      pricingLabel: unpricedLabel,
      pricingSource: 'none',
      billableInputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: Math.max(0, model.totalTokens ?? 0),
      inputCostUsd: 0,
      cachedInputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
    };
  }
  const inputCostUsd = (billableInputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const cachedInputCostUsd = (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return {
    model: model.model,
    priced: true,
    pricingLabel: pricing.label,
    pricingSource: pricing.source,
    billableInputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: Math.max(0, model.totalTokens ?? 0),
    inputCostUsd,
    cachedInputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd,
  };
}

export function sessionUsageCostSummary(
  usage: CodexSessionUsageSummary,
  labels: { unpriced: string },
): SessionUsageCostSummary {
  const byModel = usage.byModel.map((model) => estimateSessionUsageModelCost(model, labels.unpriced));
  const totalInputTokens = Math.max(0, usage.inputTokens ?? 0);
  const cachedInputTokens = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), totalInputTokens);
  const billableInputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  return {
    totalCostUsd: byModel.reduce((sum, item) => sum + item.totalCostUsd, 0),
    pricedModels: byModel.filter((item) => item.priced).length,
    unpricedModels: byModel.filter((item) => !item.priced).length,
    billableInputTokens,
    cachedInputTokens,
    outputTokens: Math.max(0, usage.outputTokens ?? 0),
    cacheHitRate: totalInputTokens ? cachedInputTokens / totalInputTokens : 0,
    byModel,
  };
}
