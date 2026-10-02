import { expect, test } from "@playwright/test";
import { createPlatformFixture, TITLE } from "./platform-fixture";

test("keyboard user reaches project and site language without browser translation", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/projects");
  await expect(
    page.getByRole("link", { name: TITLE, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержимому" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.getByLabel("Язык сайта").selectOption("en");
  await fixture.translate(page);
  await page.getByRole("link", { name: TITLE, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: TITLE, exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("translate", "no");
  expect(errors).toEqual([]);
});
