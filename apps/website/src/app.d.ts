// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    interface Platform {
      env: {
        DOCS: {
          fetch(request: Request): Promise<Response>;
        };
        ASSETS: {
          fetch: typeof fetch;
        };
      };
      ctx: {
        waitUntil(promise: Promise<unknown>): void;
      };
    }
  }
}

export {};
