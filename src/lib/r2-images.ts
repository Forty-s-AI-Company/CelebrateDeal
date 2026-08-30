import { randomUUID } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const IMAGE_UPLOAD_EXPIRES_IN_SECONDS = 10 * 60;
export const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

type ImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export type R2ImageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

type R2RuntimeEnvironment = {
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_R2_PUBLIC_BASE_URL?: string;
};

export type R2ObjectHead = {
  contentLength: number | undefined;
  contentType: string | undefined;
};

const extensionForMimeType: Record<ImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function validAccountId(value: string) {
  return /^[a-zA-Z0-9-]{1,128}$/.test(value);
}

function validBucket(value: string) {
  return /^[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]$|^[a-z0-9]$/.test(value);
}

function validPublicBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

/** Reads only R2 runtime configuration. Callers must not log this object. */
export function getR2ImageConfig(runtimeEnv: R2RuntimeEnvironment = process.env as R2RuntimeEnvironment): R2ImageConfig | null {
  const accountId = runtimeEnv.CLOUDFLARE_R2_ACCOUNT_ID?.trim();
  const accessKeyId = runtimeEnv.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = runtimeEnv.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = runtimeEnv.CLOUDFLARE_R2_BUCKET?.trim();
  const publicBaseUrl = runtimeEnv.CLOUDFLARE_R2_PUBLIC_BASE_URL?.trim();

  if (
    !accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl
    || !validAccountId(accountId) || !validBucket(bucket) || !validPublicBaseUrl(publicBaseUrl)
  ) {
    return null;
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function isSupportedImageUpload(mimeType: string, sizeBytes: number): mimeType is ImageMimeType {
  return ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as ImageMimeType)
    && Number.isInteger(sizeBytes)
    && sizeBytes >= 1
    && sizeBytes <= MAX_IMAGE_UPLOAD_BYTES;
}

/** This key deliberately contains no vendor or client-controlled path segment. */
export function createImageObjectKey(mimeType: ImageMimeType) {
  return `images/${randomUUID()}.${extensionForMimeType[mimeType]}`;
}

export function publicUrlForObject(config: R2ImageConfig, objectKey: string) {
  const baseUrl = config.publicBaseUrl.endsWith("/") ? config.publicBaseUrl : `${config.publicBaseUrl}/`;
  return new URL(objectKey, baseUrl).toString();
}

function createR2Client(config: R2ImageConfig) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function createImagePutPresignedUrl(input: {
  config: R2ImageConfig;
  objectKey: string;
  mimeType: ImageMimeType;
}) {
  const command = new PutObjectCommand({
    Bucket: input.config.bucket,
    Key: input.objectKey,
    ContentType: input.mimeType,
  });
  const uploadUrl = await getSignedUrl(createR2Client(input.config), command, {
    expiresIn: IMAGE_UPLOAD_EXPIRES_IN_SECONDS,
  });
  return { uploadUrl, expiresIn: IMAGE_UPLOAD_EXPIRES_IN_SECONDS };
}

export async function headImageObject(config: R2ImageConfig, objectKey: string): Promise<R2ObjectHead> {
  const response = await createR2Client(config).send(new HeadObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
  }));
  return {
    contentLength: response.ContentLength,
    contentType: response.ContentType,
  };
}
