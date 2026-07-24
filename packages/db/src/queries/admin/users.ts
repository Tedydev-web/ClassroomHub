import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import * as schema from '@db/schema';
import { db } from '@db/drizzle';

const ADMIN_ROLE_ID = 1;

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string | null;
  banned: boolean | null;
  createdAt: Date;
  orgCount: number;
  courseCount: number;
};

/**
 * One page of the super-admin user table.
 *
 * `orgCount` and `courseCount` are correlated subqueries rather than joins so a
 * user with many memberships is still a single row — a join would multiply the
 * row out and break both the count and the pagination.
 */
export async function listUsers({
  page,
  limit,
  search
}: {
  page: number;
  limit: number;
  search?: string;
}): Promise<{ users: AdminUserRow[]; total: number }> {
  const offset = (page - 1) * limit;
  const term = search?.trim();
  const where = term ? or(ilike(schema.user.name, `%${term}%`), ilike(schema.user.email, `%${term}%`)) : undefined;

  const orgCount = sql<number>`(
    select count(*)::int from ${schema.organizationmember}
    where ${schema.organizationmember.profileId} = ${schema.user.id}
  )`;
  const courseCount = sql<number>`(
    select count(*)::int from ${schema.groupmember}
    where ${schema.groupmember.profileId} = ${schema.user.id}
  )`;

  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      image: schema.user.image,
      role: schema.user.role,
      banned: schema.user.banned,
      createdAt: schema.user.createdAt,
      orgCount,
      courseCount
    })
    .from(schema.user)
    .where(where)
    .orderBy(desc(schema.user.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.user)
    .where(where);

  return { users: rows, total };
}

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

/**
 * A single user's profile for the super-admin detail page: the same row as the
 * table plus the org memberships and each admin org's AI credit balance, so the
 * credits section has what it needs without a second round-trip.
 */
export async function getUserWithStats(userId: string): Promise<AdminUserWithStats | null> {
  const [row] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      image: schema.user.image,
      role: schema.user.role,
      banned: schema.user.banned,
      createdAt: schema.user.createdAt
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  const orgs = await db
    .select({
      orgId: schema.organization.id,
      name: schema.organization.name,
      siteName: schema.organization.siteName,
      roleId: schema.organizationmember.roleId,
      creditBalance: sql<number>`coalesce((
        select ${schema.aiCreditBalance.balance} from ${schema.aiCreditBalance}
        where ${schema.aiCreditBalance.orgId} = ${schema.organization.id}
      ), 0)::int`
    })
    .from(schema.organizationmember)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.organizationmember.organizationId))
    .where(eq(schema.organizationmember.profileId, userId));

  const [{ courseCount }] = await db
    .select({ courseCount: sql<number>`count(*)::int` })
    .from(schema.groupmember)
    .where(eq(schema.groupmember.profileId, userId));

  return {
    ...row,
    orgCount: orgs.length,
    courseCount,
    adminOrgCount: orgs.filter((o) => o.roleId === ADMIN_ROLE_ID).length,
    orgs
  };
}
