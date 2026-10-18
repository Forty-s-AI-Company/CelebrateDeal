/** Stored notification links never embed a vendor slug. Slugs may contain CJK
 * characters, and percent-encoding expands each one to nine bytes, which would
 * push a stored path past the message bound and fail a domain transaction.
 * Links carry only opaque ASCII IDs; the resolver route maps them to the
 * tenant's current portal URL when the learner opens the link. The dotted
 * segment cannot collide with a merchant slug (toSlug never emits a dot). */
export const LEARNER_NOTIFICATION_LINK_PREFIX = "/portal/notify.link";

const Identifier = /^[A-Za-z0-9_-]{1,128}$/u;
function id(value: string) {
  if (!Identifier.test(value)) throw new Error("Invalid notification link identity.");
  return value;
}
const base = (vendorId: string) => `${LEARNER_NOTIFICATION_LINK_PREFIX}/${id(vendorId)}`;

export const learnerNotificationLink = {
  notifications: (vendorId: string) => `${base(vendorId)}/notifications`,
  course: (vendorId: string, courseId: string) => `${base(vendorId)}/learn/${id(courseId)}`,
  certificate: (vendorId: string, courseId: string) => `${base(vendorId)}/learn/${id(courseId)}/certificate`,
  community: (vendorId: string, courseId: string, postId: string) => {
    // "data" is the community JSON endpoint, never a navigable post.
    if (postId === "data") throw new Error("Invalid notification link identity.");
    return `${base(vendorId)}/learn/${id(courseId)}/community/${id(postId)}`;
  },
  live: (vendorId: string, liveId: string) => `${base(vendorId)}/live/${id(liveId)}`,
};

/** Build a link without throwing inside a domain transaction. An invalid
 * identity yields an empty path, which message validation then rejects so the
 * notification is skipped and reported instead of failing the caller. */
export function safeLearnerNotificationLink(build: () => string) {
  try { return build(); } catch { return ""; }
}

export type LearnerNotificationLinkTarget =
  | { vendorId: string; kind: "notifications" }
  | { vendorId: string; kind: "course"; courseId: string; suffix: "" | "/certificate" | `/community/${string}` }
  | { vendorId: string; kind: "live"; liveId: string };

/** Parse the segments after the prefix. Anything else is not a link target. */
export function parseLearnerNotificationLink(segments: readonly string[] | undefined): LearnerNotificationLinkTarget | null {
  if (!segments || segments.length < 2 || segments.length > 5 || !segments.every(value => Identifier.test(value))) return null;
  const [vendorId, kind, first, second, third] = segments;
  if (kind === "notifications" && segments.length === 2) return { vendorId, kind: "notifications" };
  if (kind === "live" && segments.length === 3) return { vendorId, kind: "live", liveId: first! };
  if (kind !== "learn" || !first) return null;
  if (segments.length === 3) return { vendorId, kind: "course", courseId: first, suffix: "" };
  if (segments.length === 4 && second === "certificate") return { vendorId, kind: "course", courseId: first, suffix: "/certificate" };
  if (segments.length === 5 && second === "community" && third !== "data") return { vendorId, kind: "course", courseId: first, suffix: `/community/${third}` };
  return null;
}
