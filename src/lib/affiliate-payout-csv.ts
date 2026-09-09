/** 匯出欄位保留 CSV 引號跳脫與試算表公式防護。 */
export function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  // Spreadsheet programs evaluate leading formula characters. Prefixing an
  // apostrophe preserves the value while keeping CSV downloads inert.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
