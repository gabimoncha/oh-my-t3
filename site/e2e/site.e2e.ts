import { expect, type Page, test } from "@playwright/test";

// Ends the running CSS animations inside a host at once. A clock that ends this way still fires
// animationend, so the hero and the skill tour move on as they do in real time.
async function finishAnimations(page: Page, host: string) {
  await page.locator(host).evaluate((node) => {
    for (const animation of node.getAnimations({ subtree: true })) {
      if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    }
  });
}

const states = (page: Page) => page.locator(".hero-run").evaluateAll((runs) => runs.map((run) => run.getAttribute("data-state")));

test("the page renders with no errors and no sideways scroll", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Give the agent a goal\.\s*Get back reviewed work\./);
  for (const name of ["Install", "How it works", "Skills", "Who it is for"]) {
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(page.locator("#skills")).toContainText("plan-review, grill, review, oracle");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("an unknown path returns the 404 page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the hero plays ulw, then swarm, then offers Play again", async ({ page }) => {
  await page.goto("/");
  await page.locator(".hero-runs").scrollIntoViewIfNeeded();
  await expect(page.locator(".hero-runs")).toHaveAttribute("data-play", "");
  await expect.poll(() => states(page)).toEqual(["playing", "waiting"]);
  await finishAnimations(page, ".hero-runs");
  await expect.poll(() => states(page)).toEqual(["done", "playing"]);
  await finishAnimations(page, ".hero-runs");
  await expect.poll(() => states(page)).toEqual(["done", "done"]);
  await page.getByRole("button", { name: "Play again" }).click();
  await expect.poll(() => states(page)).toEqual(["playing", "waiting"]);
});

test("install defaults to Bun, and a one-shot run allows only the project install", async ({ page }) => {
  await page.goto("/");
  const channels = page.getByRole("tablist", { name: "Install channel" });
  const scopes = page.getByRole("tablist", { name: "Install scope" });
  await expect(channels.getByRole("tab", { selected: true })).toHaveText("Bun");
  await expect(page.locator("#install")).toContainText("bun add -g oh-my-t3code");
  await expect(page.locator("#install")).toContainText("omt install --hooks");

  await channels.getByRole("tab", { name: "Bun" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(channels.getByRole("tab", { name: "pnpm" })).toBeFocused();
  await expect(channels.getByRole("tab", { selected: true })).toHaveText("pnpm");

  await channels.getByRole("tab", { name: "Run once" }).click();
  await expect(scopes.getByRole("tab", { name: "All projects" })).toHaveAttribute("aria-disabled", "true");
  await expect(scopes.getByRole("tab", { selected: true })).toHaveText("One project");
  await expect(page.locator("#install")).toContainText("# in the folder of your project");
  await expect(page.locator("#install")).toContainText("npx omt3 install --project --hooks");
});

test("the skill tour moves the pointer by itself and stops on a click", async ({ page }) => {
  await page.goto("/");
  const tour = page.locator(".skill-tour");
  const rows = page.getByRole("tab").filter({ has: page.locator(".skill-name") });
  await expect(rows.locator(".skill-name code")).toHaveText([
    "omt-ulw",
    "omt-plan",
    "omt-grill",
    "omt-design",
    "omt-code-review",
    "omt-research",
    "omt-help",
    "omt-setup",
    "omt-swarm",
    "omt",
  ]);
  await tour.scrollIntoViewIfNeeded();
  await expect(tour).toHaveAttribute("data-play", "");
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
  await finishAnimations(page, ".skill-tour");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");

  await rows.nth(5).click();
  await expect(rows.nth(5)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".skill-stage figcaption")).toContainText("searches the repository");
  await finishAnimations(page, ".skill-tour");
  await expect(rows.nth(5)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(6)).toBeFocused();
  await expect(rows.nth(6)).toHaveAttribute("aria-selected", "true");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("every picture shows its last frame, and nothing moves on by itself", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hero-runs").scrollIntoViewIfNeeded();
    const swarm = page.locator(".hero-run").nth(1).locator(".hero-art");
    await expect(swarm).toHaveCSS("opacity", "1");
    const line = swarm.locator(".m-seg").first();
    await expect(line).toHaveCSS("stroke-dashoffset", "0px");

    await page.locator(".skill-tour").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await expect(page.locator('.skill-row[aria-selected="true"] code')).toHaveText("omt-ulw");
    for (const token of await page.locator(".unit-token").all()) await expect(token).toBeHidden();
  });
});
