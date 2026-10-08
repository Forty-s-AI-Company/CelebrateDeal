/** Fixed statuses and booleans only; never accept identity, URL or body data. */
export function formatPrivateInboxDiagnostic(input: {
  navigationStatus?: number; apiStatus?: number; privatePage: boolean; messagePersisted: boolean;
}) {
  const status = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0;
  return `PRIVATE_INBOX:N${status(input.navigationStatus)}:A${status(input.apiStatus)}:P${input.privatePage === true ? 1 : 0}:M${input.messagePersisted === true ? 1 : 0}`;
}
export function classifyPrivateInboxDiagnostic(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(?:Error: )?PRIVATE_INBOX:N(0|[1-5][0-9]{2}):A(0|[1-5][0-9]{2}):P([01]):M([01])$/u.exec(value);
  return match ? `private_inbox navigation_http=${match[1]} api_http=${match[2]} private_page=${match[3]} message_persisted=${match[4]}` : null;
}
