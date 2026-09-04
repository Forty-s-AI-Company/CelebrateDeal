const MAX_EMPTY_BODY_CHUNKS = 4;

/**
 * Distinguishes a genuinely empty request from a proxy-provided zero-byte
 * stream. Unknown lengths, non-empty chunks and stream failures fail closed.
 */
export async function requestHasNonEmptyBody(request: Request) {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) return true;
    if (parsedLength > 0) return true;
  }

  if (request.body === null) return false;

  const reader = request.body.getReader();
  try {
    for (let chunkCount = 0; chunkCount < MAX_EMPTY_BODY_CHUNKS; chunkCount += 1) {
      const chunk = await reader.read();
      if (chunk.done) return false;
      if (chunk.value.byteLength > 0) return true;
    }
    return true;
  } catch {
    return true;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
