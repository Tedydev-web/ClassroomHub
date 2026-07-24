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
