import * as schema from '@db/schema';

import type { TNewNotification } from '@db/types';
import { and, count, db, desc, eq } from '@db/drizzle';

export async function createNotification(data: TNewNotification) {
  try {
    const [createdNotification] = await db.insert(schema.notification).values(data).returning();

    return createdNotification;
  } catch (error) {
    console.error('createNotification error:', error);
    throw new Error('Failed to create notification');
  }
}

export async function createNotifications(data: TNewNotification[]) {
  if (data.length === 0) {
    return [];
  }

  try {
    return await db.insert(schema.notification).values(data).returning();
  } catch (error) {
    console.error('createNotifications error:', error);
    throw new Error('Failed to create notifications');
  }
}

export async function getNotifications(profileId: string, organizationId: string, page: number, limit: number) {
  try {
    const filter = and(
      eq(schema.notification.profileId, profileId),
      eq(schema.notification.organizationId, organizationId)
    );
    const offset = (page - 1) * limit;
    const notificationItemsPromise = db
      .select()
      .from(schema.notification)
      .where(filter)
      .orderBy(desc(schema.notification.createdAt))
      .limit(limit)
      .offset(offset);
    const totalPromise = db.select({ value: count() }).from(schema.notification).where(filter);
    const unreadPromise = db
      .select({ value: count() })
      .from(schema.notification)
      .where(and(filter, eq(schema.notification.isRead, false)));
    const [items, totalRows, unreadRows] = await Promise.all([notificationItemsPromise, totalPromise, unreadPromise]);
    const total = totalRows[0]?.value ?? 0;
    const unread = unreadRows[0]?.value ?? 0;

    return {
      items,
      unread,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('getNotifications error:', error);
    throw new Error('Failed to get notifications');
  }
}

export async function markNotificationRead(profileId: string, organizationId: string, notificationId: string) {
  try {
    const [updatedNotification] = await db
      .update(schema.notification)
      .set({ isRead: true, readAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.notification.id, notificationId),
          eq(schema.notification.profileId, profileId),
          eq(schema.notification.organizationId, organizationId)
        )
      )
      .returning();

    return updatedNotification ?? null;
  } catch (error) {
    console.error('markNotificationRead error:', error);
    throw new Error('Failed to mark notification as read');
  }
}

export async function markAllNotificationsRead(profileId: string, organizationId: string) {
  try {
    return await db
      .update(schema.notification)
      .set({ isRead: true, readAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.notification.profileId, profileId),
          eq(schema.notification.organizationId, organizationId),
          eq(schema.notification.isRead, false)
        )
      )
      .returning({ id: schema.notification.id });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error);
    throw new Error('Failed to mark notifications as read');
  }
}
