import { describe, expect, it } from "vitest";
import { parseRegistrationMode, registrationMode } from "@/lib/registration-mode";

describe("registration mode", () => {
  it("defaults to invite when unset, blank or unknown (fail closed)", () => {
    for (const value of [undefined, null, "", "  ", "invite", "INVITE", "opened", "true", "1", "public"]) {
      expect(parseRegistrationMode(value)).toBe("invite");
    }
    expect(registrationMode({} as unknown as NodeJS.ProcessEnv)).toBe("invite");
  });

  it("opens only for an explicit open value", () => {
    expect(parseRegistrationMode("open")).toBe("open");
    expect(parseRegistrationMode(" Open ")).toBe("open");
    expect(registrationMode({ REGISTRATION_MODE: "open" } as unknown as NodeJS.ProcessEnv)).toBe("open");
  });
});
