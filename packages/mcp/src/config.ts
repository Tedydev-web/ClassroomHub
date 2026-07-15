import { z } from 'zod';

const ZConfig = z.object({
  CLASSROOM_API_URL: z.url().default('https://classroom-api.tedydev.io.vn'),
  CLASSROOM_API_KEY: z.string().min(1),
  CLASSROOMIO_USER_AGENT: z.string().min(1).default('classroom-mcp/0.0.9')
});

export type McpServerConfig = z.infer<typeof ZConfig>;

export function getConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return ZConfig.parse(env);
}
