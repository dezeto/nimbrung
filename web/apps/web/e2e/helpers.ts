import { type Browser, type Page, expect } from "@playwright/test";

export const NOW_TITLE = "Stub Song";
export const NOW_ARTIST = "Stub Artist";
export const HOST_KEY = "e2e-host-key";

/** A fresh browser context (own cookie + localStorage) joined as `name`, with `avatar` if given (it must be free). */
export async function joinAs(browser: Browser, name: string, avatar?: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/join/TEST");
  await page.getByLabel("Your name").fill(name);
  if (avatar) await pickFace(page, avatar);
  await page.getByRole("button", { name: "Join the jam" }).click();
  await expect(page.getByRole("heading", { name: NOW_TITLE })).toBeVisible();
  return page;
}

/** A fresh context that opened the host link and landed on /host. */
export async function joinAsHost(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/host?key=${HOST_KEY}`);
  await expect(page.getByRole("switch", { name: "Ask to join" })).toBeVisible();
  return page;
}

/** Taps a face on the join screen (the radio itself is visually hidden). */
export async function pickFace(page: Page, face: string) {
  const radio = page.getByRole("radio", { name: face, exact: true });
  await page.locator("label").filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}
