import { z } from "zod";

/**
 * Zod for client components (F-156). The CSP has no 'unsafe-eval'; without
 * `jitless`, zod probes `new Function("")` to compile object parsers and the
 * browser reports a CSP violation on every page that validates input.
 * Interpreted parsing gives the same results.
 *
 * Client components import `z` from here, never from "zod" directly
 * (enforced by `zod-client.test.ts`), so zod stays out of the shared startup
 * bundle and is configured before any parse.
 */
z.config({ jitless: true });

export { z };
