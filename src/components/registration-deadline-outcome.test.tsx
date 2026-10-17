import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(path); }));
vi.mock("next/navigation", () => ({ redirect }));
import { registrationDeadlineOutcome } from "./registration-deadline-outcome";
afterEach(() => vi.clearAllMocks());
const withRetry = vi.fn((child) => child);
it.each([undefined,"500",["429"]])("preserves redirect for unrecognised query %s", (value) => {
 expect(() => registrationDeadlineOutcome({decision:{status:"redirect",path:"thanks/#"},query:{registrationRetry:value as string},slug:"sample/?",withRetry})).toThrow('/lp/sample%2F%3F/thanks%2F%23');
 expect(withRetry).not.toHaveBeenCalled();
});
it.each(["429","unavailable"])("renders readonly outcome for recognised query %s", (registrationRetry) => {
 const result=registrationDeadlineOutcome({decision:{status:"redirect",path:"thanks/#"},query:{registrationRetry},slug:"sample/?",withRetry});
 expect(renderToStaticMarkup(result)).toContain('href="/lp/sample%2F%3F/thanks%2F%23"');expect(redirect).not.toHaveBeenCalled();expect(withRetry).toHaveBeenCalledOnce();
});
it("leaves closed and open normal views unchanged", () => {
 expect(renderToStaticMarkup(registrationDeadlineOutcome({decision:{status:"closed"},query:{},slug:"sample",withRetry}))).toContain("此活動已截止");
 expect(registrationDeadlineOutcome({decision:{status:"render",requestedStepId:"one",renderedStepId:"one",experiment:null},query:{registrationRetry:"429"},slug:"sample",withRetry})).toBeNull();
 expect(withRetry).not.toHaveBeenCalled();expect(redirect).not.toHaveBeenCalled();
});
