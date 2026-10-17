import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as upstreamRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { admitMetricIngress, MetricIngressRoute, settleMetricIngress, stopMetricIngressRun } from './live-metric-ingress';
import { METRIC_INGRESS_HEADER, MetricIngressRunScope, type MetricIngressAttestor } from './live-metric-ingress-proof';

const scopedId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Route = z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_-]{1,255}$/), method: z.enum(['GET', 'POST']), kind: MetricIngressRoute,
  query: z.object({ vendorId: scopedId, liveId: scopedId }).strict().optional() }).strict().superRefine((route, context) => {
  if (route.query && (route.kind !== 'playback' || route.path !== '/api/live-playback-source' || route.method !== 'GET')) context.addIssue({ code: 'custom', message: 'Only scoped playback query is permitted' });
});
const Manifest = z.array(Route).min(1).max(32).superRefine((routes, context) => {
  const keys = routes.map(route => `${route.method} ${requestTarget(route)}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Duplicate ingress route' });
});
type Database = Pick<PrismaClient, '$transaction'>;
type Run = Parameters<typeof admitMetricIngress>[1];
type Frame = Parameters<typeof settleMetricIngress>[1];
type RouteManifest = z.infer<typeof Manifest>;
// A receipt is usable only through the actual gateway instance that minted it.
// Callers cannot turn arbitrary closure counters into source completeness.
type ClosedSource = { run: Run; receipt: { format: 1; runId: string; manifestHash: string; gatewayId: string;
  frameDigest: string; closedAt: string; settlementFailures: 0; admissionFailures: 0; pendingFrames: 0 } };
const closedSources = new WeakMap<object, ClosedSource>();
export function closedMetricIngressSource(gateway: object) {
  const source = closedSources.get(gateway);
  return source ? { run: { ...source.run }, receipt: { ...source.receipt } } : null;
}


/** A digest binds this fixed local gateway's configuration, not all production
 * routes or past servers. It is deliberately NOT a positive coverage proof.
 */
export function metricIngressManifestHash(value: RouteManifest) {
  const canonical = Manifest.parse(value).map(route => [route.method, requestTarget(route), route.kind])
    .sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : 1);
  return createHash('sha256').update(JSON.stringify({ format: 'isolated-loopback-ingress-v2', routes: canonical })).digest('hex');
}

/** Fixed, owned-loopback ingress for synthetic validation. Never accepts a
 * client-selected target or route. No body/header/URL is persisted or logged.
 * Optional per-run attestation authenticates the internal frame header only;
 * upstream startup, full entry universe and source writer fence remain separate.
 */
export async function startMetricIngressGateway(db: Database, valueRun: Run, upstreamPort: number, value: RouteManifest, attestor?: MetricIngressAttestor,
  options: { upstreamTimeoutMs?: number } = {}) {
  const run = MetricIngressRunScope.parse(valueRun), gatewayId = randomUUID();
  const port = z.number().int().min(1024).max(65535).parse(upstreamPort);
  const { upstreamTimeoutMs } = z.object({ upstreamTimeoutMs: z.number().int().min(1000).max(120000).default(15000) }).strict().parse(options);
  const routes = Manifest.parse(value), digest = metricIngressManifestHash(routes);
  if (routes.some(route => route.query && (route.query.vendorId !== run.vendorId || route.query.liveId !== run.liveId)) || (attestor && !attestor.matchesRun(run))) throw new Error('Metric ingress gateway binding unavailable');
  await db.$transaction(async tx => {
    // Run creation's DB trigger requires our disposable marker. Recheck marker
    // at startup too; neither a copied run nor a production DB can activate it.
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r.id FROM "LiveMetricIngressRun" r WHERE r.id=${run.runId} AND r."vendorId"=${run.vendorId}
       AND r."liveId"=${run.liveId} AND r."versionId"=${run.versionId} AND r."manifestHash"=${digest}
       AND r."stoppedAt" IS NULL AND NOT pg_is_in_recovery()
       AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database()
        AND shobj_description(oid,'pg_database') ~ '^prisma-no-dotenv:[a-f0-9]{16}$')`);
    if (rows.length !== 1) throw new Error('Metric ingress gateway binding unavailable');
  });
  const allowed = new Map(routes.map(route => [`${route.method} ${requestTarget(route)}`, route.kind]));
  const handlers = new Set<Promise<void>>(), activeUpstreams = new Set<ReturnType<typeof upstreamRequest>>();
  let closing = false, settlementFailures = 0, admissionFailures = 0, expectedHost = '';
  const diagnostics = { socketTimeouts: 0, errors: {} as Record<string, number> };
  const settle = (frame: Frame, result: Parameters<typeof settleMetricIngress>[2]) => {
    const work = settleMetricIngress(db, frame, result).then(() => undefined, () => { settlementFailures++; });
    return work;
  };
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    // Loopback alone does not prevent browser-origin pollution or DNS rebinding.
    // Reject before persistence; these checks are not an authenticated binding.
    if (request.headers.host !== expectedHost) { response.writeHead(421); response.end(); return; }
    const origin = request.headers.origin, site = request.headers['sec-fetch-site'];
    if ((origin !== undefined && origin !== `http://${expectedHost}`) || (site !== undefined && site !== 'none' && site !== 'same-origin')) {
      response.writeHead(403); response.end(); return;
    }
    const kind = allowed.get(`${request.method} ${request.url}`);
    if (closing || !kind) { response.writeHead(closing ? 503 : 404); response.end(); return; }
    let admission: Awaited<ReturnType<typeof admitMetricIngress>>;
    try { admission = await admitMetricIngress(db, run, kind); }
    catch { admissionFailures++; response.writeHead(503); response.end(); return; }
    const frame = { ...run, frameId: admission.frameId };
    if (closing || request.destroyed || response.destroyed) {
      await settle(frame, { outcome: 'interrupted' });
      if (!response.destroyed) { response.writeHead(503); response.end(); }
      return;
    }
    let finished = false, settling = false;
    const delivered = new Promise<void>(resolve => {
      const finish = (result: Parameters<typeof settle>[1]) => {
        if (settling) return;
        settling = true; void settle(frame, result).finally(resolve);
      };
      response.once('finish', () => { finished = true; finish({ outcome: 'responded', httpStatus: response.statusCode }); });
      response.once('close', () => { if (!finished) finish({ outcome: 'interrupted' }); });
    });
    // Only the predetermined loopback host/port can receive these synthetic
    // requests. Strip hop-by-hop fields and client-supplied internal markers.
    const headers = forwardedHeaders(request.headers);
    for (const name of Object.keys(headers)) {
      if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-real-ip' || name === 'cf-connecting-ip' || name === 'true-client-ip' || name === 'x-vercel-forwarded-for' || name === 'x-celebratedeal-live-chat-ingress') delete headers[name];
    }
    // These values have passed the gate. Connection's nominated fields must
    // not remove them and make upstream origin validation observe other data.
    if (origin !== undefined) headers.origin = origin;
    if (site !== undefined) headers['sec-fetch-site'] = site;
    // Keep the validated browser-visible origin for canonical upstream CSRF
    // checks. The TCP destination remains the fixed owned loopback port.
    headers.host = expectedHost;
    if (attestor) headers[METRIC_INGRESS_HEADER] = attestor.issue(admission.frameId, { kind, method: request.method as 'GET' | 'POST', target: request.url! });
    const upstream = upstreamRequest({ hostname: '127.0.0.1', port, path: request.url, method: request.method, headers }, incoming => {
      const status = incoming.statusCode ?? 502;
      response.writeHead(status >= 200 && status <= 599 ? status : 502, forwardedHeaders(incoming.headers));
      incoming.on('error', () => response.destroy());
      incoming.pipe(response);
    });
    activeUpstreams.add(upstream);
    upstream.once('close', () => activeUpstreams.delete(upstream));
    upstream.setTimeout(upstreamTimeoutMs, () => { diagnostics.socketTimeouts++; upstream.destroy(); });
    upstream.once('error', error => {
      const raw = (error as NodeJS.ErrnoException).code;
      const code = typeof raw === 'string' && ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','HPE_INVALID_HEADER_TOKEN','HPE_UNEXPECTED_CONTENT_LENGTH'].includes(raw) ? raw : 'OTHER';
      diagnostics.errors[code] = (diagnostics.errors[code] ?? 0) + 1;
      if (!response.headersSent) { response.writeHead(502); response.end(); }
      else response.destroy();
    });
    request.once('aborted', () => upstream.destroy());
    response.once('close', () => { if (!finished) upstream.destroy(); });
    request.pipe(upstream);
    await delivered;
  }
  const server = createServer((request, response) => {
    // Track from BEFORE admission through response/close and DB settlement.
    // Socket close and server close can arrive in different event-loop turns.
    const task = handle(request, response).catch(() => { settlementFailures++; response.destroy(); });
    handlers.add(task); void task.finally(() => handlers.delete(task));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Metric ingress loopback unavailable'); }
  expectedHost = `127.0.0.1:${address.port}`;
  let closePromise: Promise<{ settlementFailures: number; admissionFailures: number; pendingFrames: number }> | null = null;
  const gateway = {
    origin: `http://127.0.0.1:${address.port}`,
    diagnostics: () => ({ upstreamTimeoutMs, socketTimeouts: diagnostics.socketTimeouts, errors: { ...diagnostics.errors } }),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        // Close even if database stop fails. Such a run stays OPEN in evidence;
        // the caller must treat the shutdown as failed, never as source closure.
        let stopFailed = false;
        try { await stopMetricIngressRun(db, run); } catch { stopFailed = true; }
        const timer = setTimeout(() => { for (const upstream of activeUpstreams) upstream.destroy(); server.closeAllConnections(); }, 5000);
        try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
        finally { clearTimeout(timer); }
        const drain = async () => { while (handlers.size > 0) await Promise.all([...handlers]); };
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([drain(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Metric ingress handler drain failed')), 15000); })]);
        } finally { clearTimeout(deadline); }
        if (stopFailed) throw new Error('Metric ingress database stop failed');
        const frontier = await db.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT set_config('row_security','off',true),set_config('statement_timeout','5000',true)`);
          const [row] = await tx.$queryRaw<{ count: number; frameDigest: string; closedAt: Date }[]>(Prisma.sql`
            SELECT count(*)::int AS count,
              public.wp20_metric_ingress_frame_digest(${run.vendorId},${run.liveId},${run.versionId},${run.runId}) AS "frameDigest",
              date_trunc('milliseconds',clock_timestamp()) AS "closedAt"
            FROM "LiveMetricIngressFrame" WHERE "runId"=${run.runId}
             AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId} AND outcome='pending'`);
          return row;
        });
        const pendingFrames = frontier.count;
        if (attestor && settlementFailures === 0 && admissionFailures === 0 && pendingFrames === 0
          && /^[a-f0-9]{64}$/.test(frontier.frameDigest) && frontier.closedAt instanceof Date && Number.isFinite(+frontier.closedAt)) {
          closedSources.set(gateway, { run: { ...run }, receipt: { format: 1, runId: run.runId, manifestHash: digest, gatewayId,
            frameDigest: frontier.frameDigest, closedAt: frontier.closedAt.toISOString(), settlementFailures: 0, admissionFailures: 0, pendingFrames: 0 } });
        }
        return { settlementFailures, admissionFailures, pendingFrames };
      })();
      return closePromise;
    },
  };
  return gateway;
}

function requestTarget(route: z.infer<typeof Route>) {
  return route.query ? `${route.path}?vendorId=${encodeURIComponent(route.query.vendorId)}&liveId=${encodeURIComponent(route.query.liveId)}` : route.path;
}

function forwardedHeaders(input: IncomingHttpHeaders) {
  const connection = String(input.connection ?? '').toLowerCase().split(',').map(value => value.trim());
  const excluded = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...connection]);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !excluded.has(name.toLowerCase()) && !name.toLowerCase().startsWith('x-celebratedeal-metric-')));
}
