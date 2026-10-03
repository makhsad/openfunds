import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  createPlatformFixture,
  CREATOR,
  SPONSOR_A,
  SPONSOR_B,
  TITLE,
} from "./platform-fixture";

test("English-only site ignores a saved Russian preference across reload and navigation", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await page.addInitScript(() => {
    localStorage.setItem("openfunds-language-v1", "ru");
  });
  await fixture.attach(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=demo");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
  await expect(page.getByText("Explore demo", { exact: true })).toHaveCount(0);
  await expect(page.locator(".of-language-select")).toHaveCount(0);
  await expect(page.getByLabel(/Site language|Язык сайта/)).toHaveCount(0);
  await fixture.translate(page);
  await fixture.switchAccount(page, SPONSOR_A);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".of-language-select")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "My dashboard" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "Community projects" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: TITLE, exact: true }),
  ).toBeVisible();
  await page.goto("/projects/devnet/" + CREATOR);
  await expect(page).toHaveURL(
    new RegExp("/projects/" + fixture.legacy.campaignAddress + "$"),
  );
  await expect(page.getByText("3 SOL", { exact: true }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("creator publishes named project and sponsor sees same shared metadata", async ({
  page,
  browser,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page);
  await page.goto("/create");
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Проект для демонстрации");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Создаём общий проект для двух устройств.");
  await page.getByLabel(/Funding goal/).fill("1");
  await page
    .getByRole("button", {
      name: /Create project|Publish project/,
      exact: false,
    })
    .last()
    .click();
  await expect(page).toHaveURL(/\/projects\/[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(
    page.getByRole("heading", { name: "Проект для демонстрации", exact: true }),
  ).toBeVisible();
  const shared = page.url();
  const context = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const sponsor = await context.newPage();
  await fixture.attach(sponsor, SPONSOR_A);
  await sponsor.goto(shared);
  await expect(
    sponsor.getByRole("heading", {
      name: "Проект для демонстрации",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sponsor.getByText("Создаём общий проект для двух устройств.", {
      exact: true,
    }),
  ).toBeVisible();
  await context.close();
  expect(fixture.submissions[0].kind).toBe("initialize");
  expect(fixture.submissions[0].actor).toBe(CREATOR);
});

test("wallet menu remembers three accounts but dashboard follows active Phantom signer", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /My dashboard/ }),
  ).toBeVisible();
  await fixture.switchAccount(page, SPONSOR_A);
  await page
    .getByRole("tab", { name: "Supported projects", exact: true })
    .click();
  await expect(
    page
      .locator(".pf-card-personal div")
      .filter({ has: page.getByText("Your contribution", { exact: true }) })
      .getByText("0.1 SOL", { exact: true }),
  ).toBeVisible();
  await fixture.switchAccount(page, SPONSOR_B);
  await page
    .getByRole("tab", { name: "Supported projects", exact: true })
    .click();
  await expect(
    page
      .locator(".pf-card-personal div")
      .filter({ has: page.getByText("Your contribution", { exact: true }) })
      .getByText("0.2 SOL", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wallets", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "My wallets" }),
  ).toBeVisible();
  await expect(dialog.getByLabel(/Wallet label/)).toHaveCount(3);
  await expect(dialog.getByText(SPONSOR_B, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close wallets" }).click();
  await fixture.switchAccount(page, CREATOR);
  await expect(
    page.getByRole("link", { name: TITLE, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your funds in the project", { exact: true }),
  ).toHaveCount(0);
});

test("public project and profile remain readable without Phantom, no horizontal overflow", async ({
  page,
}, testInfo) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page, null);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await expect(
    page.getByRole("heading", { name: TITLE, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Install Phantom", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("shared-project.png"),
    fullPage: true,
  });
  await page.goto("/profile/" + CREATOR);
  await expect(
    page.getByRole("heading", { name: "Participant profile", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: TITLE, exact: true }),
  ).toBeVisible();
});

test("missing program upgrade is visible and prevents false project creation", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ capability: false });
  await fixture.attach(page);
  await page.goto("/create");
  await expect(
    page.getByText(/The new program version is not active/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Create project|Publish project/ }).last(),
  ).toBeDisabled();
  expect(fixture.submissions).toEqual([]);
});
