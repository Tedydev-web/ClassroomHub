import { PRODUCT_NAME } from '@cio/utils/constants';

/**
 * The wording on a pricing card, in the language the page is written in.
 *
 * `PLANS` lives in `@cio/utils` because the dashboard bills from the same
 * definition, and the dashboard renders it in English whatever the locale. So
 * rather than translating the shared package — which would drag ten dashboard
 * locales into a billing change — the website maps each plan string to a key in
 * its own catalogue, and `plan-copy.test.ts` fails if the package ever adds a
 * string this map has not been told about.
 */
export const FEATURE_KEYS: Record<string, string> = {
  'Unlimited Courses': 'unlimited_courses',
  'Unlimited Q/A': 'unlimited_qa',
  'Unlimited Programs': 'unlimited_programs',
  '20 Students': 'students_20',
  'Advanced Course Builder (no video upload)': 'builder_no_video',
  '500K AI credits / month': 'ai_500k',
  'MCP access': 'mcp_access',
  [`${PRODUCT_NAME} branding`]: 'platform_branding',
  'Everything in Basic': 'everything_basic',
  'Unlimited Collaborators': 'unlimited_collaborators',
  '10K Students': 'students_10k',
  'Course Builder with Video Upload & Certificate': 'builder_video_certificate',
  '3M AI credits / month': 'ai_3m',
  'Custom Branding': 'custom_branding',
  'Custom Domain': 'custom_domain',
  'API with limits': 'api_limited',
  'Includes all upcoming features': 'upcoming_features',
  'Everything in Early Adopters plus:': 'everything_early_adopters',
  'Unlimited students': 'unlimited_students',
  '15M AI credits / month': 'ai_15m',
  'Unlimited API requests': 'unlimited_api',
  SSO: 'sso',
  '24/7 Support': 'support_247',
  'Custom limits, procurement, and a named contact. Talk to us.': 'enterprise_contact'
};
