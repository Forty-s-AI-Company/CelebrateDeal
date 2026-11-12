import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 以 `disabled:opacity-*` 表示停用的控制項，不可讓 opacity 參與 transition：
// Tailwind 的 `transition`（不帶後綴）包含 opacity，按鈕從 disabled 變成可用的
// 150ms 內仍是半透明，axe 會在這段期間判定對比不足（CI 的 live stepper 偶發失敗）。
// 改用 `transition-colors` 或明確列出不含 opacity 的屬性，例如 `transition-[color,filter]`。
// FormSubmitButton／LiveConfirmedSubmitButton 會自行加上 disabled:opacity-60，
// 所以傳給它們的 className 也不可含 `transition`。

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

/** Every string or template literal that looks like a class list. */
function classLists(source: string) {
  return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((match) => (match[1] ?? match[2] ?? "").split(/\s+/));
}

function offenders(source: string) {
  const found: string[] = [];
  for (const tokens of classLists(source)) {
    if (tokens.includes("transition") && tokens.some((token) => /^(?:[a-z-]+:)*disabled:opacity-/.test(token))) found.push(tokens.join(" ").slice(0, 120));
  }
  for (const match of source.matchAll(/<(?:FormSubmitButton|LiveConfirmedSubmitButton)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const tokens = (match[1] ?? match[2] ?? "").split(/\s+/);
    if (tokens.includes("transition")) found.push(tokens.join(" ").slice(0, 120));
  }
  return found;
}

describe("disabled controls never transition opacity", () => {
  it("flags the bare transition utility next to disabled opacity", () => {
    expect(offenders('<button className="bg-primary transition disabled:opacity-60" />')).toHaveLength(1);
    expect(offenders('<FormSubmitButton name="status" className="bg-primary text-white transition hover:bg-primary-dark">')).toHaveLength(1);
    expect(offenders('<button className="bg-primary transition-colors disabled:opacity-60" />')).toEqual([]);
    expect(offenders('<button className="transition-[color,filter] disabled:opacity-60" />')).toEqual([]);
  });

  it("has no control in src that fades its disabled opacity", () => {
    const root = process.cwd();
    const failures = listSources(path.join(root, "src")).flatMap((file) =>
      offenders(readFileSync(file, "utf8")).map((classes) => `${path.relative(root, file).split(path.sep).join("/")}: ${classes}`));
    expect(failures).toEqual([]);
  });
});
