import { expect, test } from "@playwright/test";
import { createPlatformFixture } from "./platform-fixture";

const activateName = "Activate after the program upgrade";

test("operator setup performs no transaction on mount and activates only after an explicit Phantom action", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ capability: false });
  await fixture.attach(page);
  await page.goto("/setup");
  const activate = page.getByRole("button", { name: activateName });
  await expect(activate).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(activate).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
  await activate.click();
  await expect(
    page.getByText(
      "The platform is activated. Project creation, chat and refunds are available.",
    ),
  ).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.submissions[0].kind).toBe("platform");
  await expect(
    page.getByRole("link", { name: "Open transaction in Explorer" }),
  ).toBeVisible();
  await expect(activate).toHaveCount(0);
});

test("already activated setup is read-only and uses the English site interface", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page);
  await page.goto("/setup");
  await expect(
    page.getByText(
      "The platform is activated. Project creation, chat and refunds are available.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: activateName })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".of-language-select")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Platform activation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(
    page.getByText(
      "The platform is activated. Project creation, chat and refunds are available.",
    ),
  ).toBeVisible();
  expect(fixture.submissions).toHaveLength(0);
});

test("cancelled operator activation remains unactivated and does not silently retry", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ capability: false });
  await fixture.attach(page);
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: activateName })).toBeEnabled();
  await fixture.outcomes(page, ["cancel"]);
  await page.getByRole("button", { name: activateName }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Phantom confirmation was cancelled",
  );
  await expect(page.getByRole("button", { name: activateName })).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
});

test("pending operator activation retains its Explorer receipt across reload and readonly checks never resubmit", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ capability: false });
  await fixture.attach(page);
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: activateName })).toBeEnabled();
  await fixture.outcomes(page, ["pending"]);
  await page.getByRole("button", { name: activateName }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "The transaction was submitted",
  );
  const explorer = page.getByRole("link", {
    name: "Open transaction in Explorer",
  });
  await expect(explorer).toBeVisible();
  const receipt = await explorer.getAttribute("href");
  await expect(page.getByRole("button", { name: activateName })).toBeDisabled();
  expect(fixture.submissions).toHaveLength(1);
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "The transaction link is retained; no new transaction was sent.",
  );
  expect(fixture.submissions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open transaction in Explorer" }),
  ).toHaveAttribute("href", receipt!);
  await expect(page.getByRole("button", { name: activateName })).toBeDisabled();
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "The transaction link is retained; no new transaction was sent.",
  );
  expect(fixture.submissions).toHaveLength(1);
  await fixture.confirmPending();
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect(
    page.getByText(
      "The platform is activated. Project creation, chat and refunds are available.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: activateName })).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(1);
});
