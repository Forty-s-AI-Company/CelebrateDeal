import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { assertVendorOwnsRelations, VendorRelationOwnershipError } from "@/lib/vendor-relations";

const vendorIds: string[] = [];

async function createVendorFixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `Tenant ${label}`,
      slug: `tenant-${label}-${suffix}`,
      email: `tenant-${label}-${suffix}@example.com`,
      passwordHash: "test",
    },
  });
  vendorIds.push(vendor.id);

  const [video, product, form, template, script, role] = await Promise.all([
    getDb().video.create({ data: { vendorId: vendor.id, title: "Video", videoUrl: "https://example.com/video.mp4" } }),
    getDb().product.create({ data: { vendorId: vendor.id, name: "Product", slug: `product-${suffix}`, priceCents: 100, inventory: 1 } }),
    getDb().registrationForm.create({ data: { vendorId: vendor.id, name: "Form", slug: `form-${suffix}`, headline: "Form", fields: [] } }),
    getDb().messageTemplate.create({ data: { vendorId: vendor.id, name: "Template", channel: "email", trigger: "registration", body: "Body" } }),
    getDb().interactionScript.create({ data: { vendorId: vendor.id, name: "Script" } }),
    getDb().interactionRole.create({ data: { vendorId: vendor.id, name: "Official", label: "官方角色", roleType: "official" } }),
  ]);

  return { vendor, video, product, form, template, script, role };
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("vendor relation ownership", () => {
  it("accepts relations owned by the current vendor", async () => {
    const fixture = await createVendorFixture("own");
    await expect(assertVendorOwnsRelations(fixture.vendor.id, {
      videoIds: [fixture.video.id],
      productIds: [fixture.product.id],
      formIds: [fixture.form.id],
      messageTemplateIds: [fixture.template.id],
      interactionScriptIds: [fixture.script.id],
      interactionRoleIds: [fixture.role.id],
    })).resolves.toBeUndefined();
  });

  it("rejects a relation belonging to another vendor without identifying it", async () => {
    const owner = await createVendorFixture("owner");
    const other = await createVendorFixture("other");
    await expect(assertVendorOwnsRelations(owner.vendor.id, {
      productIds: [owner.product.id, other.product.id],
    })).rejects.toBeInstanceOf(VendorRelationOwnershipError);
  });
});
