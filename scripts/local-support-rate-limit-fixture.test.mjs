import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import {
  createLocalSupportRateLimitServer,
  LOCAL_SUPPORT_RATE_LIMIT_HOST,
  LOCAL_SUPPORT_RATE_LIMIT_PORT,
  LOCAL_SUPPORT_RATE_LIMIT_SCRIPT,
  LOCAL_SUPPORT_RATE_LIMIT_TOKEN,
} from "./local-support-rate-limit-fixture.mjs";

const url = `http://${LOCAL_SUPPORT_RATE_LIMIT_HOST}:${LOCAL_SUPPORT_RATE_LIMIT_PORT}/`;
// The application sends its template literal with surrounding newlines.
const script = `\n${LOCAL_SUPPORT_RATE_LIMIT_SCRIPT}\n`;
const clock = { value: 1_000 };
let server;

async function start(clock) {
  const instance = createLocalSupportRateLimitServer({ now: () => clock.value });
  instance.listen(LOCAL_SUPPORT_RATE_LIMIT_PORT, LOCAL_SUPPORT_RATE_LIMIT_HOST);
  await once(instance, "listening");
  return instance;
}

test.before(async () => { server = await start(clock); });
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(body, headers = {}, method = "POST") {
  const requestMethod = method ?? "POST";
  const options = {
    method: requestMethod,
    headers: { authorization: `Bearer ${LOCAL_SUPPORT_RATE_LIMIT_TOKEN}`, ...headers },
  };
  if (requestMethod !== "GET") options.body = JSON.stringify(body);
  return fetch(url, options);
}

test("counts one key and keeps its expiry fixed until the window resets", { concurrency: false }, async () => {
  {
    const body = ["EVAL", script, 1, "celebratedeal:rl:buyer-support:synthetic", "2", "1000"];
    assert.deepEqual(await (await call(body)).json(), { result: [1, 1000] });
    clock.value = 1_400;
    assert.deepEqual(await (await call(body)).json(), { result: [2, 600] });
    clock.value = 1_999;
    assert.deepEqual(await (await call(body)).json(), { result: [3, 1] });
    clock.value = 2_000;
    assert.deepEqual(await (await call(body)).json(), { result: [1, 1000] });
  }
});

test("rejects unknown auth, method, and malformed or oversized payloads without details", { concurrency: false }, async () => {
  {
    const valid = ["EVAL", script, 1, "celebratedeal:rl:validation:synthetic", "1", "1000"];
    const cases = [
      [valid, { authorization: "Bearer wrong-token" }],
      [valid, {}, "GET"],
      [["EVAL", script, 2, valid[3], "1", "1000"], {}],
      [["EVAL", "return 1", 1, valid[3], "1", "1000"], {}],
      [["EVAL", script, 1, "other-prefix:key", "1", "1000"], {}],
      [["EVAL", script, 1, valid[3], "0", "1000"], {}],
      [["EVAL", script, 1, valid[3], "1", "0"], {}],
    ];
    for (const [body, headers, method] of cases) {
      const response = await call(body, headers, method);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "REQUEST_REJECTED" });
    }
    const oversized = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${LOCAL_SUPPORT_RATE_LIMIT_TOKEN}` },
      body: `{"payload":"${"x".repeat(4_100)}"}`,
    });
    assert.equal(oversized.status, 400);
    assert.deepEqual(await oversized.json(), { error: "REQUEST_REJECTED" });
  }
});

test("exposes only the fixed readiness health endpoint", { concurrency: false }, async () => {
  {
    const response = await fetch(`${url}health`);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    const forbidden = await fetch(url);
    assert.equal(forbidden.status, 400);
  }
});
