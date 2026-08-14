import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

function jsonResponse(): Response {
  return new Response(JSON.stringify(LINEAGE_PAYLOAD), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export const GET = (): Response => jsonResponse();

export const HEAD = (): Response => new Response(null, {
    status: 200,
    headers: JSON_HEADERS,
  });
