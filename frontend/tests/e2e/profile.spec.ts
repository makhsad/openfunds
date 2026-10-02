import { expect, test } from "@playwright/test";
import { createPlatformFixture, SPONSOR_A, TITLE } from "./platform-fixture";

test("public sponsor profile shows that participant's shared contribution without Phantom", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page, null);
  await page.goto("/profile/" + SPONSOR_A);
  await expect(
    page.getByRole("heading", { name: "Профиль участника", exact: true }),
  ).toBeVisible();
  const project = page
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: TITLE, exact: true }) });
  await expect(
    project.getByText("Взнос участника", { exact: true }),
  ).toBeVisible();
  await expect(
    project
      .locator(".pf-card-personal div")
      .filter({ has: page.getByText("Взнос участника", { exact: true }) })
      .getByText("0.1 SOL", { exact: true }),
  ).toBeVisible();
  await expect(project.getByText("Ваш взнос", { exact: true })).toHaveCount(0);
  expect(fixture.submissions).toEqual([]);
});
