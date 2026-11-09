// 本機診斷：以和 `next dev` 相同的規則載入環境變數，只印出連線目標（主機、port、資料庫），
// 不印帳號、密碼或完整網址，並實際測試 DATABASE_URL 能否連線。
// 用法：node scripts/diagnose-local-db.mjs
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
console.log("載入的環境檔：", loadedEnvFiles.map((file) => file.path).join(", ") || "（無）");

function describe(name) {
  const raw = process.env[name];
  if (!raw) return console.log(`${name}: 未設定`);
  try {
    const url = new URL(raw);
    const params = [...url.searchParams.keys()].filter((key) => !/pass|secret|token/i.test(key));
    console.log(`${name}: ${url.protocol}//${url.hostname}:${url.port || "(預設)"}${url.pathname}  參數=[${params.join(", ")}]`);
  } catch {
    console.log(`${name}: 已設定，但不是可解析的網址`);
  }
}
describe("DATABASE_URL");
describe("DIRECT_URL");
console.log("RATE_LIMIT_PROVIDER:", process.env.RATE_LIMIT_PROVIDER || "（未設定，預設 memory）");

const db = new PrismaClient();
try {
  const [row] = await db.$queryRaw`SELECT current_database() AS db, (SELECT count(*)::int FROM "User") AS users`;
  console.log(`連線成功：資料庫=${row.db}，User 筆數=${row.users}`);
} catch (error) {
  const code = typeof error?.errorCode === "string" ? error.errorCode : typeof error?.code === "string" ? error.code : "unknown";
  const message = String(error?.message ?? "");
  const category = /authentication failed|password/i.test(message) ? "帳密錯誤"
    : /can't reach|connection refused|econnrefused/i.test(message) ? "連不到主機"
      : /does not exist/i.test(message) ? "資料庫或資料表不存在"
        : /timed? ?out/i.test(message) ? "逾時" : "其他";
  console.log(`連線失敗：代碼=${code}，類型=${category}`);
} finally {
  await db.$disconnect();
}
