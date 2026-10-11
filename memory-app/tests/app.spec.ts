import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const nav = async (page: Page, name: string) =>
  page
    .getByRole("navigation")
    .filter({ visible: true })
    .getByRole("button", { name, exact: true })
    .click();
const data = async (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("memory-cards:v2")!));
const overflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

test("singular self-assessment preserves typed answer and persists schedule", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Singular", exact: true }).click();
  await page.getByLabel("Your answer (optional)").fill("my own attempt");
  await page.getByRole("button", { name: "Flip card", exact: true }).click();
  await expect(page.getByLabel("Your answer (optional)")).toHaveValue(
    "my own attempt",
  );
  await page.getByRole("button", { name: /Hard/ }).click();
  expect((await data(page)).reviews).toHaveLength(1);
  expect((await data(page)).reviews[0].result).toBe("almost");
  expect(JSON.stringify(await data(page))).not.toContain("my own attempt");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Your answer (optional)")).toHaveValue("");
  await overflow(page);
  await page.screenshot({
    path: `test-results/home-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "More");
  await expect(page.locator(".activity-total")).toContainText("1");
  expect(errors).toEqual([]);
});

test("manual cards, draft recovery, metadata, search, edit and archive", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "Cards");
  await expect(page.getByLabel("Search cards")).toBeVisible();
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await page.getByLabel("Front headline", { exact: true }).fill("بَيْت");
  await page.getByLabel("Back headline", { exact: true }).fill("house");
  await page.getByLabel("Front description (optional)").fill("Test context");
  await page.getByLabel("Category (optional)").selectOption("Vocab");
  await page.getByLabel("Part of speech (optional)").selectOption("Noun");
  await nav(page, "Tools");
  await nav(page, "Cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue(
    "بَيْت",
  );
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await page.getByLabel("Search cards").fill("بيت");
  await expect(page.locator(".card-row")).toHaveCount(1);
  await page.locator(".card-row").click();
  await page.getByLabel("Back headline", { exact: true }).fill("a house");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(page.locator(".card-row")).toContainText("a house");
  await page.locator(".card-row").click();
  await page.getByRole("button", { name: "Archive card", exact: true }).click();
  await expect(page.locator(".card-row")).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  await expect(page.locator(".card-row")).toHaveCount(1);
  await overflow(page);
});

test("matching five pairs and multiple choice schedule the correct cards", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Matching", exact: true }).click();
  const state = await data(page);
  const round = state.round;
  const first = round.cardIds[0],
    wrong = round.cardIds[1];
  const front = (id: string) =>
    state.cards.find((c: any) => c.id === id).front.headline;
  const back = (id: string) =>
    state.cards.find((c: any) => c.id === id).back.headline;
  await page
    .locator(".matching-columns>div")
    .nth(0)
    .getByRole("button", { name: front(first), exact: true })
    .click();
  await page
    .locator(".matching-columns>div")
    .nth(1)
    .getByRole("button", { name: back(wrong), exact: true })
    .click();
  await expect(page.getByText("Not a match. Try again.")).toBeVisible();
  await page.screenshot({
    path: `test-results/matching-${info.project.name}.png`,
    fullPage: true,
  });
  for (const id of round.cardIds) {
    await page
      .locator(".matching-columns>div")
      .nth(0)
      .getByRole("button", { name: front(id), exact: true })
      .click();
    await page
      .locator(".matching-columns>div")
      .nth(1)
      .getByRole("button", { name: back(id), exact: true })
      .click();
  }
  expect((await data(page)).reviews).toHaveLength(5);
  expect(
    (await data(page)).reviews.find((r: any) => r.cardId === first).result,
  ).toBe("almost");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No cards due" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Multiple choice", exact: true })
    .click();
  await page.getByRole("button", { name: "Practice now", exact: true }).click();
  const current = await data(page),
    r = current.round;
  expect(await page.locator(".choice-option").count()).toBe(4);
  const index = r.choiceIds.indexOf(r.cardIds[0]);
  await page.locator(".choice-option").nth(index).click();
  expect((await data(page)).reviews.at(-1).result).toBe("correct");
  expect((await data(page)).reviews.at(-1).scheduled).toBe(false);
  await overflow(page);
});

test("translation suggestions are editable, quota failures preserve input, and links persist", async ({
  page,
}) => {
  await page.route("https://api.mymemory.translated.net/**", (route) =>
    route.fulfill({
      json: {
        responseStatus: 200,
        responseData: { translatedText: "بَيْت" },
        quotaFinished: false,
      },
    }),
  );
  await page.goto("/");
  await nav(page, "Cards");
  await page.getByLabel("Search cards").fill("house");
  await page.getByRole("button", { name: "Translate to new card" }).click();
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue(
    "بَيْت",
  );
  await page.getByLabel("Front headline", { exact: true }).fill("بيت");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await data(page)).cards.at(-1).front.headline).toBe("بيت");
  await nav(page, "Tools");
  await page.getByLabel("English text").fill("house");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByLabel("Translation (editable)")).toHaveValue("بَيْت");
  await page.getByLabel("Translation (editable)").fill("بيت");
  await page.getByRole("button", { name: "Use in a card" }).click();
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue(
    "بيت",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await nav(page, "Tools");
  await page.unroute("https://api.mymemory.translated.net/**");
  await page.route("https://api.mymemory.translated.net/**", (route) =>
    route.fulfill({ json: { responseStatus: 429, quotaFinished: true } }),
  );
  await page.getByLabel("English text").fill("camel");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("quota");
  await expect(page.getByLabel("English text")).toHaveValue("camel");
  for (const title of ["Book companion", "Book audio player"]) {
    await page
      .locator(".resource-card")
      .filter({ hasText: title })
      .getByRole("button", { name: "Add link" })
      .click();
    await page
      .getByLabel("Website URL")
      .fill(
        "https://example.com/" +
          (title === "Book companion" ? "book" : "audio"),
      );
    await page.getByRole("button", { name: "Save link" }).click();
  }
  await page.reload();
  await nav(page, "Tools");
  await expect(
    page
      .locator(".resource-card")
      .filter({ hasText: "Book companion" })
      .getByRole("link", { name: "Open", exact: true }),
  ).toHaveAttribute("href", "https://example.com/book");
  await expect(
    page
      .locator(".resource-card")
      .filter({ hasText: "Book audio player" })
      .getByRole("link", { name: "Open", exact: true }),
  ).toHaveAttribute("href", "https://example.com/audio");
});

test("theme, backup, narrow layout, and accessibility", async ({
  page,
}, info) => {
  await page.goto("/");
  const audit = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  await audit();
  await nav(page, "Cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await audit();
  await overflow(page);
  await page.screenshot({
    path: `test-results/cards-${info.project.name}.png`,
    fullPage: true,
  });
  await nav(page, "Tools");
  await audit();
  await nav(page, "More");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await audit();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export cards & progress" }).click();
  const file = await (await pending).path();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByLabel("Restore backup file").setInputFiles(file!);
  await page.getByRole("button", { name: "Replace and restore" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 360, height: 800 });
  await overflow(page);
  await page.screenshot({
    path: `test-results/light-${info.project.name}.png`,
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Singular", exact: true }).click();
  expect(
    await page
      .locator(".study-card")
      .evaluate((el) => getComputedStyle(el).transform),
  ).toBe("none");
});

test("card editor translates English, preserves edits on failure, and saves overrides", async ({ page }) => {
  await page.route("https://api.mymemory.translated.net/**", route => route.fulfill({
    json: { responseStatus: 200, responseData: { translatedText: "بَيْت" } },
  }));
  await page.goto("/");
  await nav(page, "Cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  const button = page.getByRole("button", { name: "Translate to Arabic", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("Back headline", { exact: true }).fill("house");
  await page.getByLabel("Front description (optional)").fill("My note");
  await button.click();
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue("بَيْت");
  await page.getByLabel("Front headline", { exact: true }).fill("بيت");
  await page.unroute("https://api.mymemory.translated.net/**");
  await page.route("https://api.mymemory.translated.net/**", route => route.fulfill({ json: { responseStatus: 429 } }));
  await button.click();
  await expect(page.getByRole("alert")).toContainText("quota");
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue("بيت");
  await expect(page.getByLabel("Back headline", { exact: true })).toHaveValue("house");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  const saved = (await data(page)).cards.at(-1);
  expect(saved.front.headline).toBe("بيت");
  expect(saved.front.description).toBe("My note");
  expect(saved.back.headline).toBe("house");
});

test("suggested labels require applying, remain editable, and survive saving", async ({ page }, info) => {
  await page.route("https://api.mymemory.translated.net/**", route => route.fulfill({
    json: { responseStatus: 200, responseData: { translatedText: "جَمِيل" } },
  }));
  await page.goto("/");
  await nav(page, "Cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await page.getByLabel("Back headline", { exact: true }).fill("beautiful");
  await page.getByLabel("Category (optional)", { exact: true }).selectOption("Grammar");
  await page.getByLabel("Part of speech (optional)", { exact: true }).selectOption("Pronoun");
  await page.getByRole("button", { name: "Translate to Arabic", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply Vocab · Adjective", exact: true })).toBeVisible();
  await expect(page.getByLabel("Category (optional)", { exact: true })).toHaveValue("Grammar");
  await expect(page.getByLabel("Part of speech (optional)", { exact: true })).toHaveValue("Pronoun");
  await page.getByRole("button", { name: "Apply Vocab · Adjective", exact: true }).click();
  await expect(page.getByLabel("Part of speech (optional)", { exact: true })).toHaveValue("Adjective");
  await page.screenshot({ path: `test-results/labels-${info.project.name}.png`, fullPage: true });
  await overflow(page);
  await page.getByLabel("Back headline", { exact: true }).fill("asdfgh");
  await expect(page.getByLabel("Suggested labels")).toContainText("No confident suggestion");
  await expect(page.getByRole("button", { name: "Apply Vocab · Adjective", exact: true })).toHaveCount(0);
  await page.getByLabel("Back headline", { exact: true }).fill("beautiful");
  await page.getByLabel("Part of speech (optional)", { exact: true }).selectOption("Phrase");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await page.reload();
  expect((await data(page)).cards.at(-1).partOfSpeech).toBe("Phrase");
});

test("Arabic to English tools suggestions carry into the editable card", async ({ page }) => {
  await page.route("https://api.mymemory.translated.net/**", route => route.fulfill({
    json: { responseStatus: 200, responseData: { translatedText: "teacher" } },
  }));
  await page.goto("/");
  await nav(page, "Tools");
  await page.getByLabel("Translation direction").selectOption("ar");
  await page.getByLabel("Arabic text", { exact: true }).fill("معلم");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByLabel("Suggested labels")).toContainText("Vocab · Noun");
  await page.getByLabel("Translation (editable)").fill("beautiful");
  await expect(page.getByLabel("Suggested labels")).toContainText("Vocab · Adjective");
  await page.getByRole("button", { name: "Use in a card" }).click();
  await page.getByRole("button", { name: "Apply Vocab · Adjective", exact: true }).click();
  await expect(page.getByLabel("Part of speech (optional)", { exact: true })).toHaveValue("Adjective");
});

test("translation remains usable when label suggestions cannot load", async ({ page }) => {
  await page.route("**/label-suggestions-*.js", route => route.abort());
  await page.route("https://api.mymemory.translated.net/**", route => route.fulfill({
    json: { responseStatus: 200, responseData: { translatedText: "معلم" } },
  }));
  await page.goto("/");
  await nav(page, "Cards");
  await page.getByLabel("Search cards").fill("teacher");
  await page.getByRole("button", { name: "Translate to new card" }).click();
  await expect(page.getByLabel("Suggested labels")).toContainText("Suggestions unavailable");
  await expect(page.getByLabel("Front headline", { exact: true })).toHaveValue("معلم");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await data(page)).cards.at(-1).back.headline).toBe("teacher");
});
