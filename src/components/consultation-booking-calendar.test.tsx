import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsultationBookingCalendar, ConsultationSlotButtons } from "@/components/consultation-booking-calendar";

const settings = {
  title: "預約諮詢",
  timezone: "Asia/Taipei",
  durationMinutes: 30 as const,
  submitLabel: "送出預約",
  successMessage: "完成",
  intakeFields: [],
};

describe("consultation booking calendar", () => {
  it("renders month navigation, calendar and core intake contract", () => {
    const html = renderToStaticMarkup(
      <ConsultationBookingCalendar
        settings={settings}
        loadSlots={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("上個月");
    expect(html).toContain("下個月");
    expect(html).toContain("先選擇日期");
  });

  it("shows the unconnected service state without inventing an API", () => {
    const html = renderToStaticMarkup(
      <ConsultationBookingCalendar settings={settings} />,
    );
    expect(html).toContain("先選擇日期");
  });

  it("renders an available time and forwards the selected slot on click", () => {
    const selected = vi.fn();
    const slot = { id: "slot-1", start: "2026-09-07T01:00:00.000Z", end: "2026-09-07T01:30:00.000Z", label: "09:00" };
    const tree = ConsultationSlotButtons({ slots: [slot], onSelect: selected }) as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    expect(renderToStaticMarkup(tree)).toContain("09:00");
    tree.props.children[0]!.props.onClick();
    expect(selected).toHaveBeenCalledWith(slot);
  });
});
