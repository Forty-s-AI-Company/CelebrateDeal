import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LearnerConsultationReminders } from "./learner-consultation-reminders";

it.each(["zh-TW", "en"] as const)("renders opt-in appointment copy without server-side account loading in %s", locale => {
  const html = renderToStaticMarkup(<LearnerConsultationReminders locale={locale} vendorSlug="academy" courseId="course-1" />);
  expect(html).toContain(locale === "en" ? "Appointment reminders" : "預約提醒");
  expect(html).toContain(locale === "en" ? "View my appointments" : "查看我的預約");
  expect(html).toContain(locale === "en" ? 'aria-label="Appointment reminder status"' : 'aria-label="預約提醒狀態"');
  expect(html).not.toContain("csrfToken");
  expect(html).not.toContain("customerKeyHash");
});
