import http from "node:http";

// This synthetic ingress is bound only to loopback. It exercises the existing
// trusted-proxy contract without granting requests any viewer or tenant rights.
export async function startPrivateChatLoopbackIngress({ port, upstreamPort, proof }) {
  if (![port, upstreamPort].every(value => Number.isInteger(value) && value > 1024 && value <= 65535)
    || port === upstreamPort || typeof proof !== "string" || proof.length < 32) {
    throw new Error("invalid-loopback-ingress-config");
  }
  const server = http.createServer((request, response) => {
    const address = request.socket.remoteAddress;
    if (address !== "127.0.0.1" && address !== "::ffff:127.0.0.1") {
      response.writeHead(403).end();
      return;
    }
    const headers = { ...request.headers };
    // Client supplied forwarding headers cannot select a different identity.
    for (const name of ["forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip",
      "x-celebratedeal-live-chat-ingress", "proxy-authorization"]) delete headers[name];
    headers["cf-connecting-ip"] = "127.0.0.1";
    headers["x-celebratedeal-live-chat-ingress"] = proof;
    const upstream = http.request({ hostname: "127.0.0.1", port: upstreamPort,
      path: request.url, method: request.method, headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
}
