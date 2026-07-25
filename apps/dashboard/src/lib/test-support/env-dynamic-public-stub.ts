/**
 * Stands in for SvelteKit's `$env/dynamic/public` virtual module in unit tests.
 *
 * That module only exists inside a SvelteKit build. Logic suites that reach it
 * transitively (navigation pulls in `deployment.ts`, which reads the deployment
 * flags) need it to resolve to something; an empty bag gives every flag its
 * falsy default, which is the ordinary cloud configuration.
 *
 * A suite that needs a specific value should set `env.PUBLIC_…` itself rather
 * than have a default baked in here.
 */
export const env: Record<string, string | undefined> = {};
