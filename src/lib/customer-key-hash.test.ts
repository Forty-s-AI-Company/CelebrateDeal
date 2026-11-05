import { afterEach, describe, expect, it, vi } from "vitest";
import { automationCustomerKeyHash } from "@/lib/customer-key-hash";
import { automationCustomerKeyHash as reExported } from "@/lib/automation-workflow";

// Golden vectors: stored order keys, portal sign-in tokens, consultation and
// CRM rows all depend on this exact derivation. A change here orphans every
// stored key, so it needs a deliberate migration plan, not a test update.
const ROOT_SECRET = "golden-vector-synthetic-root-secret-0123456789";

afterEach(() => vi.unstubAllEnvs());

describe("automationCustomerKeyHash golden vectors", () => {
  it("keeps the HMAC derivation and e-mail normalization byte-stable", () => {
    vi.stubEnv("CSRF_SECRET", ROOT_SECRET);
    expect(automationCustomerKeyHash("vendor-golden-1", " Learner@Example.TEST ")).toBe("HqzZfzM5sS2O1trseTVAlwhloIkBmHB1VAsEwF9_8_A");
    expect(automationCustomerKeyHash("vendor-golden-1", "learner@example.test")).toBe("HqzZfzM5sS2O1trseTVAlwhloIkBmHB1VAsEwF9_8_A");
    expect(automationCustomerKeyHash("vendor-golden-2", "learner@example.test")).toBe("74Tn1hSl_OZdETauqFYgvDGJFI6fZlKWwY6EROv-b9M");
  });

  it("is the same function the automation module re-exports", () => {
    expect(reExported).toBe(automationCustomerKeyHash);
  });

  it("rejects a missing tenant or a malformed address", () => {
    vi.stubEnv("CSRF_SECRET", ROOT_SECRET);
    expect(() => automationCustomerKeyHash("", "learner@example.test")).toThrow("Invalid automation customer identity.");
    for (const email of ["learner", "learner@example", "lear ner@example.test", "a@b@example.test"]) {
      expect(() => automationCustomerKeyHash("vendor-golden-1", email)).toThrow("Invalid automation customer identity.");
    }
  });
});
