// Shared fixed build/runtime catalog. Configuration cannot add modules or paths.
export const HOST_SOURCES=['live-metric-report-host','live-metric-report-queue','live-metric-report-scheduler','live-metric-report-job',
  'live-metric-report-lease','live-metric-report-snapshot','live-metric-report-reader','live-metric-completion-store',
  'live-metric-coverage-reader','live-metric-coverage','live-metric-snapshot-input'];
export const WORKER_SOURCES=['live-metric-worker','live-core-metrics-read-model','live-viewing-evidence','live-metric-contract','live-metric-executor'];
export const ALL_SOURCES=Object.freeze([...HOST_SOURCES,...WORKER_SOURCES]);
export const artifactName=name=>name+(name==='live-metric-report-host'?'.cjs':'.js');
export const ARTIFACTS=Object.freeze([...ALL_SOURCES.map(artifactName),'package.json']);
export const BUILD_SEAL='build-seal.json';
export const ALLOWED_REQUIRES=new Set([...ALL_SOURCES.map(name=>'./'+name),'@prisma/client','zod',
  'node:crypto','node:perf_hooks','node:timers/promises','node:worker_threads']);
