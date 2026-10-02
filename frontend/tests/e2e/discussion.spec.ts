import { expect, test } from "@playwright/test";
import {
  createPlatformFixture,
  SPONSOR_A,
  SPONSOR_B,
  TITLE,
} from "./platform-fixture";

test("sponsor message is shared with author and survives reload", async ({
  page,
  browser,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await page.getByRole("tab", { name: "Чат", exact: true }).click();
  await page
    .getByLabel("Ваше сообщение")
    .fill("Поддержали проект. Когда начнём?");
  await page.getByRole("button", { name: "Опубликовать сообщение" }).click();
  await expect(
    page.getByText("Поддержали проект. Когда начнём?", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const author = await context.newPage();
  await fixture.attach(author);
  await author.goto(page.url());
  await author.getByRole("tab", { name: "Чат", exact: true }).click();
  await expect(
    author.getByText("Поддержали проект. Когда начнём?", { exact: true }),
  ).toBeVisible();
  await author.reload();
  await author.getByRole("tab", { name: "Чат", exact: true }).click();
  await expect(
    author.getByText("Поддержали проект. Когда начнём?", { exact: true }),
  ).toBeVisible();
  await context.close();
  expect(fixture.submissions[0].actor).toBe(SPONSOR_A);
});

test("cancelled chat keeps draft and outsider cannot post", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await page.getByRole("tab", { name: "Чат", exact: true }).click();
  await page
    .getByLabel("Ваше сообщение")
    .fill("Это сообщение осталось черновиком");
  await fixture.outcomes(page, ["cancel"]);
  await page.getByRole("button", { name: "Опубликовать сообщение" }).click();
  await expect(page.getByLabel("Ваше сообщение")).toHaveValue(
    "Это сообщение осталось черновиком",
  );
  expect(fixture.projects.get(fixture.first.campaignAddress)?.messages).toBe(
    0n,
  );
  await fixture.switchAccount(page, "11111111111111111111111111111111");
  await page.getByRole("tab", { name: "Чат", exact: true }).click();
  await expect(
    page.getByText(/Поддержите проект, чтобы присоединиться/),
  ).toBeVisible();
  await expect(page.getByLabel("Ваше сообщение")).toHaveCount(0);
});

test("closed discussion is an archive and disallows new messages", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true, closed: true });
  await fixture.attach(page, SPONSOR_B);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await page.getByRole("tab", { name: "Чат", exact: true }).click();
  await expect(page.getByText(/Чат сохранён для просмотра/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Опубликовать сообщение" }),
  ).toHaveCount(0);
});
