export type PaymentReturnOutcome = "updated" | "pending" | "unverified" | "unknown";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function paymentReturnOutcome(value: string | string[] | undefined): PaymentReturnOutcome {
  const normalized = firstValue(value);
  return normalized === "updated" || normalized === "pending" || normalized === "unverified"
    ? normalized
    : "unknown";
}
