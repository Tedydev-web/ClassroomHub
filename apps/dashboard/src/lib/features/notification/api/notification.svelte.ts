import { BaseApi, classroomhub } from '$lib/utils/services/api';
import type {
  GetNotificationsRequest,
  NotificationItem,
  NotificationPage,
  ReadAllNotificationsRequest,
  ReadNotificationRequest
} from '../utils/types';

class NotificationApi extends BaseApi {
  items = $state<NotificationItem[]>([]);
  unread = $state(0);
  /** False until the first fetch settles, so the panel shows a skeleton instead of flashing empty. */
  hasLoaded = $state(false);
  pagination = $state<NotificationPage['pagination']>({ page: 1, limit: 20, total: 0, totalPages: 0 });

  async getNotifications(page = 1) {
    const result = await this.execute<GetNotificationsRequest>({
      requestFn: () => classroomhub.notifications.$get({ query: { page: `${page}`, limit: '20' } }),
      logContext: 'fetching notifications',
      onSuccess: (response) => {
        this.items = response.data.items;
        this.unread = response.data.unread;
        this.pagination = response.data.pagination;
      }
    });
    this.hasLoaded = true;

    return result;
  }

  async markRead(notificationId: string) {
    return this.execute<ReadNotificationRequest>({
      requestFn: () =>
        classroomhub.notifications[':notificationId'].read.$put({
          param: { notificationId }
        }),
      logContext: 'marking notification as read',
      onSuccess: (response) => {
        this.items = this.items.map((item) => (item.id === response.data.id ? response.data : item));
        this.unread = Math.max(0, this.unread - 1);
      }
    });
  }

  async markAllRead() {
    return this.execute<ReadAllNotificationsRequest>({
      requestFn: () => classroomhub.notifications['read-all'].$put(),
      logContext: 'marking all notifications as read',
      onSuccess: () => {
        const readAt = new Date().toISOString();
        this.items = this.items.map((item) => ({ ...item, isRead: true, readAt: item.readAt ?? readAt }));
        this.unread = 0;
      }
    });
  }
}

export const notificationApi = new NotificationApi();
