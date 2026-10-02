import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ProjectState } from "../../src/types/project";

const STORAGE_KEY = "openfunds.projects.v1";
const discussion = (page: Page) =>
  page.getByRole("region", { name: "Project Discussion", exact: true });
const milestone = (page: Page, title = "Prototype") =>
  page.getByRole("article", { name: title, exact: true });

async function snapshot(page: Page): Promise<ProjectState> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    STORAGE_KEY,
  );
}

async function identity(page: Page, id: string) {
  await expect(page.getByLabel("Demo identity")).toBeEnabled();
  await page.getByLabel("Demo identity").selectOption(id);
  await expect(page.getByLabel("Demo identity")).toHaveValue(id);
}

async function tab(page: Page, name: string) {
  await page
    .getByRole("tab", { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    .click();
}

async function contribute(page: Page, amount: string) {
  const before = await snapshot(page);
  await page.getByLabel("Contribution amount", { exact: false }).fill(amount);
  await page
    .getByRole("button", { name: "Contribute (demo)", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await snapshot(page)).projects.map((project) => project.raised),
    )
    .not.toEqual(before.projects.map((project) => project.raised));
  await expect(page.getByLabel("Demo identity")).toBeEnabled();
}

async function createProject(page: Page, title: string) {
  await page.goto("/create?mode=demo");
  await identity(page, "creator");
  await page.getByLabel("Project title", { exact: false }).fill(title);
  await page
    .getByLabel("Short description", { exact: false })
    .fill("A community project with measurable progress.");
  await page
    .getByLabel("Full project description", { exact: false })
    .fill(
      "We are building an accessible community tool and reporting each outcome to supporters.",
    );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Funding goal (SOL)", { exact: false }).fill("3");
  await page
    .getByLabel("What are we building?", { exact: false })
    .fill("A useful community tool.");
  await page
    .getByLabel("Why is it needed?", { exact: false })
    .fill("To make community collaboration more accessible.");
  await page
    .getByLabel("Who is it for?", { exact: false })
    .fill("Local communities and project supporters.");
  await page
    .getByLabel("Project plan / roadmap", { exact: false })
    .fill("Prototype, public testing, then release.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Milestone 1 title").fill("Prototype");
  await page
    .getByLabel("Milestone 1 description")
    .fill("Deliver a working prototype and evidence.");
  await page.getByLabel("Milestone 1 budget (SOL)").fill("1");
  await page
    .getByRole("button", { name: "Add Milestone", exact: true })
    .click();
  await page.getByLabel("Milestone 2 title").fill("Public release");
  await page
    .getByLabel("Milestone 2 description")
    .fill("Publish the tested tool and documentation.");
  await page.getByLabel("Milestone 2 budget (SOL)").fill("2");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[aria-label='Project preview']")).toContainText(
    title,
  );
  await page
    .getByRole("button", { name: "Publish Project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  expect(
    (await snapshot(page)).projects.find((project) => project.id === id)
      ?.status,
  ).toBe("funding");
  return id;
}

async function submitForVoting(page: Page) {
  const card = milestone(page);
  await card
    .getByRole("button", { name: "Start Milestone", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Submit for Review", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Submit for Review", exact: true })
    .click();
  await card
    .getByLabel("Completion summary", { exact: true })
    .fill("The prototype works, and the results are available for review.");
  await card
    .getByLabel("Evidence URL", { exact: true })
    .fill("https://example.com/evidence");
  await card
    .getByRole("button", { name: "Start demo voting", exact: true })
    .click();
  await expect(card).toContainText("Fixed snapshot");
  await expect(page.getByLabel("Demo identity")).toBeEnabled();
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?mode=demo");
  await expect(page.getByLabel("Demo identity")).toBeEnabled();
});

test("create, contribute, discuss, vote with a fixed snapshot, isolate projects and persist edits", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const id = await createProject(page, "Community prototype acceptance");
  await tab(page, "Discussion");
  await discussion(page)
    .getByRole("button", { name: "Project Update", exact: true })
    .click();
  await discussion(page)
    .getByLabel("Your project update", { exact: true })
    .fill("Creator evidence: the plan is ready.");
  await discussion(page)
    .getByRole("button", { name: "Publish Project Update", exact: true })
    .click();
  await expect(discussion(page)).toContainText(
    "Creator evidence: the plan is ready.",
  );

  await identity(page, "backer-a");
  await expect(discussion(page).getByRole("textbox")).toHaveCount(0);
  await contribute(page, "0.4");
  await discussion(page)
    .getByLabel("Your message", { exact: true })
    .fill("<b>Plain text support</b>");
  await discussion(page)
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(discussion(page)).toContainText("<b>Plain text support</b>");
  await expect(discussion(page).locator("b")).toHaveCount(0);
  await identity(page, "backer-b");
  await contribute(page, "0.6");
  const funded = await snapshot(page);
  expect(funded.contributions[id]).toEqual({
    "backer-a": "400000000",
    "backer-b": "600000000",
  });
  expect(funded.projects.find((project) => project.id === id)?.raised).toBe(
    "1000000000",
  );

  await identity(page, "creator");
  await tab(page, "Milestones");
  await submitForVoting(page);
  await expect(
    milestone(page).getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  const fixed = (await snapshot(page)).projects.find(
    (project) => project.id === id,
  )!.milestones[0].voting!;
  expect(fixed.totalWeight).toBe("1000000000");
  expect(fixed.weights).toEqual({
    "backer-a": "400000000",
    "backer-b": "600000000",
  });
  await identity(page, "visitor");
  await expect(
    milestone(page).getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await identity(page, "backer-a");
  await contribute(page, "0.2");
  await milestone(page)
    .getByRole("button", { name: "Approve", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find((project) => project.id === id)!
          .milestones[0].voting!.approveWeight,
    )
    .toBe("400000000");
  await expect(
    milestone(page).getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await identity(page, "backer-b");
  await milestone(page)
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find((project) => project.id === id)!
          .milestones[0].status,
    )
    .toBe("rejected");
  const voted = (await snapshot(page)).projects.find(
    (project) => project.id === id,
  )!;
  expect(voted.milestones[0].voting!.totalWeight).toBe("1000000000");
  expect(voted.milestones[0].voting!.rejectWeight).toBe("600000000");
  expect(
    voted.transactions.filter((transaction) => transaction.type === "vote"),
  ).toHaveLength(2);
  expect(voted.locked).toBe("1200000000");
  await expect(
    milestone(page).getByRole("button", {
      name: "Release demo funds",
      exact: true,
    }),
  ).toHaveCount(0);

  await page.goto("/projects/green-chain#discussion");
  await expect(discussion(page)).not.toContainText(
    "Creator evidence: the plan is ready.",
  );
  await expect(discussion(page)).not.toContainText("Plain text support");
  await page.goto(`/projects/${id}#discussion`);
  await expect(discussion(page)).toContainText("Plain text support");
  await page.reload();
  await expect(discussion(page)).toContainText(
    "Creator evidence: the plan is ready.",
  );
  expect(
    (await snapshot(page)).projects.find((project) => project.id === id)!
      .milestones[0].voting,
  ).toEqual(voted.milestones[0].voting);

  await page.goto(`/projects/${id}/edit`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Only this project",
  );
  await identity(page, "creator");
  await page.getByRole("button", { name: /Funding & plan$/ }).click();
  await expect(
    page.getByLabel("Funding goal (SOL)", { exact: false }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Milestones$/ }).click();
  await expect(page.getByLabel("Milestone 1 budget (SOL)")).toBeDisabled();
  await page.getByRole("button", { name: /Basic information$/ }).click();
  await page
    .getByLabel("Project title", { exact: false })
    .fill("Community prototype updated");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${id}`);
  await expect(
    page.getByRole("heading", {
      name: "Community prototype updated",
      exact: true,
    }),
  ).toBeVisible();
  const edited = (await snapshot(page)).projects.find(
    (project) => project.id === id,
  )!;
  expect(edited.goal).toBe("3000000000");
  expect(edited.raised).toBe("1200000000");
  expect(edited.milestones.map((item) => item.amount)).toEqual([
    "1000000000",
    "2000000000",
  ]);
  await tab(page, "Milestones");
  await expect(
    milestone(page).getByRole("button", {
      name: "Start Milestone",
      exact: true,
    }),
  ).toBeVisible();
  await milestone(page)
    .getByRole("button", { name: "Start Milestone", exact: true })
    .click();
  await expect(
    milestone(page).getByRole("button", {
      name: "Submit for Review",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await snapshot(page)).projects.find((project) => project.id === id)!
      .milestones[0].status,
  ).toBe("in_progress");
});

test("approval requires complete fixed-weight voting and creator can release the approved demo budget", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/projects/sol-edu#milestones");
  await identity(page, "creator");
  await submitForVoting(page);
  await identity(page, "backer-a");
  const beforeVote = await snapshot(page);
  await page.getByText("Demo controls", { exact: true }).click();
  for (const outcome of ["error", "cancel"]) {
    await page.getByLabel("Next demo operation").selectOption(outcome);
    await milestone(page)
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(page.locator(".of-notification[role='alert']")).toContainText(
      outcome === "error" ? "failed" : "cancelled",
    );
    expect(await snapshot(page)).toEqual(beforeVote);
    await expect(
      milestone(page).getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled();
  }
  await page.getByLabel("Next demo operation").selectOption("success");
  const liveVotingAccessibility = (
    await new AxeBuilder({ page }).include(".of-milestones").analyze()
  ).violations;
  expect(
    liveVotingAccessibility.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  await milestone(page)
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find(
          (project) => project.id === "sol-edu",
        )!.milestones[0].voting!.approveWeight,
    )
    .toBe("7400000000");
  expect(
    (await snapshot(page)).projects.find((project) => project.id === "sol-edu")!
      .milestones[0].status,
  ).toBe("voting");
  await identity(page, "backer-b");
  await milestone(page)
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find(
          (project) => project.id === "sol-edu",
        )!.milestones[0].status,
    )
    .toBe("approved");
  await expect(
    milestone(page).getByRole("button", {
      name: "Release demo funds",
      exact: true,
    }),
  ).toHaveCount(0);
  await identity(page, "creator");
  const balance = (await snapshot(page)).balances.creator;
  await milestone(page)
    .getByRole("button", { name: "Release demo funds", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find(
          (project) => project.id === "sol-edu",
        )!.milestones[0].status,
    )
    .toBe("released");
  const released = await snapshot(page);
  const project = released.projects.find((item) => item.id === "sol-edu")!;
  expect(project.raised).toBe("12400000000");
  expect(project.released).toBe("4000000000");
  expect(project.locked).toBe("8400000000");
  expect(released.balances.creator).toBe(
    (BigInt(balance) + 4_000_000_000n).toString(),
  );
  expect(
    project.transactions.filter(
      (transaction) => transaction.type === "release",
    ),
  ).toHaveLength(1);
  await expect(
    milestone(page).getByRole("button", {
      name: "Release demo funds",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    milestone(page, "MVP").getByRole("button", {
      name: "Start Milestone",
      exact: true,
    }),
  ).toBeVisible();
  await tab(page, "Transactions");
  const transactionAccessibility = (
    await new AxeBuilder({ page }).include(".of-tab-panel").analyze()
  ).violations;
  expect(
    transactionAccessibility.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  await expect(page.getByRole("table")).toContainText("Release");
  expect(
    project.transactions.every((transaction) => !transaction.signature),
  ).toBe(true);
  await expect(page.getByRole("link", { name: /Explorer/ })).toHaveCount(0);
});

test("draft validation, browser-only media, dashboard links and creator permissions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/create?mode=demo");
  await page
    .getByRole("button", { name: "Use Creator demo identity", exact: true })
    .click();
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.locator(".editor-error[role='alert']")).toContainText(
    "Enter a project title",
  );
  await page
    .getByLabel("Project title", { exact: false })
    .fill("Private draft acceptance");
  await page.getByRole("button", { name: /Media$/ }).click();
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Project logo", { exact: true })
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: image });
  await expect(
    page.getByRole("img", { name: "Project logo preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Milestones$/ }).click();
  await page.getByLabel("Milestone 1 title").fill("Draft prototype");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/edit$/);
  const draft = (await snapshot(page)).projects.find(
    (project) => project.title === "Private draft acceptance",
  )!;
  expect(draft.status).toBe("draft");
  expect(draft.logoUrl).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await page.getByRole("button", { name: /Media$/ }).click();
  await expect(
    page.getByRole("img", { name: "Project logo preview", exact: true }),
  ).toBeVisible();
  await page.goto("/projects?mode=demo");
  await expect(
    page.getByRole("heading", {
      name: "Private draft acceptance",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/dashboard?mode=demo");
  await expect(
    page.getByText("Private draft acceptance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href='/projects/${draft.id}/edit']`),
  ).toBeVisible();
  await page.goto("/projects/green-chain/edit");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Only this project",
  );
  await expect(page.getByLabel("Project title", { exact: false })).toHaveCount(
    0,
  );
  await identity(page, "backer-a");
  await page.goto("/dashboard?mode=demo");
  await page.getByRole("tab", { name: /Supported Projects/ }).click();
  await expect(page.getByText("SolEdu", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator("a[href='/projects/sol-edu#discussion']"),
  ).toBeVisible();
  await page.goto("/create?mode=demo");
  await expect(
    page.getByRole("button", {
      name: "Use Creator demo identity",
      exact: true,
    }),
  ).toBeVisible();
});

test("failed and cancelled operations preserve accounting; duplicate clicks contribute once", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/projects/sol-edu");
  await identity(page, "backer-a");
  const before = await snapshot(page);
  await page.getByText("Demo controls", { exact: true }).click();
  for (const outcome of ["error", "cancel"]) {
    await page.getByLabel("Next demo operation").selectOption(outcome);
    await page.getByLabel("Contribution amount", { exact: false }).fill("0.1");
    await page
      .getByRole("button", { name: "Contribute (demo)", exact: true })
      .click();
    await expect(page.getByLabel("Demo identity")).toBeEnabled();
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText: outcome === "error" ? /failed|Nothing changed/ : /cancel/i,
        })
        .first(),
    ).toBeVisible();
    expect(await snapshot(page)).toEqual(before);
  }
  await page.getByLabel("Next demo operation").selectOption("success");
  await page.getByLabel("Contribution amount", { exact: false }).fill("0.1");
  await page
    .getByRole("button", { name: "Contribute (demo)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel demo operation", exact: true })
    .click();
  await expect(page.locator(".of-notification[role='alert']")).toContainText(
    /cancel/i,
  );
  expect(await snapshot(page)).toEqual(before);
  await page.getByLabel("Contribution amount", { exact: false }).fill("0.1");
  await page
    .getByRole("button", { name: "Contribute (demo)", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(
      async () =>
        (await snapshot(page)).projects.find(
          (project) => project.id === "sol-edu",
        )!.raised,
    )
    .toBe("12500000000");
  const once = await snapshot(page);
  expect(once.contributions["sol-edu"]["backer-a"]).toBe("7500000000");
  expect(once.balances["backer-a"]).toBe("99900000000");
  expect(
    once.projects.find((project) => project.id === "sol-edu")!.transactions,
  ).toHaveLength(3);
  await page.getByLabel("Contribution amount", { exact: false }).fill("0");
  await page
    .getByRole("button", { name: "Contribute (demo)", exact: true })
    .click();
  await expect(
    page
      .locator(".of-error[role='alert'], .of-notification[role='alert']")
      .first(),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(once);
  await page.getByLabel("Contribution amount", { exact: false }).fill("100");
  await page
    .getByRole("button", { name: "Contribute (demo)", exact: true })
    .click();
  await expect(
    page
      .locator(".of-error[role='alert'], .of-notification[role='alert']")
      .first(),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(once);
});

test("all public routes, search, categories, keyboard navigation and responsive accessibility", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByLabel("Demo identity")).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Explore Projects", exact: true })
    .click();
  await expect(page).toHaveURL("/projects?mode=demo");
  await page.getByLabel("Search projects", { exact: true }).fill("SolEdu");
  await expect(
    page.getByRole("heading", { name: "SolEdu", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "GreenChain", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Search projects", { exact: true })
    .fill("no matching project 12345");
  await expect(
    page.getByText(/No projects found|No matching projects/).first(),
  ).toBeVisible();
  await page.getByLabel("Search projects", { exact: true }).fill("");
  await page
    .getByLabel("Category filter", { exact: true })
    .selectOption("Environment");
  await expect(
    page.getByRole("heading", { name: "GreenChain", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SolEdu", exact: true }),
  ).toHaveCount(0);
  await identity(page, "creator");
  for (const [route, file] of [
    ["/?mode=demo", "home"],
    ["/projects?mode=demo", "explore"],
    ["/projects/sol-edu", "project"],
    ["/create?mode=demo", "create"],
    ["/dashboard?mode=demo", "dashboard"],
  ]) {
    await page.goto(route);
    await expect(page.getByLabel("Demo identity")).toBeEnabled();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noOverflow(page);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(
      violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target),
      })),
      route,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${file}.png`),
      fullPage: true,
      scale: "css",
    });
    if (testInfo.project.name === "desktop") {
      for (const width of [320, 768, 1024]) {
        await page.setViewportSize({ width, height: 1000 });
        await noOverflow(page);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
  await page.goto("/projects/missing-project");
  await expect(
    page.getByRole("heading", { name: "Project not found", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
