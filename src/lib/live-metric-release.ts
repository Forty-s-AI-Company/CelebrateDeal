/** Invoke cleanup synchronously so a subsequent mount cannot replace its
 * target. Release is unconditional and bounded; timeout is not evidence of a
 * successful metric close. A late close remains subject to server auth checks.
 */
export function releaseAfterMetricClose(close: () => Promise<void>, release: () => Promise<void>, timeoutMs = 10000): Promise<void> {
  let closing: Promise<void>;
  try { closing = Promise.resolve(close()); } catch { closing = Promise.resolve(); }
  return new Promise<void>((resolve) => {
    let released = false;
    const finish = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      Promise.resolve().then(release).catch(() => undefined).then(resolve);
    };
    const timer = setTimeout(finish, timeoutMs);
    void closing.then(finish, finish);
  });
}

/** Same-document ownership only; never stores credentials. Each scope keeps
 * its entry while a close is pending, so even a mount/unmount cycle invalidates
 * an older delayed release. The server still owns cross-tab lease authority.
 */
export function createAdmissionReleaseRegistry() {
  type Entry = { owners: Set<symbol>; generation: number; pending: number };
  const scopes = new Map<string, Entry>();
  return {
    acquire(scope: string) {
      const entry = scopes.get(scope) ?? { owners: new Set<symbol>(), generation: 0, pending: 0 };
      scopes.set(scope, entry);
      const owner = Symbol(); entry.owners.add(owner); entry.generation++;
      let cleanup: Promise<void> | null = null;
      return (close: () => Promise<void>, release: () => Promise<void>) => {
        if (cleanup) return cleanup;
        entry.owners.delete(owner); entry.pending++;
        const generation = ++entry.generation;
        cleanup = releaseAfterMetricClose(close, async () => {
          if (!entry.owners.size && generation === entry.generation) await release();
        }).finally(() => {
          entry.pending--;
          if (!entry.owners.size && !entry.pending && scopes.get(scope) === entry) scopes.delete(scope);
        });
        return cleanup;
      };
    },
  };
}

export const admissionReleaseRegistry = createAdmissionReleaseRegistry();
