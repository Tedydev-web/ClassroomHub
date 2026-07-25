// Response shapes for the super-admin API. Kept as plain types rather than
// inferred from the API package: this app ships independently and must not pull
// the whole `@cio/api` graph into its bundle.

export type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string | null;
  banned: boolean | null;
  createdAt: string;
  orgCount: number;
  courseCount: number;
};

export type ListUsersResult = {
  users: AdminUserRow[];
  total: number;
};

export type AdminUserOrg = {
  orgId: string;
  name: string;
  siteName: string | null;
  roleId: number;
  creditBalance: number;
};

export type AdminUserWithStats = AdminUserRow & {
  adminOrgCount: number;
  orgs: AdminUserOrg[];
};

export type ChatSummary = {
  id: string;
  title: string | null;
  courseId: string;
  updatedAt: string;
  messageCount: number;
};

export type ChatMessage = {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
};

export type ChatConversation = {
  id: string;
  title: string | null;
  courseId: string;
  messages: ChatMessage[];
  updatedAt: string;
};

export type CreatedOrg = {
  org: { id: string; name: string; siteName: string | null };
  member: { id: number | string; roleId: number };
};

// --- Per-org sidebar features ---

/**
 * The catalog ships with the data rather than being declared here, so this app
 * stays a renderer and the key list has exactly one home (`@cio/utils`).
 */
export type OrgFeatureCatalogEntry = {
  key: string;
  label: string;
  group: string;
};

export type OrgFeatureOrg = {
  orgId: string;
  name: string;
  siteName: string | null;
  /** Resolved by the API, so every catalog key has a definite value. */
  features: Record<string, boolean>;
};

export type OrgFeatures = {
  catalog: OrgFeatureCatalogEntry[];
  orgs: OrgFeatureOrg[];
};

// --- AI gateway (operator control) ---

export type GatewayHealth = {
  configured: boolean;
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  circuitState: 'closed' | 'open' | 'half_open' | string;
  circuitResumeAfter: string | null;
  consecutiveFailures: number;
  checks: {
    reachable: { ok: boolean; detail: string };
    canServe: { ok: boolean; detail: string; checkedAt: string } | null;
  };
  unrecognizedModels: string[];
};

export type GatewayQuota = {
  windows: Array<{ id: string; durationMinutes: number; capUnits: number; usedUnits: number; percentUsed: number }>;
  topOrgs: Array<{ orgId: string; units: number }>;
};

export type GatewayOrgPolicy = {
  orgId: string;
  priorityWeight: number;
  maxActiveRuns: number | null;
  maxQueuedRuns: number | null;
  windowBudgetUnits: number | null;
  isBlocked: boolean;
  blockReason: string | null;
  consumedUnits: number;
  tutorEnabled: boolean;
};

export type GatewayOrgs = {
  policies: GatewayOrgPolicy[];
  consumptionOnly: Array<{ orgId: string; units: number; tutorEnabled: boolean }>;
};

export type GatewayModelAllowlistEntry = {
  modelId: string;
  label: string;
  quotaWeight: number;
  role: 'default' | 'light' | 'optional';
  /** Whether the chat model picker offers this model. Absent means visible (defaults to true). */
  visible?: boolean;
};

export type GatewaySettings = {
  enabled: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  pausedBy: string | null;
  modelAllowlist: GatewayModelAllowlistEntry[];
  defaultModelId: string | null;
  lightModelId: string | null;
  globalConcurrency: number;
  sliceRounds: number;
  defaultOrgActiveLimit: number;
  defaultOrgQueuedLimit: number;
  defaultOrgWindowBudgetUnits: number | null;
  windows: Array<{ id: string; durationMinutes: number; capUnits: number }>;
  fallbackEnabled: boolean;
  fallbackMonthlyCapUnits: number | null;
  circuitState: 'closed' | 'open' | 'half_open' | string;
  circuitOpenedAt: string | null;
  circuitResumeAfter: string | null;
  consecutiveFailures: number;
  /** Present on the GET response; absent on the PATCH response (secrets are never round-tripped either way). */
  connectionConfigured?: boolean;
};

export type GatewayRun = {
  id: string;
  orgId: string;
  courseId: string | null;
  userId: string | null;
  status: string;
  phase: string | null;
  updatedAt: string;
  totalRounds: number;
};
