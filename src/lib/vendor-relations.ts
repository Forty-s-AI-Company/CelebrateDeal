import { getDb } from "@/lib/db";

export type VendorRelationRefs = {
  videoIds?: Array<string | null | undefined>;
  productIds?: Array<string | null | undefined>;
  formIds?: Array<string | null | undefined>;
  messageTemplateIds?: Array<string | null | undefined>;
  interactionScriptIds?: Array<string | null | undefined>;
  interactionRoleIds?: Array<string | null | undefined>;
};

export class VendorRelationOwnershipError extends Error {
  constructor(public readonly relation: keyof VendorRelationRefs) {
    super("Related resource is not available");
    this.name = "VendorRelationOwnershipError";
  }
}

function uniqueIds(values: Array<string | null | undefined> | undefined) {
  return [...new Set((values ?? []).map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export async function assertVendorOwnsRelations(vendorId: string, refs: VendorRelationRefs) {
  const db = getDb();
  const videoIds = uniqueIds(refs.videoIds);
  const productIds = uniqueIds(refs.productIds);
  const formIds = uniqueIds(refs.formIds);
  const messageTemplateIds = uniqueIds(refs.messageTemplateIds);
  const interactionScriptIds = uniqueIds(refs.interactionScriptIds);
  const interactionRoleIds = uniqueIds(refs.interactionRoleIds);
  const checks: Array<[keyof VendorRelationRefs, string[], () => Promise<number>]> = [
    ["videoIds", videoIds, async () => db.video.count({ where: { vendorId, id: { in: videoIds } } })],
    ["productIds", productIds, async () => db.product.count({ where: { vendorId, id: { in: productIds } } })],
    ["formIds", formIds, async () => db.registrationForm.count({ where: { vendorId, id: { in: formIds } } })],
    ["messageTemplateIds", messageTemplateIds, async () => db.messageTemplate.count({ where: { vendorId, id: { in: messageTemplateIds } } })],
    ["interactionScriptIds", interactionScriptIds, async () => db.interactionScript.count({ where: { vendorId, id: { in: interactionScriptIds } } })],
    ["interactionRoleIds", interactionRoleIds, async () => db.interactionRole.count({ where: { vendorId, id: { in: interactionRoleIds } } })],
  ];

  for (const [relation, ids, countOwned] of checks) {
    if (ids.length === 0) continue;
    const count = await countOwned();
    if (count !== ids.length) throw new VendorRelationOwnershipError(relation);
  }
}
