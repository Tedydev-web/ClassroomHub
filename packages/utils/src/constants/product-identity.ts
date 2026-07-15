export const PRODUCT_NAME = 'Classroom';
export const OPERATOR_EMAIL = 'hieudat2310.bh@gmail.com';
export const PRODUCT_ROOT_DOMAIN = 'classroom.tedydev.io.vn';

export const PRODUCT_HOSTS = {
  marketing: PRODUCT_ROOT_DOMAIN,
  dashboard: `app.${PRODUCT_ROOT_DOMAIN}`,
  api: `api.${PRODUCT_ROOT_DOMAIN}`,
  play: `play.${PRODUCT_ROOT_DOMAIN}`,
  embed: `embed.${PRODUCT_ROOT_DOMAIN}`,
  assets: `assets.${PRODUCT_ROOT_DOMAIN}`
} as const;
