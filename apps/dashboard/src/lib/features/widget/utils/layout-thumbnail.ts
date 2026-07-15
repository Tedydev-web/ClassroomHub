import type { TWidgetLayoutType } from '@cio/utils/validation/widget';

/** Served by the dashboard. */
export const WIDGET_LAYOUT_THUMBNAIL_BASE = '/assets/templates/widget-layouts';

export function widgetLayoutThumbnailSrc(layoutType: TWidgetLayoutType): string {
  return `${WIDGET_LAYOUT_THUMBNAIL_BASE}/${layoutType}.png`;
}
