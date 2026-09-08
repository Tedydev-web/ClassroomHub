import { PRODUCT_URLS } from '@cio/utils/constants';
import { z } from 'zod';

const ZConfig = z.object({
  CLASSROOM_API_URL: z.url().default(PRODUCT_URLS.api),
  CLASSROOM_API_KEY: z.string().min(1),
  CLASSROOMHUB_USER_AGENT: z.string().min(1).default('classroom-mcp/0.0.9')
});

export type McpServerConfig = z.infer<typeof ZConfig>;

export function getConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return ZConfig.parse(env);
}
