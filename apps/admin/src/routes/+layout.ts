// Client-only: the operator password lives in sessionStorage and every data
// call is authenticated from the browser, so there is nothing to render on the
// server and no benefit to SSR for an internal tool.
export const ssr = false;
export const prerender = false;
