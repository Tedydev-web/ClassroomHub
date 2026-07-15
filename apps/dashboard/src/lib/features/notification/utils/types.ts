import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type GetNotificationsRequest = (typeof classroomio.notifications)['$get'];
export type GetNotificationsSuccess = Extract<InferResponseType<GetNotificationsRequest>, { success: true }>;
export type NotificationPage = GetNotificationsSuccess['data'];
export type NotificationItem = NotificationPage['items'][number];

export type ReadNotificationRequest = (typeof classroomio.notifications)[':notificationId']['read']['$put'];
export type ReadAllNotificationsRequest = (typeof classroomio.notifications)['read-all']['$put'];
