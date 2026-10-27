import type { TokenBalance, TokenUsage } from '@cio/ai-assistant';
import {
  aggregateTokenUsageByUser,
  countRequests,
  getDailyTokenUsageHistory,
  getMonthlyTokenUsage,
  getOrgCreditBalance,
  insertTokenUsageAndDrainCredits,
  summarizePurchases,
  upsertCreditBalance
} from '@cio/db/queries/agent';
import type { UsageLeaderboardRow } from '@cio/db/queries/agent';
import { getActiveOrganizationPlan } from '@cio/db/queries/organization';

import { AppError } from '@cio/utils/errors';
import { isSelfOwnedDeployment } from '../../config/deployment';
import { capturePlanLimitReached } from '../posthog';

function startOfCurrentMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return date;
}

// ─── Plan-Based Token Allowances ─────────────────────────────────────────────

const PLAN_TOKEN_ALLOWANCES: Record<string, number> = {
  BASIC: 500_000,
  EARLY_ADOPTER: 3_000_000,
  ENTERPRISE: 15_000_000
};

// ─── Model Cost Multipliers ───────────────────────────────────────────────────

// Blended multiplier vs Gemini 2.5 Flash Lite baseline ($0.16/1M blended at 80/20 input/output mix); unknown → 1×.
// Older Gemini models remain for backward compatibility with historical usage records.
const MODEL_COST_MULTIPLIER: Record<string, number> = {
  'gemini-2.5-flash-lite': 1,
  'gemini-3.1-flash-lite': 3.125,
  'gemini-2.5-flash': 1.5,
  // Codex models served through the gateway. These weights express quota burn
  // relative to the lightest model, not dollars — keep them in step with the
  // gateway allowlist's `quotaWeight` until the two are unified.
  'gpt-5.4-mini': 4,
  'gpt-5.4': 12,
  'gpt-5.6-luna': 8,
  'gpt-5.6-terra': 20,
  'gpt-5.6-sol': 30,
  'claude-sonnet-4-6': 11,
  'claude-haiku-4-5-20251001': 1.5,
  'kimi-k2.6': 1,
  // Non-LLM spend: billed as a flat charge via `recordFlatCostUnits`, so the
  // multiplier is never applied. Listed to keep this map a complete inventory.
  'supadata-youtube-captions': 1
};

function computeCostUnits(
  promptTokens: number,
  completionTokens: number,
  model: string,
  quotaMultiplier?: number
): number {
  const configuredMultiplier =
    typeof quotaMultiplier === 'number' && Number.isFinite(quotaMultiplier) && quotaMultiplier > 0
      ? quotaMultiplier
      : null;
  const multiplier = configuredMultiplier ?? MODEL_COST_MULTIPLIER[model] ?? 1;
  return Math.round((promptTokens + completionTokens) * multiplier);
}

/**
 * Sentinel for "no plan ceiling". Kept as a number so every arithmetic call site
 * keeps working, but reported separately as `isUnlimited` so presentation layers
 * never divide by it — that always renders 0% and implies a budget that does not
 * exist.
 */
const UNLIMITED_ALLOWANCE = Number.MAX_SAFE_INTEGER;

async function getPlanAllowance(orgId: string): Promise<{ planName: string; allowance: number }> {
  if (isSelfOwnedDeployment) {
    return { planName: 'ENTERPRISE', allowance: UNLIMITED_ALLOWANCE };
  }

  const activePlan = await getActiveOrganizationPlan(orgId);

  if (!activePlan || !activePlan.planName) {
    return { planName: 'BASIC', allowance: PLAN_TOKEN_ALLOWANCES.BASIC };
  }

  const planName = activePlan.planName;
  const payload = activePlan.payload as Record<string, unknown> | null;
  const customAllowance = payload?.aiTokenAllowance as number | undefined;
  const allowance = customAllowance ?? PLAN_TOKEN_ALLOWANCES[planName] ?? 0;

  return { planName, allowance };
}

export async function getMonthlyUsage(orgId: string): Promise<number> {
  return getMonthlyTokenUsage(orgId, startOfCurrentMonth());
}

export async function getCreditBalance(orgId: string): Promise<number> {
  return getOrgCreditBalance(orgId);
}

export async function getTokenBalance(orgId: string): Promise<TokenBalance> {
  const [{ allowance }, monthlyUsage, creditBalance] = await Promise.all([
    getPlanAllowance(orgId),
    getMonthlyUsage(orgId),
    getCreditBalance(orgId)
  ]);

  const remainingAllowance = Math.max(0, allowance - monthlyUsage);
  const remaining = remainingAllowance + creditBalance;

  return {
    used: monthlyUsage,
    allowance,
    creditBalance,
    remaining,
    isUnlimited: allowance >= UNLIMITED_ALLOWANCE
  };
}

export async function enforceTokenBalance(orgId: string): Promise<TokenBalance> {
  const balance = await getTokenBalance(orgId);

  if (balance.remaining <= 0) {
    const { planName } = await getPlanAllowance(orgId);

    capturePlanLimitReached({
      orgId,
      limitType: 'ai_tokens',
      plan: planName,
      limit: balance.allowance,
      current: balance.used,
      blocked: true
    });

    throw new AppError('Token limit reached', 'TOKEN_LIMIT_REACHED', 402);
  }

  return balance;
}

export function computePurchasedTokenOverflow(params: {
  allowance: number;
  monthlyUsageBefore: number;
  requestTokens: number;
}): number {
  const allowanceRemainingBefore = Math.max(0, params.allowance - params.monthlyUsageBefore);

  return Math.max(0, params.requestTokens - allowanceRemainingBefore);
}

/** Record token usage after an LLM call; drains purchased credits when usage exceeds plan allowance. */
export async function recordTokenUsage(
  orgId: string,
  userId: string,
  courseId: string,
  usage: TokenUsage,
  model: string,
  attribution: {
    transport: 'gateway' | 'official';
    workloadDomain: 'interactive' | 'course_generation' | 'exam_import';
    workloadId?: string;
    idempotencyKey?: string;
    quotaMultiplier?: number;
  } = {
    transport: 'official',
    workloadDomain: 'interactive'
  }
): Promise<void> {
  const costUnits = computeCostUnits(usage.promptTokens, usage.completionTokens, model, attribution.quotaMultiplier);
  const { allowance } = await getPlanAllowance(orgId);

  await insertTokenUsageAndDrainCredits({
    orgId,
    userId,
    courseId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUnits,
    model,
    transport: attribution.transport,
    workloadDomain: attribution.workloadDomain,
    workloadId: attribution.workloadId,
    idempotencyKey: attribution.idempotencyKey,
    planAllowance: allowance,
    since: startOfCurrentMonth()
  });
}

/**
 * Record a flat, non-token charge (a paid provider call) against the org's AI
 * budget, draining purchased credits once the plan allowance is spent.
 *
 * `recordTokenUsage` cannot express this: it derives `costUnits` from
 * `promptTokens + completionTokens`, so routing a flat charge through it would
 * write fabricated token counts into `ai_token_usage`. Here both token columns
 * stay `0` and `cost_units` carries the charge — safe because every aggregation
 * reads `COALESCE(cost_units, prompt_tokens + completion_tokens)`.
 */
export async function recordFlatCostUnits(
  orgId: string,
  userId: string,
  courseId: string,
  costUnits: number,
  model: string
): Promise<void> {
  if (costUnits <= 0) {
    return;
  }

  const { allowance } = await getPlanAllowance(orgId);

  await insertTokenUsageAndDrainCredits({
    orgId,
    userId,
    courseId,
    promptTokens: 0,
    completionTokens: 0,
    costUnits,
    model,
    planAllowance: allowance,
    since: startOfCurrentMonth()
  });
}

export async function getOrgPlanName(orgId: string): Promise<string> {
  const { planName } = await getPlanAllowance(orgId);

  return planName;
}

export async function isOrgOnPaidPlan(orgId: string): Promise<boolean> {
  const planName = await getOrgPlanName(orgId);

  return planName !== 'BASIC';
}

// ─── Usage History ───────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string;
  tokens: number;
}

export async function getUsageHistory(orgId: string): Promise<DailyUsage[]> {
  return getDailyTokenUsageHistory(orgId, startOfCurrentMonth());
}

export interface PurchasedSummary {
  totalPurchasedTokens: number;
  totalSpentCents: number;
  currency: 'USD';
  currentBalance: number;
  lastPurchaseAt: string | null;
}

export async function getPurchasedSummary(orgId: string): Promise<PurchasedSummary> {
  const [summary, currentBalance] = await Promise.all([summarizePurchases(orgId), getCreditBalance(orgId)]);

  return {
    totalPurchasedTokens: summary.totalPurchasedTokens,
    totalSpentCents: summary.totalSpentCents,
    currency: 'USD',
    currentBalance,
    lastPurchaseAt: summary.lastPurchaseAt
  };
}

export interface LeaderboardEntry {
  userId: string;
  fullname: string | null;
  email: string | null;
  avatarUrl: string | null;
  tokens: number;
  requests: number;
  favoriteModel: string | null;
  percentage: number;
}

export async function getTeamLeaderboard(orgId: string): Promise<{ entries: LeaderboardEntry[]; totalTokens: number }> {
  const rows: UsageLeaderboardRow[] = await aggregateTokenUsageByUser(orgId, startOfCurrentMonth());
  const totalTokens = rows.reduce((sum: number, row: UsageLeaderboardRow) => sum + row.tokens, 0);

  const entries: LeaderboardEntry[] = rows.map((row: UsageLeaderboardRow) => ({
    userId: row.userId,
    fullname: row.fullname,
    email: row.email,
    avatarUrl: row.avatarUrl,
    tokens: row.tokens,
    requests: row.requests,
    favoriteModel: row.favoriteModel,
    percentage: totalTokens > 0 ? row.tokens / totalTokens : 0
  }));

  return { entries, totalTokens };
}

export async function getDetailedUsage(orgId: string) {
  const start = startOfCurrentMonth();
  const [balance, history, requestsThisMonth] = await Promise.all([
    getTokenBalance(orgId),
    getDailyTokenUsageHistory(orgId, start),
    countRequests(orgId, start)
  ]);

  return { ...balance, history, requestsThisMonth };
}

// ─── Credit Purchases ────────────────────────────────────────────────────────

export async function addCredits(orgId: string, amount: number): Promise<number> {
  if (amount <= 0) {
    throw new AppError('Credit amount must be positive', 'INVALID_CREDIT_AMOUNT', 400);
  }

  return upsertCreditBalance(orgId, amount);
}
