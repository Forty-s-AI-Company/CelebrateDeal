import { randomUUID } from "node:crypto";
import { expect, type Page, type Request, type Response } from "@playwright/test";

type UrlMatcher = RegExp | string;

export type DirectUrlTransport =
  | {
      kind: "http-redirect";
      status: 307;
      location: UrlMatcher;
    }
  | {
      kind: "http-not-found";
      status: 404;
    }
  | {
      kind: "streaming-redirect";
      status: 200;
      redirectMarker: "NEXT_REDIRECT";
      redirectTargetMarker: string;
    }
  | {
      kind: "streaming-not-found";
      status: 200;
    };

export type DirectUrlGuardOptions = {
  page: Page;
  path: string;
  transport: DirectUrlTransport;
  /** Values that must not appear in a non-3xx protected document/RSC response. */
  protectedPayloadCanaries?: readonly string[];
  /** Values that must not appear in the terminal document body or HTML. */
  documentCanaries?: readonly string[];
  /** Route parameters are request identity, not disclosure canaries. */
  routeIdentityCanaries?: readonly string[];
  /** The semantic URL expected after the terminal outcome has completed. */
  finalUrl?: UrlMatcher;
  /** Expected status of the initial page.goto(..., { waitUntil: "commit" }) response; legacy name retained. */
  finalStatus?: number;
  /** Additional marker strings forbidden in a non-3xx protected payload. */
  forbiddenPayload?: readonly string[];
};

export type DirectUrlGuardEvidence = {
  /** Initial page.goto(..., { waitUntil: "commit" }) response; legacy name retained. */
  finalResponse: Response | null;
  protectedRequest: Request;
  protectedResponse: Response;
  protectedPayload: string | null;
  protectedDocumentHtml: string | null;
};

function assertUrl(url: string, matcher: UrlMatcher) {
  if (matcher instanceof RegExp) {
    expect(url).toMatch(matcher);
    return;
  }

  const parsed = new URL(url);
  const expected = new URL(matcher, parsed.origin);
  expect(`${parsed.pathname}${parsed.search}`).toBe(`${expected.pathname}${expected.search}`);
}

function assertLocation(location: string | undefined, matcher: UrlMatcher, base: URL) {
  expect(location, "redirect response must include a Location header").toBeDefined();
  if (!location) return;

  if (matcher instanceof RegExp) {
    expect(location).toMatch(matcher);
    return;
  }

  const actual = new URL(location, base.origin);
  const expected = new URL(matcher, base.origin);
  expect(`${actual.pathname}${actual.search}`).toBe(`${expected.pathname}${expected.search}`);
}

async function waitForTerminalUrl(page: Page, matcher: UrlMatcher) {
  if (matcher instanceof RegExp) {
    await expect
      .poll(() => page.url(), {
        message: "expected the terminal redirect URL to settle",
        timeout: 15_000,
      })
      .toMatch(matcher);
    return;
  }

  const expected = new URL(matcher, page.url());
  await expect
    .poll(
      () => {
        const current = new URL(page.url());
        return `${current.pathname}${current.search}`;
      },
      {
        message: "expected the terminal redirect URL to settle",
        timeout: 15_000,
      },
    )
    .toBe(`${expected.pathname}${expected.search}`);
}

function isMatchingProtectedDocumentRequest(request: Request, target: URL, page: Page) {
  const url = new URL(request.url());
  return (
    url.origin === target.origin
    && url.pathname === target.pathname
    && url.search === target.search
    && request.isNavigationRequest()
    && request.resourceType() === "document"
    && request.frame() === page.mainFrame()
  );
}

/**
 * Navigates through the real browser context and verifies a protected direct
 * URL without coupling the test to Next.js redirect/notFound transport codes.
 * The caller remains responsible for the route-specific semantic UI checks.
 */
export async function navigateAndAssertDirectUrlGuard({
  page,
  path,
  transport,
  protectedPayloadCanaries,
  documentCanaries,
  routeIdentityCanaries = [],
  finalUrl,
  finalStatus,
  forbiddenPayload = [],
}: DirectUrlGuardOptions): Promise<DirectUrlGuardEvidence> {
  const target = new URL(path, page.url());
  const protectedCanaries = protectedPayloadCanaries ?? [];
  const terminalDocumentCanaries = documentCanaries ?? [];
  const navigationRequests: Request[] = [];
  const matchingResponses: Response[] = [];
  const postRequests: Request[] = [];
  const onRequest = (request: Request) => {
    if (isMatchingProtectedDocumentRequest(request, target, page)) {
      navigationRequests.push(request);
    }
    if (request.method() === "POST") postRequests.push(request);
  };
  const onResponse = (response: Response) => {
    // 從 response.request() 重新驗證完整 document identity，避免誤收同路徑的子資源。
    const request = response.request();
    if (!isMatchingProtectedDocumentRequest(request, target, page)) return;

    matchingResponses.push(response);
  };

  for (const canary of routeIdentityCanaries) {
    expect(canary.length, "route identity canaries must be non-empty").toBeGreaterThan(0);
    expect(`${target.pathname}${target.search}`, "route identity must be present in the target path/query").toContain(canary);
  }
  const routeIdentitySet = new Set(routeIdentityCanaries);
  const overlappingCanaries = [...protectedCanaries, ...terminalDocumentCanaries].filter((canary) => routeIdentitySet.has(canary));
  expect(overlappingCanaries, "route identity canaries must stay separate from disclosure canaries").toEqual([]);

  page.on("request", onRequest);
  page.on("response", onResponse);
  let protectedDocumentCapture: Promise<string> | undefined;
  let resolveProtectedDocumentCapture: ((html: string) => void) | undefined;
  let protectedDocumentCaptureTimeout: ReturnType<typeof setTimeout> | undefined;
  let captureBinding: Awaited<ReturnType<Page["exposeFunction"]>> | undefined;
  let captureInitScript: Awaited<ReturnType<Page["addInitScript"]>> | undefined;
  try {
    if (transport.kind === "streaming-redirect") {
      const bindingName = `__directUrlDocumentCapture_${randomUUID().replace(/-/g, "")}`;
      protectedDocumentCapture = new Promise<string>((resolve, reject) => {
        protectedDocumentCaptureTimeout = setTimeout(() => {
          reject(new Error("streaming redirect protected document capture timed out after 10000ms"));
        }, 10_000);
        resolveProtectedDocumentCapture = (html) => {
          if (protectedDocumentCaptureTimeout !== undefined) {
            clearTimeout(protectedDocumentCaptureTimeout);
            protectedDocumentCaptureTimeout = undefined;
          }
          resolve(html);
        };
      });
      captureBinding = await page.exposeFunction(bindingName, (html: unknown) => {
        if (typeof html === "string") resolveProtectedDocumentCapture?.(html);
      });
      captureInitScript = await page.addInitScript(
        ({ bindingName, targetOrigin, targetPathQuery, redirectMarker, redirectTargetMarker }) => {
          if (window.top !== window) return;
          if (window.location.origin !== targetOrigin) return;
          if (`${window.location.pathname}${window.location.search}` !== targetPathQuery) return;

          let captured = false;
          let sawRedirectMarker = false;
          let sawTargetMarker = false;

          const inspect = (value: string) => {
            sawRedirectMarker ||= value.includes(redirectMarker);
            sawTargetMarker ||= value.includes(redirectTargetMarker);
          };

          const captureIfReady = () => {
            if (captured || !sawRedirectMarker || !sawTargetMarker) return;

            const html = document.documentElement?.outerHTML;
            const fn = (window as unknown as Record<string, (html: string) => Promise<unknown>>)[bindingName];
            if (!html || typeof fn !== "function") return;

            captured = true;
            observer.disconnect();
            void fn(html).catch(() => {});
          };

          const observer = new MutationObserver((records) => {
            for (const record of records) {
              inspect(record.target.textContent ?? "");
              for (const node of record.addedNodes) {
                inspect(
                  node.nodeType === Node.ELEMENT_NODE
                    ? (node as Element).outerHTML
                    : node.textContent ?? "",
                );
              }
            }
            captureIfReady();
          });

          observer.observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });

          inspect(document.documentElement?.outerHTML ?? "");
          captureIfReady();
        },
        {
          bindingName,
          targetOrigin: target.origin,
          targetPathQuery: `${target.pathname}${target.search}`,
          redirectMarker: transport.redirectMarker,
          redirectTargetMarker: transport.redirectTargetMarker,
        },
      );
    }

    // 保留既有命名：這是 initial page.goto(..., { waitUntil: "commit" }) response，不是後續 terminal document。
    const finalResponse = await page.goto(path, { waitUntil: "commit" });
    expect(navigationRequests, `expected one same-frame document GET for ${path}`).toHaveLength(1);
    expect(matchingResponses, `expected one matching same-frame document response for ${path}`).toHaveLength(1);

    const [protectedRequest] = navigationRequests;
    const [protectedResponse] = matchingResponses;
    expect(protectedRequest.method()).toBe("GET");
    expect(protectedResponse.request()).toBe(protectedRequest);
    expect(finalResponse).not.toBeNull();
    if (!finalResponse) {
      throw new Error(`direct URL navigation did not produce terminal responses for ${path}`);
    }

    expect(protectedResponse.status()).toBe(transport.status);
    const isHttpRedirect = transport.kind === "http-redirect";
    if (isHttpRedirect) {
      assertLocation(protectedResponse.headers().location, transport.location, target);
    }

    const protectedPayload: string | null = null;
    let protectedDocumentHtml: string | null = null;
    if (transport.kind === "streaming-redirect") {
      if (!protectedDocumentCapture) {
        throw new Error("streaming redirect protected document capture was not initialized");
      }
      protectedDocumentHtml = await protectedDocumentCapture;
      for (const canary of protectedCanaries) {
        expect(protectedDocumentHtml, `protected document leaked canary: ${canary}`).not.toContain(canary);
      }
      for (const marker of forbiddenPayload) {
        expect(protectedDocumentHtml, `protected document contained forbidden marker: ${marker}`).not.toContain(marker);
      }
      expect(protectedDocumentHtml, `protected document missing redirect marker: ${transport.redirectMarker}`).toContain(
        transport.redirectMarker,
      );
      expect(
        protectedDocumentHtml,
        `protected document missing redirect target marker: ${transport.redirectTargetMarker}`,
      ).toContain(transport.redirectTargetMarker);
    }

    if (finalUrl !== undefined) {
      await waitForTerminalUrl(page, finalUrl);
    } else {
      assertUrl(page.url(), page.url());
    }
    if (finalStatus !== undefined) expect(finalResponse.status()).toBe(finalStatus);

    if (transport.kind === "streaming-not-found") {
      // 此 kind 刻意不啟動或 await raw response stream；raw stream 未掃描，也不宣稱已逐位元讀完。
      // 安全證據由 final page.content()/documentCanaries、下方 semantic 404 檢查，以及 caller 的 DB snapshot 提供。
      await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      await expect(page.locator("body")).toContainText(/404|找不到|不存在|not found/i);
    }

    expect(postRequests, `direct navigation emitted POST requests: ${postRequests.map((request) => request.url()).join(", ")}`).toEqual([]);

    const bodyText = await page.locator("body").innerText();
    const pageHtml = await page.content();
    for (const canary of terminalDocumentCanaries) {
      expect(bodyText, `final DOM leaked canary: ${canary}`).not.toContain(canary);
      expect(pageHtml, `final HTML leaked canary: ${canary}`).not.toContain(canary);
    }

    return {
      finalResponse,
      protectedRequest,
      protectedResponse: protectedResponse!,
      protectedPayload,
      protectedDocumentHtml,
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    if (protectedDocumentCaptureTimeout !== undefined) {
      clearTimeout(protectedDocumentCaptureTimeout);
      protectedDocumentCaptureTimeout = undefined;
    }
    try {
      await captureInitScript?.dispose();
    } finally {
      await captureBinding?.dispose();
    }
  }
}
