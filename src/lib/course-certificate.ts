import { createHash } from "node:crypto";

export type CourseCertificateInput = {
  vendorName: string;
  studentName: string;
  courseName: string;
  completedAt: Date;
  /** A tenant-scoped opaque learner identifier; never rendered in the SVG. */
  customerKeyHash: string;
  courseId: string;
};

export type CourseCertificate = { svg: string; verificationNumber: string };

function cleanText(value: string, label: string, maximumLength: number) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximumLength) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function escapeXml(value: string) {
  return value.replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[character] ?? character);
}

function formatDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("Invalid completion date.");
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeZone: "Asia/Taipei" }).format(value);
}

/**
 * Produces a downloadable, self-contained SVG. The verification value is a
 * deterministic digest: no secret or student key is exposed in the artwork.
 */
export function createCourseCertificate(input: CourseCertificateInput): CourseCertificate {
  const vendorName = cleanText(input.vendorName, "vendor name", 120);
  const studentName = cleanText(input.studentName, "student name", 120);
  const courseName = cleanText(input.courseName, "course name", 180);
  const courseId = cleanText(input.courseId, "course id", 160);
  const customerKeyHash = cleanText(input.customerKeyHash, "student identity", 256);
  const completedDate = formatDate(input.completedAt);
  const dateKey = input.completedAt.toISOString().slice(0, 10);
  const digest = createHash("sha256").update(`course-certificate:v1:${courseId}:${customerKeyHash}:${dateKey}`).digest("hex").toUpperCase();
  const verificationNumber = `CD-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1131" viewBox="0 0 1600 1131" role="img" aria-label="${escapeXml(courseName)} 完課證書">
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity=".08"/></pattern></defs>
  <rect width="1600" height="1131" fill="url(#bg)"/><rect width="1600" height="1131" fill="url(#grid)"/><rect x="54" y="54" width="1492" height="1023" rx="28" fill="#fff"/><rect x="82" y="82" width="1436" height="967" rx="18" fill="none" stroke="#d4a72c" stroke-width="4"/>
  <text x="800" y="245" text-anchor="middle" font-family="Noto Serif TC, serif" font-size="38" fill="#8a6312">${escapeXml(vendorName)}</text><text x="800" y="350" text-anchor="middle" font-family="Noto Serif TC, serif" font-size="70" font-weight="700" fill="#0f172a">完 課 證 書</text>
  <text x="800" y="450" text-anchor="middle" font-family="Noto Sans TC, sans-serif" font-size="28" fill="#475569">茲證明學員</text><text x="800" y="555" text-anchor="middle" font-family="Noto Serif TC, serif" font-size="66" font-weight="700" fill="#1d4ed8">${escapeXml(studentName)}</text><path d="M410 580H1190" stroke="#d4a72c" stroke-width="3"/>
  <text x="800" y="665" text-anchor="middle" font-family="Noto Sans TC, sans-serif" font-size="28" fill="#475569">已完成課程</text><text x="800" y="740" text-anchor="middle" font-family="Noto Serif TC, serif" font-size="46" font-weight="700" fill="#0f172a">${escapeXml(courseName)}</text>
  <text x="800" y="850" text-anchor="middle" font-family="Noto Sans TC, sans-serif" font-size="25" fill="#475569">完課日期：${escapeXml(completedDate)}</text><text x="800" y="930" text-anchor="middle" font-family="ui-monospace, monospace" font-size="22" letter-spacing="3" fill="#64748b">驗證編號 ${verificationNumber}</text><circle cx="1280" cy="840" r="68" fill="#d4a72c" opacity=".16"/><text x="1280" y="850" text-anchor="middle" font-family="serif" font-size="40" fill="#8a6312">完成</text>
</svg>`;
  return { svg, verificationNumber };
}
