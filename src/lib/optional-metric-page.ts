import { MetricVisitorError } from './live-metric-visitor';

/** Tracking is optional after the public page's own authorization/readiness.
 * A failed source commit must expose no nonce or collector. Missing sources
 * remain missing in the ingress census, never an audited zero or coverage.
 * Request signatures, navigation control flow and unexpected errors propagate.
 */
export async function optionalMetricPage<T>(issue: () => Promise<T>): Promise<T | null> {
  try {
    return await issue();
  } catch (error) {
    if (error instanceof MetricVisitorError && error.code === 'PERSISTENCE_UNAVAILABLE') {
      // Fixed diagnostics only: never serialize an exception or request scope.
      console.warn('METRIC_PAGE_OPTIONAL_UNAVAILABLE', { code: 'PERSISTENCE_UNAVAILABLE' });
      return null;
    }
    throw error;
  }
}
