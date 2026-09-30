import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function connect(page: Page) {
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await expect(
    page.getByText("Demo wallet connected.", { exact: false }),
  ).toBeVisible();
}

async function controls(page: Page) {
  await page.getByText("Demo controls", { exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Fund ideas. Build together.",
  );
});

test("voting page is responsive, accessible and has the agreed balances", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Fund ideas. Build together.",
  );
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCSS(
    "outline-style",
    "solid",
  );
  await page.keyboard.press("Tab");
  const stats = page.getByRole("region", {
    name: "Project funding statistics",
  });
  await expect(stats).toContainText("0.1 SOL");
  await expect(stats).toContainText("0.08 SOL");
  await expect(stats).toContainText("0.02 SOL");
  await expect(
    page.getByRole("button", { name: "Funding closed", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("progressbar", { name: "Funding progress" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator(".vote-results")).toContainText(
    "Approve45%Reject15%Not voted40%",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      ({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("campaign.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("layout stays within narrow phone, tablet and laptop viewports", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Viewport coverage runs once in Chromium.",
  );
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `overflow at ${width}px`,
    ).toBe(true);
  }
});

test("approve is weighted against the fixed snapshot and cannot be repeated", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("You voted approve. Your vote is recorded."),
  ).toBeVisible();
  await expect(page.locator(".vote-results")).toContainText(
    "Approve65%Reject15%Not voted20%",
  );
  await expect(
    page.getByText("Approval threshold reached.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Approve vote", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disconnect demo wallet" }).click();
  await connect(page);
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
});

test("reject leaves approval weight unchanged", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("You voted reject. Your vote is recorded."),
  ).toBeVisible();
  await expect(page.locator(".vote-results")).toContainText(
    "Approve45%Reject35%Not voted20%",
  );
});

test("funding validates input, supports exact amounts and keeps a consistent wallet balance", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Funding", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect to support" }),
  ).toBeEnabled();
  await connect(page);
  const input = page.getByLabel("Your contribution");
  await input.fill("0.0000000001");
  await page
    .getByRole("button", { name: "Support Project", exact: true })
    .click();
  await expect(page.locator("#amount-error")).toContainText(
    "up to 9 decimal places",
  );
  await page.getByRole("button", { name: "0.1 SOL", exact: true }).click();
  await page
    .getByRole("button", { name: "Support Project", exact: true })
    .click();
  await expect(page.locator("#amount-error")).toContainText("up to 0.06 SOL");
  await page.getByRole("button", { name: "0.01 SOL", exact: true }).click();
  await page
    .getByRole("button", { name: "Support Project", exact: true })
    .click();
  await expect(
    page.getByText("0.01 SOL added to the demo vault.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Demo balance: 0.11 SOL", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      ({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("funding.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Disconnect demo wallet" }).click();
  await connect(page);
  await expect(
    page.getByText("Demo balance: 0.11 SOL", { exact: false }),
  ).toBeVisible();
  await input.fill("0.05");
  await page
    .getByRole("button", { name: "Support Project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Funding closed", exact: true }),
  ).toBeDisabled();
});

test("errors, simulated cancellation and manual cancellation do not cast a vote", async ({
  page,
}) => {
  await connect(page);
  await controls(page);
  await page.getByLabel("Operation outcome").selectOption("error");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator(".operation-notice")).toContainText(
    "Nothing changed",
  );
  await expect(page.locator(".vote-results")).toContainText("Approve45%");
  await page.getByLabel("Operation outcome").selectOption("cancel");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Operation cancelled");
  await page.getByLabel("Operation outcome").selectOption("success");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Operation cancelled");
  await expect(page.locator(".vote-results")).toContainText(
    "Approve45%Reject15%Not voted40%",
  );
});

test("connection failures can be retried, empty/loading history and keyboard navigation work", async ({
  page,
}) => {
  await controls(page);
  await page.getByLabel("Operation outcome").selectOption("error");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await expect(page.locator(".operation-notice")).toContainText("failed");
  await expect(
    page.getByRole("button", { name: "Connect Wallet", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Operation outcome").selectOption("success");
  await connect(page);
  await page.getByLabel("History preview").selectOption("empty");
  await expect(
    page.getByRole("heading", { name: "No activity yet" }),
  ).toBeVisible();
  await page.getByLabel("History preview").selectOption("loading");
  await expect(page.getByText("Loading transaction history…")).toBeAttached();
  await page.getByLabel("History preview").selectOption("normal");
  await expect(page.getByRole("table")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Milestones", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#milestones$/);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(
    page.getByRole("button", { name: "Connect Wallet", exact: true }),
  ).toBeEnabled();
});
