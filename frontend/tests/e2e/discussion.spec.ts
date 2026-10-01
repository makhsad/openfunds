import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const discussion = (page: Page) =>
  page.getByRole("region", { name: "Project Discussion", exact: true });
const posts = (page: Page) => discussion(page).getByRole("article");
const composer = (page: Page) => discussion(page).getByRole("textbox");
const send = (page: Page) =>
  discussion(page).getByRole("button", { name: "Send message", exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Fund ideas.",
  );
  await page.getByText("Demo controls", { exact: true }).click();
});

test("all four roles are independent of wallet and canPost gates creator updates", async ({
  page,
}) => {
  await expect(posts(page)).toHaveCount(5);
  await expect(discussion(page)).toContainText(
    "Connect your wallet to join the discussion.",
  );
  await expect(composer(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await expect(
    page.getByText("Demo wallet connected.", { exact: false }),
  ).toBeVisible();
  await expect(discussion(page)).toContainText(
    "Connect your wallet to join the discussion.",
  );
  await page.getByLabel("Discussion role").selectOption("connected_non_backer");
  await expect(discussion(page)).toContainText(
    "Support this project to join the discussion.",
  );
  await expect(composer(page)).toHaveCount(0);
  await page.getByLabel("Discussion role").selectOption("backer");
  await expect(composer(page)).toBeVisible();
  await expect(
    discussion(page).getByRole("button", {
      name: "Project Update",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("Allow discussion posting").uncheck();
  await expect(composer(page)).toHaveCount(0);
  await page.getByLabel("Discussion role").selectOption("creator");
  await expect(discussion(page)).toContainText("Posting is currently disabled");
  await expect(
    discussion(page).getByRole("button", {
      name: "Project Update",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("Allow discussion posting").check();
  await expect(
    discussion(page).getByRole("button", {
      name: "Project Update",
      exact: true,
    }),
  ).toBeVisible();
});

test("backer sends once, rejects whitespace, renders HTML as text and clears only on success", async ({
  page,
}) => {
  await page.getByLabel("Discussion role").selectOption("backer");
  await composer(page).fill("  \n  ");
  await expect(send(page)).toBeDisabled();
  const text = '<img src="x" onerror="alert(1)"> Plain text only';
  await composer(page).fill(text);
  await send(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    discussion(page).getByRole("button", { name: "Sending…" }),
  ).toBeDisabled();
  await expect(composer(page)).toBeDisabled();
  await expect(posts(page)).toHaveCount(6);
  await expect(posts(page).last()).toContainText(text);
  await expect(discussion(page).locator("img")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("");
  await expect(send(page)).toBeDisabled();
  await page.reload();
  await expect(posts(page)).toHaveCount(5);
});

test("creator can post messages and highlighted updates; mobile layout and accessibility", async ({
  page,
}, testInfo) => {
  await page.getByLabel("Discussion role").selectOption("creator");
  await composer(page).fill("The next milestone checklist is ready.");
  await send(page).click();
  await expect(posts(page)).toHaveCount(6);
  await expect(posts(page).last()).not.toHaveClass(/discussion-update/);
  await discussion(page)
    .getByRole("button", { name: "Project Update", exact: true })
    .click();
  await composer(page).fill("Project progress: " + "a".repeat(150));
  await discussion(page)
    .getByRole("button", { name: "Publish Project Update" })
    .click();
  await expect(posts(page)).toHaveCount(7);
  await expect(posts(page).last()).toHaveClass(/discussion-update/);
  await expect(posts(page).last()).toContainText("Creator");
  await expect(composer(page)).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("#discussion").analyze()
  ).violations;
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  await discussion(page).screenshot({
    path: testInfo.outputPath("discussion.png"),
    scale: "css",
  });
});

test("errors and cancellation retain the draft for retry without inserting posts", async ({
  page,
}) => {
  await page.getByLabel("Discussion role").selectOption("backer");
  for (const outcome of ["error", "cancel"]) {
    await page.getByLabel("Operation outcome").selectOption(outcome);
    await composer(page).fill("Please keep this draft.");
    await send(page).click();
    await expect(discussion(page).getByRole("alert")).toContainText(
      "draft is saved",
    );
    await expect(composer(page)).toHaveValue("Please keep this draft.");
    await expect(posts(page)).toHaveCount(5);
  }
  await page.getByLabel("Operation outcome").selectOption("success");
  await send(page).click();
  await expect(posts(page)).toHaveCount(6);
  await expect(composer(page)).toHaveValue("");
});

test("project and campaign switches isolate messages, drafts and late completions", async ({
  page,
}) => {
  await page.getByLabel("Discussion role").selectOption("backer");
  await composer(page).fill("Only for Community Project campaign one.");
  await send(page).click();
  await page.getByLabel("Discussion context").selectOption("1");
  await expect(composer(page)).toHaveValue("");
  await expect(posts(page)).toHaveCount(5);
  await expect(discussion(page)).toContainText(
    "Welcome to the garden project.",
  );
  await composer(page).fill("Garden draft stays here.");
  await expect(page.getByLabel("Discussion role")).toBeEnabled();
  await expect(composer(page)).toHaveValue("Garden draft stays here.");
  await expect(posts(page)).toHaveCount(5);
  await send(page).click();
  await expect(posts(page)).toHaveCount(6);
  await page.getByLabel("Discussion context").selectOption("2");
  await expect(composer(page)).toHaveValue("");
  await expect(posts(page)).toHaveCount(5);
  await expect(discussion(page)).toContainText(
    "Welcome to the second campaign.",
  );
  await composer(page).fill("Second campaign draft");
  await page.getByLabel("Discussion context").selectOption("0");
  await expect(composer(page)).toHaveValue("");
  await expect(posts(page)).toHaveCount(6);
  await expect(posts(page).last()).toContainText(
    "Only for Community Project campaign one.",
  );
  await expect(discussion(page)).not.toContainText("Garden draft stays here.");
  await expect(discussion(page)).not.toContainText("Second campaign draft");
  await page.getByLabel("Discussion context").selectOption("1");
  await expect(posts(page).last()).toContainText("Garden draft stays here.");
});
