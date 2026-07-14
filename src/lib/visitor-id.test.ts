import { describe, expect, it, vi } from "vitest";
import { getOrCreateVisitorId, VISITOR_ID_STORAGE_KEY } from "./visitor-id";

describe("getOrCreateVisitorId", () => {
  it("reuses an existing non-blank visitor ID", () => {
    const storage = {
      getItem: vi.fn(() => "existing-visitor-id"),
      setItem: vi.fn(),
    };
    const createRandomId = vi.fn(() => "new-visitor-id");

    const visitorId = getOrCreateVisitorId(createRandomId, () => storage);

    expect(visitorId).toBe("existing-visitor-id");
    expect(storage.getItem).toHaveBeenCalledWith(VISITOR_ID_STORAGE_KEY);
    expect(createRandomId).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("creates and persists an opaque ID when no ID exists", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const createRandomId = vi.fn(() => "new-visitor-id");

    const visitorId = getOrCreateVisitorId(createRandomId, () => storage);

    expect(visitorId).toBe("new-visitor-id");
    expect(createRandomId).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(VISITOR_ID_STORAGE_KEY, "new-visitor-id");
  });

  it("replaces a blank stored ID", () => {
    const storage = {
      getItem: vi.fn(() => "   "),
      setItem: vi.fn(),
    };

    expect(getOrCreateVisitorId(() => "new-visitor-id", () => storage)).toBe("new-visitor-id");
    expect(storage.setItem).toHaveBeenCalledWith(VISITOR_ID_STORAGE_KEY, "new-visitor-id");
  });

  it("returns a generated ID when reading storage throws", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException("Storage access blocked", "SecurityError");
      }),
      setItem: vi.fn(),
    };

    const visitorId = getOrCreateVisitorId(() => "session-visitor-id", () => storage);

    expect(visitorId).toBe("session-visitor-id");
    expect(storage.setItem).toHaveBeenCalledWith(VISITOR_ID_STORAGE_KEY, "session-visitor-id");
  });

  it("returns a generated ID when accessing or writing storage throws", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Storage access blocked", "SecurityError");
      }),
    };

    expect(getOrCreateVisitorId(() => "session-visitor-id", () => storage)).toBe("session-visitor-id");
    expect(getOrCreateVisitorId(() => "blocked-storage-id", () => {
      throw new DOMException("Storage access blocked", "SecurityError");
    })).toBe("blocked-storage-id");
  });
});
