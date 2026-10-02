import { expect, test } from "@playwright/test";
import { createPlatformFixture } from "./platform-fixture";

const activateName = "Активировать после обновления программы";

test("operator setup performs no transaction on mount and activates only after an explicit Phantom action", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ capability: false });
  await fixture.attach(page);
  await page.goto("/setup");
  const activate = page.getByRole("button", { name: activateName });
  await expect(activate).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
  await page.getByRole("button", { name: "Обновить состояние" }).click();
  await expect(activate).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
  await activate.click();
  await expect(
    page.getByText(
      "Платформа активирована. Создание проектов, чат и возвраты доступны.",
    ),
  ).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.submissions[0].kind).toBe("platform");
  await expect(
    page.getByRole("link", { name: "Открыть операцию в Explorer" }),
  ).toBeVisible();
  await expect(activate).toHaveCount(0);
});

test("already activated setup is read-only and supports the native site language", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page);
  await page.goto("/setup");
  await expect(
    page.getByText(
      "Платформа активирована. Создание проектов, чат и возвраты доступны.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: activateName })).toHaveCount(0);
  await page.getByLabel("Язык сайта").selectOption("en");
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
    "Подтверждение в Phantom отменено",
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
    "Транзакция отправлена",
  );
  const explorer = page.getByRole("link", {
    name: "Открыть операцию в Explorer",
  });
  await expect(explorer).toBeVisible();
  const receipt = await explorer.getAttribute("href");
  await expect(page.getByRole("button", { name: activateName })).toBeDisabled();
  expect(fixture.submissions).toHaveLength(1);
  await page.getByRole("button", { name: "Проверить подтверждение" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Ссылка на операцию сохранена; новая транзакция не отправлялась.",
  );
  expect(fixture.submissions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Открыть операцию в Explorer" }),
  ).toHaveAttribute("href", receipt!);
  await expect(page.getByRole("button", { name: activateName })).toBeDisabled();
  await page.getByRole("button", { name: "Проверить подтверждение" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Ссылка на операцию сохранена; новая транзакция не отправлялась.",
  );
  expect(fixture.submissions).toHaveLength(1);
  await fixture.confirmPending();
  await page.getByRole("button", { name: "Проверить подтверждение" }).click();
  await expect(
    page.getByText(
      "Платформа активирована. Создание проектов, чат и возвраты доступны.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: activateName })).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(1);
});
