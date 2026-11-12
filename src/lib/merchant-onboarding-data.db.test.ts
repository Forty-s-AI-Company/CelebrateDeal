import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { findSelectedOnboardingProject, loadOnboardingChecklist } from "@/lib/merchant-onboarding-data";

const db = getDb();
const suffix = randomUUID();
const ids: { vendors: string[]; users: string[] } = { vendors: [], users: [] };
let fixture: { vendorA: string; vendorB: string; userId: string; ownProject: string; archivedProject: string; foreignProject: string };

/** Records every `model.method` the loader touches, on top of the real client. */
function tracked() {
  const calls: string[] = [];
  const client = new Proxy(db, {
    get(target, model, receiver) {
      const delegate = Reflect.get(target, model, receiver) as unknown;
      if (typeof model !== "string" || !delegate || typeof delegate !== "object") return delegate;
      return new Proxy(delegate, {
        get(inner, method) {
          const value = Reflect.get(inner, method) as unknown;
          if (typeof value !== "function" || typeof method !== "string") return value;
          return (...args: unknown[]) => {
            calls.push(`${model}.${method}`);
            return (value as (...a: unknown[]) => unknown).apply(inner, args);
          };
        },
      });
    },
  });
  return { client, calls };
}

const PROJECT_READS = ["onboardingTaskState.findMany", "salesProjectProduct.count", "registrationForm.count", "live.count", "consultationEvent.findMany"];

async function selectProject(projectId: string) {
  await db.userOnboardingPreference.upsert({
    where: { userId_vendorId: { userId: fixture.userId, vendorId: fixture.vendorA } },
    create: { userId: fixture.userId, vendorId: fixture.vendorA, selectedProjectId: projectId },
    update: { selectedProjectId: projectId },
  });
}

async function load() {
  const { client, calls } = tracked();
  const selectedProject = await findSelectedOnboardingProject(client, fixture.vendorA, fixture.userId);
  const checklist = await loadOnboardingChecklist(client, {
    vendorId: fixture.vendorA, supportEmailConfigured: true, trackingConfigured: false, cardBindingRequired: true, selectedProject,
  });
  return { selectedProject, checklist, calls };
}

beforeAll(async () => {
  const vendorA = await db.vendor.create({ data: { name: "Synthetic onboarding A", slug: `onb-a-${suffix}`, email: `onb-a-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  const vendorB = await db.vendor.create({ data: { name: "Synthetic onboarding B", slug: `onb-b-${suffix}`, email: `onb-b-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  ids.vendors.push(vendorA.id, vendorB.id);
  const user = await db.user.create({ data: { email: `onb-owner-${suffix}@example.test`, name: "Synthetic owner", passwordHash: "synthetic-only", memberships: { create: { vendorId: vendorA.id, role: "owner", status: "active" } } } });
  ids.users.push(user.id);
  const project = (vendorId: string, slug: string, status: "draft" | "archived" = "draft") => db.salesProject.create({ data: { vendorId, name: `Synthetic ${slug}`, slug: `${slug}-${suffix}`, mode: "live_course", primaryFlow: "live", status } });
  const [own, archived, foreign] = await Promise.all([project(vendorA.id, "own"), project(vendorA.id, "archived", "archived"), project(vendorB.id, "foreign")]);
  fixture = { vendorA: vendorA.id, vendorB: vendorB.id, userId: user.id, ownProject: own.id, archivedProject: archived.id, foreignProject: foreign.id };
});

afterAll(async () => {
  await db.userOnboardingPreference.deleteMany({ where: { userId: { in: ids.users } } });
  await db.vendor.deleteMany({ where: { id: { in: ids.vendors } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
});

describe("selected project in the onboarding checklist (real PostgreSQL)", () => {
  it("adds the project step for the member's own active project", async () => {
    await selectProject(fixture.ownProject);
    const { selectedProject, checklist, calls } = await load();
    expect(selectedProject?.id).toBe(fixture.ownProject);
    expect(checklist.steps.at(-1)).toMatchObject({ key: "project", title: "發布專案「Synthetic own」" });
    expect(calls).toEqual(expect.arrayContaining(PROJECT_READS));
  });

  it("cannot point a preference at another vendor's project; the list keeps no foreign project step", async () => {
    await selectProject(fixture.archivedProject);
    // The composite FK (vendorId, selectedProjectId) -> SalesProject(vendorId, id) refuses it outright.
    await expect(selectProject(fixture.foreignProject)).rejects.toMatchObject({ code: "P2003" });
    const preference = await db.userOnboardingPreference.findUniqueOrThrow({ where: { userId_vendorId: { userId: fixture.userId, vendorId: fixture.vendorA } } });
    expect(preference.selectedProjectId).toBe(fixture.archivedProject);
    const { selectedProject, checklist, calls } = await load();
    expect(selectedProject).toBeNull();
    expect(checklist.steps.map((item) => item.title).join()).not.toContain("Synthetic foreign");
    for (const read of PROJECT_READS) expect(calls).not.toContain(read);
  });

  it("ignores a preference pointing at an archived project of this vendor and reads no project data", async () => {
    await selectProject(fixture.archivedProject);
    const { selectedProject, checklist, calls } = await load();
    expect(selectedProject).toBeNull();
    expect(checklist.project).toBeNull();
    expect(checklist.steps.map((item) => item.key)).not.toContain("project");
    expect(checklist.steps.map((item) => item.title).join()).not.toContain("Synthetic archived");
    for (const read of PROJECT_READS) expect(calls).not.toContain(read);
  });
});
