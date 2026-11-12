import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOnboardingChecklist, ONBOARDING_READINESS_BATCH_SIZE, type OnboardingChecklistInput } from "@/lib/merchant-onboarding-data";

const VALID_FIELDS = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];
const INVALID_FIELDS = [{ key: "nickname", label: "暱稱", type: "text", required: false }];

function rows<T>(count: number, start: number, make: (id: string) => T) {
  return Array.from({ length: count }, (_, index) => make(`row-${String(start + index).padStart(4, "0")}`));
}

/** Serves `all` in id order, honouring the loader's `id > afterId` + `take`. */
function paged<T extends { id: string }>(all: T[]) {
  return vi.fn(async (args: { where: { id?: { gt: string } }; take: number }) => {
    const after = args.where.id?.gt;
    return all.filter((row) => !after || row.id > after).slice(0, args.take);
  });
}

function db(overrides: { forms?: ReturnType<typeof paged>; templates?: ReturnType<typeof paged>; lives?: ReturnType<typeof paged> } = {}) {
  return {
    paymentMethodReference: { count: vi.fn().mockResolvedValue(1) },
    product: { count: vi.fn().mockResolvedValue(1) },
    registrationForm: { findMany: overrides.forms ?? paged([]) },
    interactionRole: { count: vi.fn().mockResolvedValue(0) },
    interactionScript: { count: vi.fn().mockResolvedValue(0) },
    messageTemplate: { findMany: overrides.templates ?? paged([]) },
    video: { count: vi.fn().mockResolvedValue(0) },
    live: { findMany: overrides.lives ?? paged([]) },
  };
}

const input: OnboardingChecklistInput = { vendorId: "vendor-batch", supportEmailConfigured: true, trackingConfigured: false, cardBindingRequired: true, selectedProject: null };

function journey(checklist: Awaited<ReturnType<typeof loadOnboardingChecklist>>) {
  return Object.fromEntries(checklist.steps.find((item) => item.key === "journey")!.requirements.map((item) => [item.label, item.done]));
}

beforeEach(() => vi.clearAllMocks());

describe("readiness reads stop at the first usable row", () => {
  it("finds a valid form behind a full batch of invalid ones", async () => {
    const forms = paged([
      ...rows(ONBOARDING_READINESS_BATCH_SIZE, 0, (id) => ({ id, fields: INVALID_FIELDS })),
      ...rows(1, ONBOARDING_READINESS_BATCH_SIZE, (id) => ({ id, fields: VALID_FIELDS })),
    ]);
    const checklist = await loadOnboardingChecklist(db({ forms }) as never, input);
    expect(journey(checklist)["啟用報名表單"]).toBe(true);
    expect(forms).toHaveBeenCalledTimes(2);
    expect(forms.mock.calls[1]![0]).toMatchObject({ where: { vendorId: "vendor-batch", isActive: true, id: { gt: "row-0049" } }, orderBy: { id: "asc" }, take: ONBOARDING_READINESS_BATCH_SIZE });
  });

  it("stops after the first batch that has a usable row", async () => {
    const templates = paged(rows(ONBOARDING_READINESS_BATCH_SIZE * 3, 0, (id) => ({ id, subject: "報名成功", body: "內容" })));
    const checklist = await loadOnboardingChecklist(db({ templates }) as never, input);
    expect(journey(checklist)["啟用報名確認 Email"]).toBe(true);
    expect(templates).toHaveBeenCalledOnce();
  });

  it("reads every batch and reports none when no row is usable", async () => {
    const forms = paged(rows(ONBOARDING_READINESS_BATCH_SIZE * 2 + 3, 0, (id) => ({ id, fields: INVALID_FIELDS })));
    const templates = paged(rows(ONBOARDING_READINESS_BATCH_SIZE, 0, (id) => ({ id, subject: "", body: "" })));
    const checklist = await loadOnboardingChecklist(db({ forms, templates }) as never, input);
    expect(journey(checklist)).toEqual({ "啟用報名表單": false, "啟用報名確認 Email": false });
    expect(forms).toHaveBeenCalledTimes(3);
    // A full last batch needs one more (empty) read to know it was the last.
    expect(templates).toHaveBeenCalledTimes(2);
  });

  it("does not query payment records while card binding is closed", async () => {
    const client = db();
    const checklist = await loadOnboardingChecklist(client as never, { ...input, cardBindingRequired: false });
    expect(client.paymentMethodReference.count).not.toHaveBeenCalled();
    expect(checklist.steps.find((item) => item.key === "payment")).toMatchObject({ notApplicable: "目前不需要" });
  });
});
