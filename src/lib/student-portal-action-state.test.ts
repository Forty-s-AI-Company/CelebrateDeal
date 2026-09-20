import { describe, expect, it } from "vitest";
import {
  STUDENT_PORTAL_INITIAL_STATE,
  type StudentPortalActionState,
} from "./student-portal-action-state";

describe("student portal action state", () => {
  it("starts idle with an empty message", () => {
    expect(STUDENT_PORTAL_INITIAL_STATE).toEqual({ status: "idle", message: "" });
  });

  it("supports every action status and optional mock link", () => {
    const states: StudentPortalActionState[] = [
      { status: "idle", message: "" },
      { status: "sent", message: "sent" },
      { status: "invalid", message: "invalid" },
      { status: "rate_limited", message: "slow down", mockLink: "/mock" },
    ];
    expect(states.map((state) => state.status)).toEqual([
      "idle",
      "sent",
      "invalid",
      "rate_limited",
    ]);
    expect(states.at(-1)?.mockLink).toBe("/mock");
  });
});
