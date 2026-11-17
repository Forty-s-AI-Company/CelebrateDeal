/**
 * How far in the future a learner sign-in link's or portal session's
 * `issuedAt` may be before it is refused. The access route writes the
 * session cookie and the browser's very next request (the 303 target) reads
 * it, often on another server instance, and the sign-in e-mail is dispatched
 * right after the link is created; a wall clock that is a fraction of a
 * second behind, or that time synchronisation has just stepped back, used to
 * send a learner who had opened a valid link back to the sign-in page. Same
 * bound as every other server-issued timestamp (`server-clock-skew.ts`).
 *
 * Expiry is never extended: only the "issued in the future" check is
 * relaxed. `issuedAt` and `expiresAt` stay inside the HMAC- or
 * AEAD-protected payload (and the server-written row), so no client can
 * choose them, and a link is still consumed exactly once.
 */
import { SERVER_CLOCK_SKEW_SECONDS } from "@/lib/server-clock-skew";

export const STUDENT_PORTAL_CLOCK_SKEW_SECONDS = SERVER_CLOCK_SKEW_SECONDS;
