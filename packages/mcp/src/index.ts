import { ClassroomHubApiClient, ClassroomHubApiError } from './api-client';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig } from './config';
import { registerCourseDraftTools } from './tools/course-drafts';

async function main() {
  const config = getConfig();
  const apiClient = new ClassroomHubApiClient(config);
  const server = new McpServer({
    name: 'classroomhub-course-authoring',
    version: '0.0.1'
  });

  registerCourseDraftTools(server, apiClient);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stdin.on('close', () => {
    void server.close();
  });
}

main().catch((error: unknown) => {
  if (error instanceof ClassroomHubApiError) {
    console.error(
      JSON.stringify({
        error: error.message,
        status: error.status,
        code: error.code,
        field: error.field
      })
    );
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
