import { classroomhub, type InferResponseType } from '$lib/utils/services/api';
import type {
  TCreateWidget,
  TListWidgetsQuery,
  TUpdateWidget,
  TWidgetConfig,
  TWidgetDetail,
  TWidgetPayload
} from '@cio/utils/validation/widget';

export type GetWidgetsRequest = (typeof classroomhub.organization)['widgets']['$get'];
export type GetArchivedWidgetsRequest = (typeof classroomhub.organization)['widgets']['archived']['$get'];
export type GetWidgetDetailRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['$get'];
export type CreateWidgetRequest = (typeof classroomhub.organization)['widgets']['$post'];
export type UpdateWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['$put'];
export type PublishWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['publish']['$post'];
export type RollbackWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['rollback']['$post'];
export type ArchiveWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['archive']['$post'];
export type RestoreWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['restore']['$post'];
export type DeleteWidgetRequest = (typeof classroomhub.organization)['widgets'][':widgetId']['$delete'];

export type GetWidgetsSuccess = Extract<InferResponseType<GetWidgetsRequest>, { success: true }>;
export type WidgetListItem = GetWidgetsSuccess['data'][number];
export type WidgetListPagination = GetWidgetsSuccess['pagination'];

export type GetArchivedWidgetsSuccess = Extract<InferResponseType<GetArchivedWidgetsRequest>, { success: true }>;
export type ArchivedWidgetListPagination = GetArchivedWidgetsSuccess['pagination'];
export type RestoreWidgetSuccess = Extract<InferResponseType<RestoreWidgetRequest>, { success: true }>;

export type GetWidgetDetailSuccess = Extract<InferResponseType<GetWidgetDetailRequest>, { success: true }>;
export type WidgetDetailResponse = GetWidgetDetailSuccess['data'];
export type WidgetDetail = TWidgetDetail & WidgetDetailResponse;

export type PublishWidgetSuccess = Extract<InferResponseType<PublishWidgetRequest>, { success: true }>;
export type RollbackWidgetSuccess = Extract<InferResponseType<RollbackWidgetRequest>, { success: true }>;

export type WidgetConfig = TWidgetConfig;
export type WidgetPayload = TWidgetPayload;
export type CreateWidgetInput = TCreateWidget;
export type UpdateWidgetInput = TUpdateWidget;
export type ListWidgetsQuery = TListWidgetsQuery;
