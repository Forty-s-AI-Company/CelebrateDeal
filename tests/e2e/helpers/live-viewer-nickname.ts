import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * Owner 2026-11-26: a live room with chat asks every admitted viewer for a
 * nickname and avatar before the live video loads. Journeys that are not
 * about that step complete it the way a viewer does: type a unique name and
 * press 進入直播間.
 */
export function liveNicknameDialog(page: Page) {
  return page.getByRole("dialog", { name: "設定你在直播間的名稱" });
}

export function uniqueLiveNickname(prefix = "觀眾") {
  return `${prefix}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

/** Waits for the gate on a playing live page and enters with a unique nickname. */
export async function enterLiveWithNickname(page: Page, nickname = uniqueLiveNickname()) {
  const dialog = liveNicknameDialog(page);
  await expect(dialog.getByLabel("暱稱")).toBeVisible();
  await dialog.getByLabel("暱稱").fill(nickname);
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/live-viewer-profile" && response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "進入直播間" }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toBeHidden();
  return nickname;
}
