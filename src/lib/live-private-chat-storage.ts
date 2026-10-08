import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";

const Id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const Scope = z.object({
  vendorId: Id, liveId: Id, submissionId: Id,
  messageId: z.string().regex(/^[a-f0-9]{64}$/u),
  source: z.enum(["viewer", "instructor"]),
}).strict();
export type PrivateChatStorageScope = z.infer<typeof Scope>;

function purpose(scope: PrivateChatStorageScope) {
  const checked = Scope.parse(scope);
  return `live-private-chat-body:${JSON.stringify([
    checked.vendorId, checked.liveId, checked.submissionId, checked.messageId, checked.source,
  ])}`;
}

/** Server-owned actor and conversation scope make retries deterministic without
 * allowing two authors to claim the same client message UUID. */
export function privateChatMessageId(input: {
  vendorId: string; liveId: string; submissionId: string;
  source: "viewer" | "instructor"; actorId: string; clientMessageId: string;
}) {
  const checked = z.object({
    vendorId: Id, liveId: Id, submissionId: Id, actorId: Id,
    source: z.enum(["viewer", "instructor"]), clientMessageId: z.string().uuid(),
  }).strict().parse(input);
  return createHash("sha256").update(JSON.stringify([
    "live-private-chat-message", checked.vendorId, checked.liveId, checked.submissionId,
    checked.source, checked.actorId, checked.clientMessageId,
  ])).digest("hex");
}

export function normalizePrivateChatBody(body: string) {
  const normalized = body.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 1_000) throw new Error("invalid_private_chat_body");
  return normalized;
}

export function encryptPrivateChatBody(body: string, scope: PrivateChatStorageScope) {
  return encryptSensitiveValue(normalizePrivateChatBody(body), purpose(scope));
}

export function decryptPrivateChatBody(envelope: string, scope: PrivateChatStorageScope) {
  // Reject extra envelope fields and oversized input before the common decoder.
  if (envelope.length > 8_192 || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/u.test(envelope)) {
    throw new Error("invalid_private_chat_envelope");
  }
  return normalizePrivateChatBody(decryptSensitiveValue(envelope, purpose(scope)));
}
