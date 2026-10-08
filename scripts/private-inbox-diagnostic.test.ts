import { expect, it } from "vitest";
import { classifyPrivateInboxDiagnostic, formatPrivateInboxDiagnostic } from "./private-inbox-diagnostic";
it("distinguishes navigation, authorized API and persisted message without identity data", () => {
  const value = formatPrivateInboxDiagnostic({ navigationStatus: 200, apiStatus: 403, privatePage: true, messagePersisted: true });
  expect(value).toBe("PRIVATE_INBOX:N200:A403:P1:M1");
  expect(classifyPrivateInboxDiagnostic(value)).toBe("private_inbox navigation_http=200 api_http=403 private_page=1 message_persisted=1");
});
it("normalizes unknown and invalid statuses", () => {
  expect(formatPrivateInboxDiagnostic({ navigationStatus: NaN, apiStatus: 999, privatePage: false, messagePersisted: false })).toBe("PRIVATE_INBOX:N0:A0:P0:M0");
});
it("rejects arbitrary text, values and annotation injection", () => {
  for (const value of [null, "PRIVATE_INBOX:N600:A200:P1:M1", "PRIVATE_INBOX:N200:A200:P2:M1", "PRIVATE_INBOX:N200:A200:P1:M1\n::error::secret", "secret PRIVATE_INBOX:N200:A200:P1:M1"]) {
    expect(classifyPrivateInboxDiagnostic(value)).toBeNull();
  }
});
