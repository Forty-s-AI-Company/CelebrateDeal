import { isIP } from "node:net";
import type { CommerceFulfillmentType } from "@/lib/commerce-order-domain";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const CONFIG_PURPOSE = "product-delivery-config";
const SNAPSHOT_PURPOSE = "commerce-order-item-delivery";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];
const MAX_TITLE_LENGTH = 120;
const MAX_DESTINATION_LENGTH = 2_048;
const MAX_INSTRUCTIONS_LENGTH = 4_000;

export type ProductDeliveryKind = "digital_link" | "course_portal" | "service_instructions";

export type ProductDeliveryDraftInput = {
  fulfillmentType: CommerceFulfillmentType;
  isActive: boolean;
  title?: string | null;
  destinationUrl?: string | null;
  instructions?: string | null;
  hostConfirmed: boolean;
};

export type ValidatedProductDelivery = {
  fulfillmentType: Exclude<CommerceFulfillmentType, "physical">;
  deliveryKind: ProductDeliveryKind;
  status: "draft" | "active";
  title: string;
  destinationUrl: string | null;
  destinationHostname: string | null;
  destinationPathPrefix: string | null;
  instructions: string | null;
};

export type ProductDeliveryConfigBinding = {
  vendorId: string;
  productId: string;
  configId: string;
  revision: number;
};

export type OrderItemDeliveryBinding = {
  vendorId: string;
  orderId: string;
  orderItemId: string;
  snapshotId: string;
};

export class ProductDeliveryValidationError extends Error {
  constructor(message = "Product delivery configuration is invalid.") {
    super(message);
    this.name = "ProductDeliveryValidationError";
  }
}

function safeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maxLength || CONTROL_CHARACTERS.test(normalized)) {
    throw new ProductDeliveryValidationError();
  }
  return normalized;
}

function safeBindingValue(value: string) {
  if (!value || value !== value.trim() || value.length > 191 || CONTROL_CHARACTERS.test(value)) {
    throw new ProductDeliveryValidationError("Product delivery binding is invalid.");
  }
  return value;
}

function configPurpose(binding: ProductDeliveryConfigBinding, field: "destination" | "instructions") {
  safeBindingValue(binding.vendorId);
  safeBindingValue(binding.productId);
  safeBindingValue(binding.configId);
  if (!Number.isSafeInteger(binding.revision) || binding.revision < 1) {
    throw new ProductDeliveryValidationError("Product delivery revision is invalid.");
  }
  return `${CONFIG_PURPOSE}:${binding.vendorId}:${binding.productId}:${binding.configId}:${binding.revision}:${field}`;
}

function snapshotPurpose(binding: OrderItemDeliveryBinding, field: "destination" | "instructions") {
  safeBindingValue(binding.vendorId);
  safeBindingValue(binding.orderId);
  safeBindingValue(binding.orderItemId);
  safeBindingValue(binding.snapshotId);
  return `${SNAPSHOT_PURPOSE}:${binding.vendorId}:${binding.orderId}:${binding.orderItemId}:${binding.snapshotId}:${field}`;
}

export function deliveryKindForFulfillment(
  fulfillmentType: Exclude<CommerceFulfillmentType, "physical">,
): ProductDeliveryKind {
  if (fulfillmentType === "digital") return "digital_link";
  if (fulfillmentType === "course") return "course_portal";
  return "service_instructions";
}

export function parsePublicHttpsDeliveryUrl(value: string) {
  const candidate = safeText(value, MAX_DESTINATION_LENGTH);
  if (!candidate) throw new ProductDeliveryValidationError("Delivery URL is required.");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProductDeliveryValidationError("Delivery URL is invalid.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || url.search
    || url.hash
    || !hostname.includes(".")
    || isIP(hostname) !== 0
    || hostname === "localhost"
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new ProductDeliveryValidationError("Delivery URL must be a confirmed public HTTPS URL without credentials, query, or fragment.");
  }

  url.hostname = hostname;
  return {
    url: url.toString(),
    hostname,
    pathPrefix: url.pathname || "/",
  };
}

export function validateProductDeliveryDraft(
  input: ProductDeliveryDraftInput,
): ValidatedProductDelivery | null {
  if (input.fulfillmentType === "physical") return null;

  const title = safeText(input.title, MAX_TITLE_LENGTH);
  const destinationRaw = safeText(input.destinationUrl, MAX_DESTINATION_LENGTH);
  const instructions = safeText(input.instructions, MAX_INSTRUCTIONS_LENGTH);
  const hasAnyDeliveryInput = Boolean(title || destinationRaw || instructions);

  if (!input.isActive && !hasAnyDeliveryInput) return null;
  if (destinationRaw && !input.hostConfirmed) {
    throw new ProductDeliveryValidationError("Delivery host confirmation is required.");
  }

  const destination = destinationRaw ? parsePublicHttpsDeliveryUrl(destinationRaw) : null;
  if (input.isActive) {
    if (!title) throw new ProductDeliveryValidationError("Delivery title is required before publishing.");
    if ((input.fulfillmentType === "digital" || input.fulfillmentType === "course") && !destination) {
      throw new ProductDeliveryValidationError("Digital and course products require a delivery URL before publishing.");
    }
    if (input.fulfillmentType === "service" && !instructions) {
      throw new ProductDeliveryValidationError("Service products require buyer instructions before publishing.");
    }
  }

  return {
    fulfillmentType: input.fulfillmentType,
    deliveryKind: deliveryKindForFulfillment(input.fulfillmentType),
    status: input.isActive ? "active" : "draft",
    title: title || (input.fulfillmentType === "service" ? "服務交付說明" : input.fulfillmentType === "course" ? "課程內容入口" : "數位內容"),
    destinationUrl: destination?.url ?? null,
    destinationHostname: destination?.hostname ?? null,
    destinationPathPrefix: destination?.pathPrefix ?? null,
    instructions: instructions || null,
  };
}

export function protectProductDeliveryConfig(
  delivery: ValidatedProductDelivery,
  binding: ProductDeliveryConfigBinding,
) {
  return {
    destinationEncryptedEnvelope: delivery.destinationUrl
      ? encryptSensitiveValue(delivery.destinationUrl, configPurpose(binding, "destination"))
      : null,
    destinationMaskedSummary: delivery.destinationHostname
      ? `安全 HTTPS 入口 · ${delivery.destinationHostname}`
      : null,
    instructionsEncryptedEnvelope: delivery.instructions
      ? encryptSensitiveValue(delivery.instructions, configPurpose(binding, "instructions"))
      : null,
    instructionsMaskedSummary: delivery.instructions
      ? `已設定 ${delivery.instructions.length} 字交付說明`
      : null,
  };
}

export function revealProductDeliveryConfig(
  encrypted: {
    destinationEncryptedEnvelope: string | null;
    instructionsEncryptedEnvelope: string | null;
  },
  binding: ProductDeliveryConfigBinding,
) {
  return {
    destinationUrl: encrypted.destinationEncryptedEnvelope
      ? decryptSensitiveValue(encrypted.destinationEncryptedEnvelope, configPurpose(binding, "destination"))
      : null,
    instructions: encrypted.instructionsEncryptedEnvelope
      ? decryptSensitiveValue(encrypted.instructionsEncryptedEnvelope, configPurpose(binding, "instructions"))
      : null,
  };
}

export function protectOrderItemDeliverySnapshot(
  delivery: { destinationUrl: string | null; instructions: string | null },
  binding: OrderItemDeliveryBinding,
) {
  return {
    destinationEncryptedEnvelope: delivery.destinationUrl
      ? encryptSensitiveValue(delivery.destinationUrl, snapshotPurpose(binding, "destination"))
      : null,
    instructionsEncryptedEnvelope: delivery.instructions
      ? encryptSensitiveValue(delivery.instructions, snapshotPurpose(binding, "instructions"))
      : null,
  };
}

export function revealOrderItemDeliverySnapshot(
  encrypted: {
    destinationEncryptedEnvelope: string | null;
    instructionsEncryptedEnvelope: string | null;
  },
  binding: OrderItemDeliveryBinding,
) {
  return {
    destinationUrl: encrypted.destinationEncryptedEnvelope
      ? decryptSensitiveValue(encrypted.destinationEncryptedEnvelope, snapshotPurpose(binding, "destination"))
      : null,
    instructions: encrypted.instructionsEncryptedEnvelope
      ? decryptSensitiveValue(encrypted.instructionsEncryptedEnvelope, snapshotPurpose(binding, "instructions"))
      : null,
  };
}
