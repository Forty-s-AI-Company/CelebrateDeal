import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  s3Client: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(options: unknown) {
      mocks.s3Client(options);
      return { send: mocks.send };
    }
  },
  PutObjectCommand: class {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  },
  HeadObjectCommand: class {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

import {
  MAX_IMAGE_UPLOAD_BYTES,
  createImageObjectKey,
  createImagePutPresignedUrl,
  getR2ImageConfig,
  headImageObject,
  isSupportedImageUpload,
  publicUrlForObject,
} from "./r2-images";

const runtimeConfig = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-123",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "fixture-access-key",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "fixture-secret-key",
  CLOUDFLARE_R2_BUCKET: "media-assets",
  CLOUDFLARE_R2_PUBLIC_BASE_URL: "https://assets.example.test/media",
};

describe("R2 image uploads", () => {
  it("fails closed for incomplete or unsafe runtime configuration", () => {
    expect(getR2ImageConfig({ ...runtimeConfig, CLOUDFLARE_R2_SECRET_ACCESS_KEY: "" })).toBeNull();
    expect(getR2ImageConfig({ ...runtimeConfig, CLOUDFLARE_R2_PUBLIC_BASE_URL: "javascript:alert(1)" })).toBeNull();
    expect(getR2ImageConfig({ ...runtimeConfig, CLOUDFLARE_R2_PUBLIC_BASE_URL: "http://assets.example.test" })).toBeNull();
  });

  it("accepts only the supported image MIME types and 1..15 MiB sizes", () => {
    expect(isSupportedImageUpload("image/avif", 1)).toBe(true);
    expect(isSupportedImageUpload("image/svg+xml", 100)).toBe(false);
    expect(isSupportedImageUpload("image/png", 0)).toBe(false);
    expect(isSupportedImageUpload("image/png", MAX_IMAGE_UPLOAD_BYTES + 1)).toBe(false);
  });

  it("creates a server-only object key without a tenant or traversal segment", () => {
    const key = createImageObjectKey("image/jpeg");

    expect(key).toMatch(/^images\/[0-9a-f-]{36}\.jpg$/);
    expect(key).not.toContain("vendor");
    expect(key).not.toContain("..");
  });

  it("signs an exact Content-Type and never exposes configuration values", async () => {
    const config = getR2ImageConfig(runtimeConfig)!;
    mocks.getSignedUrl.mockResolvedValue("https://r2.example.test/presigned");

    const result = await createImagePutPresignedUrl({
      config,
      objectKey: "images/object.png",
      mimeType: "image/png",
    });

    expect(result).toEqual({ uploadUrl: "https://r2.example.test/presigned", expiresIn: 600 });
    expect(mocks.getSignedUrl.mock.calls[0]?.[1]).toMatchObject({
      input: { Bucket: "media-assets", Key: "images/object.png", ContentType: "image/png" },
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret-key");
    expect(publicUrlForObject(config, "images/object.png")).toBe("https://assets.example.test/media/images/object.png");
  });

  it("returns only HEAD metadata needed for exact completion checks", async () => {
    const config = getR2ImageConfig(runtimeConfig)!;
    mocks.send.mockResolvedValue({ ContentLength: 123, ContentType: "image/webp", ETag: "ignored" });

    await expect(headImageObject(config, "images/object.webp")).resolves.toEqual({
      contentLength: 123,
      contentType: "image/webp",
    });
  });
});
