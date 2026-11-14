import { expect, test } from "@playwright/test";

import { joinAs, joinAsHost } from "./helpers";

test.describe("host", () => {
  test("house rules persist, switch toggles, icon buttons are named", async ({ browser }) => {
    const page = await joinAsHost(browser);

    const songs = page.getByRole("group", { name: "Songs per guest per minute" });
    const value = songs.locator("[aria-live]");
    const before = Number(await value.textContent());
    await songs.getByRole("button", { name: "More" }).click();
    await expect(value).toHaveText(String(before + 1));
    await page.reload();
    await expect(page.getByRole("group", { name: "Songs per guest per minute" }).locator("[aria-live]")).toHaveText(
      String(before + 1),
    );

    const join = page.getByRole("switch", { name: "Ask to join" });
    const was = await join.getAttribute("aria-checked");
    await join.click();
    await expect(join).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");
    await join.click(); // leave the room open for later tests
    await expect(join).toHaveAttribute("aria-checked", was ?? "false");

    for (const name of ["Queue", "Room view", "Copy invite"]) {
      await expect(page.getByRole("link", { name }).or(page.getByRole("button", { name })).first()).toBeVisible();
    }
  });

  test("host and guests can shuffle, and everyone hears who did", async ({ browser }) => {
    const guest = await joinAs(browser, "Shuffle fan");
    const page = await joinAsHost(browser);
    await page.request.get("/api/search?q=mix"); // the stub only knows songs it has returned
    for (const videoId of ["srch0000001", "srch0000002"]) {
      expect((await page.request.post("/api/queue", { data: { videoId } })).ok()).toBe(true);
    }
    await page.getByRole("button", { name: "Shuffle Up next" }).click();
    await expect(guest.getByText(/^(\S+ )?Host( \d+)? shuffled Up next$/).first()).toBeVisible();

    // Guests get the button too, and everyone hears who used it.
    const watcher = await joinAs(browser, "Watcher");
    await guest.getByRole("button", { name: "Shuffle Up next" }).click();
    await expect(watcher.getByText(/Shuffle fan shuffled Up next$/).first()).toBeVisible();
  });

  test("room view has a Host link and the QR card shows the code", async ({ browser }) => {
    const page = await joinAsHost(browser);
    await page.goto("/room");
    await expect(page.getByRole("link", { name: "Host" })).toBeVisible();
    const card = page.getByRole("complementary", { name: "Join the jam" });
    await expect(card.getByText("TEST", { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
  });
});
