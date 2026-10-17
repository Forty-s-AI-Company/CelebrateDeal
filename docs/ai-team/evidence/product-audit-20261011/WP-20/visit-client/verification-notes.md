# Browser visit coordinator

One driver instance per logical page visit keeps its UUID across retries and coalesces in-flight calls. Same tenant/live uses one origin-wide Web Lock held across prepare and visit; preparation after lock observes preceding response cookies. Browser cookie handling only, no credential reads/storage. Relative same-origin requests with canonical client header. 15s default/30s maximum abort signal covers lock wait/network; strict acknowledgement validates version/event. Once prepared, retries refuse a different version. Successful receipt cached. Missing Web Locks returns unavailable, no unsafe lockless fallback.

Validation targeted/lint/full tsc PASS373d7a6960bbb83ed51e0a45d783a42e0e5595e30127b83ef73785ff976a73dd. Initial DOM LockManager generic Promise nesting tsc failure preserved; explicit async/await flattens return without cast. Unit tests simulate lock serialization, not actual browser tabs. Real browser Cookie/WebLock/timeout E2E NOT_RUN. No page/component has been wired yet; independent review NOT_RUN.

Limitations: driver state is in-memory; reload after lost visit acknowledgement creates a new event as a new logical page visit. Lock prevents simultaneous preparation but cannot merge distinct browser profiles. Missing-lock behavior must be represented as a coverage gap, never complete collection. Version-change recovery and expired-cookie lifecycle still pending. Response parsing relies on same-origin bounded server contract. Do not claim enabled collection or full statistics.

Rollback: remove two new driver/test files; no deployed state.
