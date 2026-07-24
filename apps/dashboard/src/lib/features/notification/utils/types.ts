import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type GetNotificationsRequest = (typeof classroomhub.notifications)['$get'];
export type GetNotificationsSuccess = Extract<InferResponseType<GetNotificationsRequest>, { success: true }>;
export type NotificationPage = GetNotificationsSuccess['data'];
export type NotificationItem = NotificationPage['items'][number];

export type ReadNotificationRequest = (typeof classroomhub.notifications)[':notificationId']['read']['$put'];
export type ReadAllNotificationsRequest = (typeof classroomhub.notifications)['read-all']['$put'];
