import { z } from "zod";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const PrivateViewerChatQuery = z.object({
  vendorId: Id, liveId: Id, cursor: z.string().min(1).max(256).optional(),
}).strict();
export const PrivateViewerChatPost = z.object({
  vendorId: Id, liveId: Id, clientMessageId: z.string().uuid(),
  conversationBinding: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  body: z.string().min(1).max(2_000).refine(value => {
    const length = Array.from(value.normalize("NFKC").trim()).length;
    return length > 0 && length <= 1_000;
  }),
}).strict();
// Browser-safe contract: contact details, submission IDs and ciphertext stay server-side.
export const PrivateChatMessage = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u), source: z.enum(["viewer", "instructor"]),
  body: z.string().min(1).max(2_000), createdAt: z.string().datetime(),
}).strict();
export const PrivateChatPage = z.object({ messages: z.array(PrivateChatMessage).max(50), nextCursor: z.string().max(256).nullable() }).strict();
export const PrivateChatResponse = PrivateChatPage.extend({ csrfToken: z.string().min(1).max(512),
  conversationBinding: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();
export const PrivateInstructorConversations = z.object({
  conversations: z.array(z.object({ submissionId: Id, displayName: z.string().min(1).max(160) }).strict()).max(50),
  nextCursor: z.string().max(256).nullable(),
}).strict();
export const PrivateInstructorConversationsResponse = PrivateInstructorConversations.extend({ csrfToken: z.string().min(1).max(512) }).strict();
export type PrivateChatMessageDto = z.infer<typeof PrivateChatMessage>;
