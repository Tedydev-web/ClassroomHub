import { PRODUCT_URLS } from '@cio/utils/constants';
import { z } from 'zod';

/** Replaced with the package version at build time; absent when run from source. */
declare const __MCP_VERSION__: string | undefined;

const packageVersion = typeof __MCP_VERSION__ === 'string' ? __MCP_VERSION__ : 'dev';

const ZConfig = z.object({
  CLASSROOM_API_URL: z.url().default(PRODUCT_URLS.api),
  CLASSROOM_API_KEY: z.string().min(1),
  CLASSROOMHUB_USER_AGENT: z.string().min(1).default(`classroom-mcp/${packageVersion}`)
});

export type McpServerConfig = z.infer<typeof ZConfig>;

export function getConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return ZConfig.parse(env);
}
