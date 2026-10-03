import { expect, test } from "@playwright/test";
import {
  createPlatformFixture,
  CREATOR,
  SPONSOR_A,
  SPONSOR_B,
  TITLE,
} from "./platform-fixture";

test("exact repeated contributions use the same backer account and appear on both devices", async ({
  page,
  browser,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await page.getByLabel("Your contribution, test SOL").fill("0.01");
  await page
    .getByRole("button", { name: "Support project", exact: true })
    .click();
  await expect(
    page.getByText("Contribution confirmed. Funds reached the project vault.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Support project", exact: true })
    .click();
  await expect(
    page.getByText("Your contribution: 0.02 SOL", { exact: true }),
  ).toBeVisible();
  expect(fixture.projects.get(fixture.first.campaignAddress)?.raised).toBe(
    20_000_000n,
  );
  expect(
    [...fixture.backers.values()].filter(
      (row) => row.campaign === fixture.first.campaignAddress,
    ),
  ).toHaveLength(1);
  const context = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const author = await context.newPage();
  await fixture.attach(author);
  await author.goto(page.url());
  await expect(
    author.getByText("0.02 SOL", { exact: true }).first(),
  ).toBeVisible();
  await author.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(author.getByText("Contribution", { exact: true })).toHaveCount(
    2,
  );
  await context.close();
});

test("zero and cancelled transactions do not change totals", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await page.getByLabel("Your contribution, test SOL").fill("0");
  await page
    .getByRole("button", { name: "Support project", exact: true })
    .click();
  await expect(page.getByText(/Enter an amount greater than 0/)).toBeVisible();
  expect(fixture.submissions).toEqual([]);
  await page.getByLabel("Your contribution, test SOL").fill("0.1");
  await fixture.outcomes(page, ["cancel"]);
  await page
    .getByRole("button", { name: "Support project", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  expect(fixture.projects.get(fixture.first.campaignAddress)?.raised).toBe(0n);
  await expect(
    page.getByText("Contribution confirmed. Funds reached the project vault.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("unconfirmed submitted transaction retains Explorer link without success", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await fixture.outcomes(page, ["pending"]);
  await page
    .getByRole("button", { name: "Support project", exact: true })
    .click();
  await expect(
    page.getByText(
      /The transaction was submitted but has not been confirmed yet/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View transaction", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Contribution confirmed. Funds reached the project vault.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(fixture.projects.get(fixture.first.campaignAddress)?.raised).toBe(0n);
  await expect(
    page.getByRole("button", { name: "Support project", exact: true }),
  ).toBeDisabled();
});

test("creator refund batch stops on a real Phantom accountChanged event and resumes under the creator", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  // Close and the first refund are signed by the creator. Phantom changes
  // accounts before the client could request approval for the second refund.
  await fixture.switchAfterSignedTransactions(page, 2, SPONSOR_B);
  await page
    .getByRole("button", { name: "Close project and refund funds" })
    .click();
  await page.getByRole("button", { name: "Yes, close funding" }).click();
  await expect(
    page.getByText("Your contribution: 0.2 SOL", { exact: true }),
  ).toBeVisible();
  expect(fixture.submissions.map((row) => row.kind)).toEqual([
    "close",
    "refund",
  ]);
  const paid = fixture.submissions.filter((row) => row.kind === "refund");
  expect(paid).toHaveLength(1);
  expect(paid[0].actor).toBe(CREATOR);
  const partial = fixture.projects.get(fixture.first.campaignAddress)!.refunded;
  expect(partial).toBeGreaterThan(0n);
  expect(partial).toBeLessThan(300_000_000n);
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toHaveCount(0);
  await fixture.switchAccount(page, CREATOR);
  await page
    .getByRole("button", { name: "Refund remaining contributions" })
    .click();
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const all = fixture.submissions.filter((row) => row.kind === "refund");
  expect(all).toHaveLength(2);
  expect(all.every((row) => row.actor === CREATOR)).toBe(true);
  expect(new Set(all.map((row) => row.recipient)).size).toBe(2);
});

test("partial backer RPC results cannot report all refunds complete while campaign totals remain outstanding", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  fixture.omitBackers([SPONSOR_B]);
  await fixture.attach(page);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await page
    .getByRole("button", { name: "Close project and refund funds" })
    .click();
  await page.getByRole("button", { name: "Yes, close funding" }).click();
  await expect(
    page
      .locator("main")
      .getByRole("alert")
      .filter({ hasText: /Refunds are not complete yet/ }),
  ).toBeVisible();
  expect(fixture.projects.get(fixture.first.campaignAddress)?.refunded).toBe(
    100_000_000n,
  );
  expect(
    fixture.submissions.filter((row) => row.kind === "refund"),
  ).toHaveLength(1);
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toHaveCount(0);
  fixture.omitBackers([]);
  await page
    .getByRole("button", { name: "Refund remaining contributions" })
    .click();
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  expect(fixture.projects.get(fixture.first.campaignAddress)?.refunded).toBe(
    300_000_000n,
  );
  expect(
    fixture.submissions.filter((row) => row.kind === "refund"),
  ).toHaveLength(2);
});

test("pending project creation and chat resolve by read-only confirmation without duplicate wallet submissions", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  await fixture.attach(page);
  await page.goto("/create");
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Подтверждение без повтора");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Создание и сообщение подтверждаются без повторной отправки.");
  await page.getByLabel(/Funding goal/).fill("1");
  await fixture.outcomes(page, ["pending"]);
  await page
    .getByRole("button", { name: /Create project|Publish project/ })
    .last()
    .click();
  await expect(
    page.getByText(
      /The transaction was submitted but has not been confirmed yet/,
    ),
  ).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  const intendedCampaign = fixture.submissions[0].campaign;
  expect(fixture.projects.has(intendedCampaign)).toBe(false);
  await expect(
    page.getByRole("button", { name: /Create project|Publish project/ }).last(),
  ).toBeDisabled();
  await fixture.confirmPending();
  await fixture.confirmPending();
  await page
    .getByRole("button", { name: "Check confirmation", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp("/projects/" + intendedCampaign + "$"),
  );
  await expect(
    page.getByRole("heading", {
      name: "Подтверждение без повтора",
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  await page.getByRole("tab", { name: "Discussion", exact: true }).click();
  await page
    .getByLabel("Your message")
    .fill("Сообщение будет опубликовано ровно один раз");
  await fixture.outcomes(page, ["pending"]);
  await page.getByRole("button", { name: "Post message" }).click();
  await expect(
    page.getByText(
      /The transaction was submitted but has not been confirmed yet/,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toHaveValue(
    "Сообщение будет опубликовано ровно один раз",
  );
  await expect(
    page.getByRole("button", { name: "Post message" }),
  ).toBeDisabled();
  expect(fixture.projects.get(intendedCampaign)?.messages).toBe(0n);
  await fixture.confirmPending();
  await page
    .getByRole("button", { name: "Check confirmation", exact: true })
    .click();
  await expect(
    page.getByText("Сообщение будет опубликовано ровно один раз", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toHaveValue("");
  expect(fixture.projects.get(intendedCampaign)?.messages).toBe(1n);
  expect(fixture.submissions.map((row) => row.kind)).toEqual([
    "initialize",
    "message",
  ]);
});

test("creator closes and returns exact contributions to both sponsors", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  const a = fixture.balances.get(SPONSOR_A)!;
  const b = fixture.balances.get(SPONSOR_B)!;
  await fixture.attach(page);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await page
    .getByRole("button", { name: "Close project and refund funds" })
    .click();
  await page.getByRole("button", { name: "Yes, close funding" }).click();
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  expect(fixture.balances.get(SPONSOR_A)).toBe(a + 100_000_000n);
  expect(fixture.balances.get(SPONSOR_B)).toBe(b + 200_000_000n);
  expect(fixture.projects.get(fixture.first.campaignAddress)?.refunded).toBe(
    300_000_000n,
  );
  expect(fixture.submissions.map((row) => row.kind)).toEqual([
    "close",
    "refund",
    "refund",
  ]);
  expect(
    fixture.submissions
      .filter((row) => row.kind === "refund")
      .every((row) => row.actor === CREATOR && row.recipient !== CREATOR),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Support project", exact: true }),
  ).toHaveCount(0);
});

test("partial refund interruption resumes only outstanding sponsors", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true });
  await fixture.attach(page);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await fixture.outcomes(page, ["success", "success", "cancel"]);
  await page
    .getByRole("button", { name: "Close project and refund funds" })
    .click();
  await page.getByRole("button", { name: "Yes, close funding" }).click();
  await expect(page.getByText(/Refund processing stopped/)).toBeVisible();
  expect(
    fixture.projects.get(fixture.first.campaignAddress)?.refunded,
  ).toBeGreaterThan(0n);
  expect(
    fixture.projects.get(fixture.first.campaignAddress)?.refunded,
  ).toBeLessThan(300_000_000n);
  await page
    .getByRole("button", { name: "Refund remaining contributions" })
    .click();
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  expect(fixture.projects.get(fixture.first.campaignAddress)?.refunded).toBe(
    300_000_000n,
  );
  const refunds = fixture.submissions.filter((row) => row.kind === "refund");
  expect(refunds).toHaveLength(2);
  expect(new Set(refunds.map((row) => row.recipient)).size).toBe(2);
});

test("sponsor claims own refund and never receives creator controls", async ({
  page,
}) => {
  const fixture = await createPlatformFixture({ funded: true, closed: true });
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.first.campaignAddress);
  await expect(
    page.getByRole("button", { name: "Close project and refund funds" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Claim my refund" }).click();
  await expect(
    page.getByText("Your contribution has been returned to your wallet.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.submissions[0]).toMatchObject({
    kind: "refund",
    actor: SPONSOR_A,
    recipient: SPONSOR_A,
    amount: "100000000",
  });
  await expect(
    page.getByRole("button", { name: "Claim my refund" }),
  ).toHaveCount(0);
});

test("existing funded campaign refunds its recorded 3 SOL and preserves original contribution history and archived chat", async ({
  page,
}) => {
  const fixture = await createPlatformFixture();
  const original = Buffer.from(
    fixture.accounts.get(fixture.legacy.campaignAddress)!.data[0],
    "base64",
  );
  const records = [...fixture.legacyBackers.values()].map(
    (row) => [row.address, row.raised] as const,
  );
  expect(
    records.map(([, value]) => value).reduce((sum, value) => sum + value, 0n),
  ).toBe(3_000_000_000n);
  await fixture.attach(page, SPONSOR_A);
  await page.goto("/projects/" + fixture.legacy.campaignAddress);
  await expect(
    page.getByText("Your contribution: 2 SOL", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Contribution", { exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: "Discussion", exact: true }).click();
  await page
    .getByLabel("Your message")
    .fill("Мой старый взнос и его возврат видны участникам");
  await page.getByRole("button", { name: "Post message" }).click();
  await expect(
    page.getByText("Мой старый взнос и его возврат видны участникам", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toHaveValue("");
  await expect
    .poll(
      () =>
        fixture.submissions.filter((row) => row.kind === "legacyMessage")
          .length,
    )
    .toBe(1);
  const sponsorBeforeRefund = fixture.balances.get(SPONSOR_A)!;
  await fixture.switchAccount(page, CREATOR);
  await page
    .getByRole("button", { name: "Close project and refund funds" })
    .click();
  await page.getByRole("button", { name: "Yes, close funding" }).click();
  await expect(
    page.getByText(
      "All outstanding contributions have been refunded to sponsors.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  expect(fixture.legacyState.refunded).toBe(3_000_000_000n);
  expect(fixture.balances.get(SPONSOR_A)).toBe(
    sponsorBeforeRefund + 2_000_000_000n,
  );
  expect(
    [...fixture.legacyBackers.values()].map((row) => [row.address, row.raised]),
  ).toEqual(records);
  expect(
    [...fixture.legacyBackers.values()].every(
      (row) => row.refunded === row.raised,
    ),
  ).toBe(true);
  const closed = Buffer.from(
    fixture.accounts.get(fixture.legacy.campaignAddress)!.data[0],
    "base64",
  );
  expect(closed.subarray(0, 48)).toEqual(original);
  expect(closed[48]).toBe(1);
  expect(fixture.accounts.get(fixture.legacy.vaultAddress)!.lamports).toBe(
    690_880,
  );
  expect(fixture.submissions.map((row) => row.kind)).toEqual([
    "legacyMessage",
    "legacyClose",
    "legacyRefund",
    "legacyRefund",
  ]);
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Contribution", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Sponsor refund", { exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("tab", { name: "Discussion", exact: true }).click();
  await expect(
    page.getByText("Мой старый взнос и его возврат видны участникам", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/The discussion remains readable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Post message" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Support project", exact: true }),
  ).toHaveCount(0);
});
