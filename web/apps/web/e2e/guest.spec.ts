import { expect, test } from "@playwright/test";

import { NOW_ARTIST, NOW_TITLE, joinAs, pickFace } from "./helpers";

test.describe("join", () => {
  test("invite shows the room and now playing; joining lands on the Queue", async ({ page }) => {
    await page.goto("/join/TEST");
    await expect(page.getByRole("heading", { name: "Test jam" })).toBeVisible();
    await expect(page.getByText(NOW_TITLE)).toBeVisible();

    await expect(page.getByLabel("Room code")).toHaveCount(0);
    await page.getByRole("button", { name: "Different code?" }).click();
    await expect(page.getByLabel("Room code")).toHaveValue("TEST");

    await page.getByLabel("Your name").fill("Ana");
    await pickFace(page, "🐼");
    await page.getByRole("button", { name: "Join the jam" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Up next" })).toBeVisible();
  });

  test("a face someone has is greyed out for the next guest", async ({ browser }) => {
    await joinAs(browser, "Cara", "🐙");
    const next = await (await browser.newContext()).newPage();
    await next.goto("/join/TEST");
    await expect(next.getByRole("radio", { name: "🐙 (taken)" })).toBeDisabled();
    await expect(next.getByRole("radio", { checked: true })).not.toHaveAccessibleName(/taken/);
  });
});

test.describe("queue", () => {
  test("header, now playing, reactions row and dock", async ({ browser }) => {
    const page = await joinAs(browser, "Ben");
    await expect(page.getByRole("heading", { name: "Test jam", level: 1 })).toBeVisible();
    await expect(page.getByLabel(/^\d+ in the jam$/)).toBeVisible(); // who's here sits beside the name; no code tag

    const card = page.getByRole("region", { name: "Now playing" });
    await expect(card.getByRole("heading", { name: NOW_TITLE })).toBeVisible();
    await expect(card.getByText(NOW_ARTIST)).toBeVisible();

    // One button opens the tray; it stays open for more taps and closes on Escape.
    await expect(page.getByRole("group", { name: "React to the song" })).toHaveCount(0);
    await page.getByRole("button", { name: "React", exact: true }).click();
    await expect(page.getByRole("group", { name: "React to the song" }).getByRole("button")).toHaveCount(6);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "React to the song" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Vote to skip/ })).toBeVisible();

    const dock = page.getByRole("navigation", { name: "Song actions" });
    await expect(dock.getByRole("link", { name: "Add a song" })).toBeVisible();
    await expect(dock.getByRole("button", { name: /^Chat/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saved songs" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Saved songs" })).toHaveCount(0);
  });

  test("a guest can leave after confirming, and lands on the join screen", async ({ browser }) => {
    const page = await joinAs(browser, "Lea");
    await page.getByRole("button", { name: "Leave the jam" }).click();
    const sheet = page.getByRole("dialog", { name: /Leave/ });
    await sheet.getByRole("button", { name: "Stay" }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Leave the jam" }).click();
    await sheet.getByRole("button", { name: "Leave the jam" }).click();
    await expect(page).toHaveURL(/\/join\/TEST$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/join\/TEST$/); // the session is gone, not just the screen
  });

  test("vote to skip is pressed, explained, and survives a reload", async ({ browser }) => {
    const page = await joinAs(browser, "Cy");
    const pill = page.getByRole("button", { name: /^Vote to skip/ }).first();
    await expect(pill).toHaveAttribute("aria-pressed", "false");
    await pill.click();
    await expect(page.getByRole("button", { name: /^Voted to skip/ }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "You voted to skip" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: /^Voted to skip/ }).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("save heart toggles with toasts, undo, and shows behind the Saved heart on /search", async ({ browser }) => {
    const page = await joinAs(browser, "Di");
    const heart = page.getByRole("button", { name: `Save ${NOW_TITLE}` });
    await heart.click();
    await expect(page.getByText("Saved to your list")).toBeVisible();
    await expect(heart).toHaveAttribute("aria-pressed", "true");

    await heart.click();
    await expect(page.getByText("Removed from Saved")).toBeVisible();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("link", { name: "Add a song" }).click();
    await page.getByRole("link", { name: "Saved songs" }).click();
    await expect(page.getByRole("heading", { name: "Saved songs" })).toBeVisible();
    await expect(page.locator("main").getByText(NOW_TITLE)).toBeVisible();
  });

  test("empty Up next suggests saved songs with one-tap add", async ({ browser }) => {
    const page = await joinAs(browser, "Su");
    await page.evaluate(() =>
      localStorage.setItem(
        "nimbrung.saved",
        JSON.stringify([
          { videoId: "saved-1", title: "Saved One", artist: "Someone", duration: 200, thumb: "" },
        ]),
      ),
    );
    await page.reload();
    const picks = page.getByRole("region", { name: "From your saved songs" });
    await expect(picks.getByText("Saved One")).toBeVisible();
    await expect(picks.getByRole("button", { name: "Add Saved One" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find another song" })).toBeVisible();
  });

  test("chat sheet: focus, own message, close, and unread badge for others", async ({ browser }) => {
    const a = await joinAs(browser, "Eve");
    await a.getByRole("button", { name: "Chat", exact: true }).click();
    const dialog = a.getByRole("dialog", { name: "Chat" });
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole("textbox", { name: "Comment" });
    await expect(box).toBeFocused();
    await box.fill("hello");
    await dialog.getByRole("button", { name: "Send comment" }).click();
    await expect(dialog.getByRole("listitem", { name: "You: hello" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close chat" }).click();
    await expect(dialog).toBeHidden();

    const b = await joinAs(browser, "Fay");
    await b.getByRole("button", { name: "Chat", exact: true }).click();
    const bBox = b.getByRole("textbox", { name: "Comment" });
    for (const text of ["hi from Fay", "and again"]) {
      await bBox.fill(text);
      await b.getByRole("button", { name: "Send comment" }).click();
      await expect(b.getByRole("listitem", { name: `You: ${text}` })).toBeVisible();
    }
    await expect(bBox).toBeFocused(); // sending keeps the keyboard up

    await expect(a.getByRole("button", { name: "Chat, 2 new" })).toBeVisible();
    // Two in a row from Fay: both lines, her name once.
    await a.getByRole("button", { name: "Chat, 2 new" }).click();
    await expect(dialog.getByRole("listitem", { name: "Fay: hi from Fay" })).toBeVisible();
    await expect(dialog.getByRole("listitem", { name: "Fay: and again" })).toBeVisible();
    await expect(dialog.getByText("Fay", { exact: true })).toHaveCount(1);
  });

  test("chat input: send needs text, count shows only near the limit, in characters", async ({ browser }) => {
    const page = await joinAs(browser, "Kim");
    await page.getByRole("button", { name: /^Chat/ }).click();
    const dialog = page.getByRole("dialog", { name: "Chat" });
    const box = dialog.getByRole("textbox", { name: "Comment" });
    const send = dialog.getByRole("button", { name: "Send comment" });

    await expect(send).toBeDisabled();
    await box.fill("   ");
    await expect(send).toBeDisabled();
    await box.fill("hey");
    await expect(send).toBeEnabled();
    await expect(box).toHaveAccessibleDescription("");

    // An emoji is one character (two UTF-16 units): 80 fit, 81 don't.
    await box.fill("😀".repeat(70));
    await expect(box).toHaveAccessibleDescription("10 characters left");
    await box.fill("😀".repeat(80));
    await expect(box).toHaveAccessibleDescription("0 characters left");
    await expect(send).toBeEnabled();
    await box.fill("😀".repeat(81));
    await expect(box).toHaveAccessibleDescription("1 over the limit");
    await expect(send).toBeDisabled();
  });

  test("volume nudge can be asked for and taken back", async ({ browser }) => {
    const page = await joinAs(browser, "Gus");
    const quieter = page.getByRole("button", { name: "Ask the host for quieter" });
    await quieter.click();
    await expect(page.getByRole("status").filter({ hasText: "You asked for quieter" })).toBeVisible();
    await quieter.click();
    await expect(page.getByRole("status").filter({ hasText: "You asked for quieter" })).toHaveCount(0);
  });

  test("sticky mini player appears past the artwork and scrolls back to top", async ({ browser }) => {
    const page = await joinAs(browser, "Hal");
    const mini = page.locator(".sticky-mini");
    const target = page.getByRole("button", { name: /Back to the top/ });
    await expect(mini).toHaveAttribute("aria-hidden", "true");
    await expect(target).toHaveCount(0); // hidden from the accessibility tree

    // A short phone, so even an empty queue leaves room to scroll past the art.
    await page.setViewportSize({ width: 390, height: 600 });
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(max).toBeGreaterThan(400);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(mini).toHaveAttribute("aria-hidden", "false");
    await expect(target).toBeVisible();

    await target.click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
    await expect(mini).toHaveAttribute("aria-hidden", "true");
  });
});

test.describe("search", () => {
  test("results, recent searches, clear, and paste a link", async ({ browser }) => {
    const page = await joinAs(browser, "Ivy");
    await page.getByRole("link", { name: "Add a song" }).click();
    const box = page.getByRole("searchbox", { name: "Search songs" });
    await box.fill("lofi");
    await box.press("Enter");
    await expect(page.getByRole("button", { name: "Add lofi Result 1", exact: true })).toBeVisible();

    await page.goto("/search");
    const recent = page.getByRole("region", { name: "Recent searches" });
    await expect(recent.getByText("lofi")).toBeVisible();

    await recent.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("heading", { name: "Recent searches" })).toHaveCount(0);
  });

  test("a link in the search box is offered as one card, not searched", async ({ browser }) => {
    const page = await joinAs(browser, "Lou");
    await page.getByRole("link", { name: "Add a song" }).click();
    const box = page.getByRole("searchbox", { name: "Search songs" });
    await box.fill("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    await expect(page.getByRole("button", { name: "Add to the queue" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Search in" })).toHaveCount(0);

    await box.fill("https://music.youtube.com/playlist?list=PLstub");
    await expect(page.getByRole("link", { name: "Open the playlist" })).toBeVisible();

    await box.fill("https://example.com/song");
    await expect(page.getByText("That isn’t a YouTube link")).toBeVisible();
    await page.getByRole("button", { name: "Search for it anyway" }).click();
    await expect(page.getByText("That isn’t a YouTube link")).toHaveCount(0);
  });

  test("the Saved heart keeps the typed words both ways", async ({ browser }) => {
    const page = await joinAs(browser, "Ola");
    await page.getByRole("link", { name: "Add a song" }).click();
    await page.getByRole("searchbox", { name: "Search songs" }).fill("lofi");
    await expect(page.getByRole("button", { name: "Add lofi Result 1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Saved", exact: true })).toHaveCount(0); // no chip any more

    await page.getByRole("link", { name: "Saved songs" }).click();
    await expect(page.getByRole("searchbox", { name: "Search your saved songs" })).toHaveValue("lofi");
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page.getByRole("searchbox", { name: "Search songs" })).toHaveValue("lofi");
  });

  test("a suggestion searches, the artist comes first, and their page adds songs", async ({ browser }) => {
    const page = await joinAs(browser, "Kai");
    await page.getByRole("link", { name: "Add a song" }).click();
    const box = page.getByRole("searchbox", { name: "Search songs" });
    await box.pressSequentially("stub", { delay: 30 });
    await page.getByRole("list", { name: "Suggestions" }).getByRole("button", { name: "stub live" }).click();
    await expect(box).toHaveValue("stub live");

    await page.getByRole("region", { name: "Artists" }).getByRole("link", { name: "Stub Artist" }).click();
    await expect(page.getByRole("heading", { name: "Stub Artist" })).toBeVisible();
    await page.getByRole("button", { name: "Add Stub Artist Hit 1", exact: true }).click();
    await expect(page.getByText("Queued")).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(box).toHaveValue("stub live");
  });

  test("header frost fades in as the page scrolls", async ({ browser }) => {
    const page = await joinAs(browser, "Jo");
    await page.goto("/search?q=lofi");
    await expect(page.getByRole("button", { name: "Add lofi Result 1", exact: true })).toBeVisible();
    const frost = () =>
      page.evaluate(() => Number(getComputedStyle(document.querySelector(".edge-top")!, "::before").opacity));
    expect(await frost()).toBeLessThan(0.05);
    await page.evaluate(() => window.scrollTo(0, 300));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(299);
    await expect.poll(frost).toBeGreaterThan(0.95);
  });
});

test.describe("lyrics", () => {
  test("the phone sheet and the room view follow the song", async ({ browser }) => {
    const page = await joinAs(browser, "Singer");
    await page.getByRole("button", { name: "Lyrics" }).click();
    const sheet = page.getByRole("dialog", { name: "Lyrics" });
    // The stub song sits at 0:42, so the line from 0:40 is the one being sung.
    await expect(sheet.locator("li[aria-current]")).toHaveText("Stub line 9");
    await expect(sheet.getByRole("img", { name: "Instrumental" })).toBeVisible();

    // Scrolling by hand stops the follow and offers the way back.
    await sheet.getByLabel("Lyrics", { exact: true }).last().hover();
    await page.mouse.wheel(0, -400);
    await sheet.getByRole("button", { name: "Back to now" }).click();
    await expect(sheet.getByRole("button", { name: "Back to now" })).toBeHidden();

    await sheet.getByRole("button", { name: "Close lyrics" }).click();
    await expect(sheet).toBeHidden();

    await page.goto("/room");
    await expect(page.getByRole("button", { name: "Lyrics" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("li[aria-current]")).toHaveText("Stub line 9");
    await page.getByRole("button", { name: "Up next" }).click();
    await expect(page.locator("li[aria-current]")).toHaveCount(0);
  });
});

test.describe("recap", () => {
  test("lists what played with faces, the most loved song and a playlist link", async ({ browser }) => {
    const page = await joinAs(browser, "Rex"); // by now the early faces are taken; Rex gets a free one
    await page.request.get("/api/search?q=party"); // the stub only knows songs it has returned
    expect((await page.request.post("/api/queue", { data: { videoId: "srch0000012" } })).ok()).toBe(true);
    const friend = await joinAs(browser, "Tess"); // Rex's own row just says "Yours"
    await expect(friend.getByText(/· \S+ Rex$/)).toBeVisible(); // face, then name

    await page.getByRole("button", { name: "React", exact: true }).click();
    await page.getByRole("button", { name: "Fire" }).click();
    await page.getByRole("link", { name: "Tonight’s recap" }).click();
    await expect(page.getByRole("heading", { name: "Test jam" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Most loved song" })).toContainText(NOW_TITLE);
    await expect(page.getByRole("region", { name: "Most loved song" })).toContainText("🔥");
    await expect(page.getByRole("region", { name: "What played" })).toContainText(NOW_TITLE);
    await expect(page.getByRole("link", { name: "Open as playlist" })).toHaveAttribute(
      "href",
      /^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=/,
    );
  });
});
