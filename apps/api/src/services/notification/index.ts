import { getNotifications, markAllNotificationsRead, markNotificationRead } from '@cio/db/queries/notifications';
import { AppError, ErrorCodes } from '@api/utils/errors';

export async function listNotifications(profileId: string, organizationId: string, page: number, limit: number) {
  return getNotifications(profileId, organizationId, page, limit);
}

export async function readNotification(profileId: string, organizationId: string, notificationId: string) {
  const notification = await markNotificationRead(profileId, organizationId, notificationId);

  if (!notification) {
    throw new AppError('Notification not found', ErrorCodes.NOT_FOUND, 404);
  }

  return notification;
}

export async function readAllNotifications(profileId: string, organizationId: string) {
  const updatedNotifications = await markAllNotificationsRead(profileId, organizationId);

  return { updated: updatedNotifications.length };
}
