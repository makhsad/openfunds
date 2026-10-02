import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  ANCHOR_DISCRIMINATORS,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
} from "../../src/lib/solana/phantom-gateway";

const CREATOR = "3eVxXvbBUrikwuQPcfBvYWSW2sGxWXFhq5wT8Me6crgS";
const BACKER = "7cJXyqUKqgjvdVhGahELGbihMm8dfXHYgMKmp9GLZN8m";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PROJECT_PATH = `/projects/devnet/${CREATOR}`;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

type FixtureAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, "base64"];
  rentEpoch: number;
  space: number;
};
type FixtureOptions = {
  wallet?: string;
  unavailableMethod?: string;
  failedTransaction?: boolean;
};

/** Public addresses and binary account fixtures; no wallet secrets or network sends. */
async function installRealCampaignFixture(
  page: Page,
  options: FixtureOptions = {},
) {
  const creatorCampaign = await deriveCampaignAddresses(CREATOR);
  const backerCampaign = await deriveCampaignAddresses(BACKER);
  const backerContribution = await deriveContributionAddress(
    creatorCampaign.campaignAddress,
    BACKER,
  );
  const creatorContribution = await deriveContributionAddress(
    creatorCampaign.campaignAddress,
    CREATOR,
  );
  const accounts = new Map<string, FixtureAccount>();
  const encoder = getAddressEncoder();
  const signature = (value: number) =>
    getBase58Decoder().decode(new Uint8Array(64).fill(value));
  const backerSignature = signature(21);
  const creatorSignature = signature(22);
  const failedSignature = signature(23);
  const calls: string[] = [];

  function account(
    data: Uint8Array,
    lamports: number,
    owner = OPENFUNDS_PROGRAM_ADDRESS,
    executable = false,
  ): FixtureAccount {
    return {
      owner,
      executable,
      lamports,
      data: [Buffer.from(data).toString("base64"), "base64"],
      rentEpoch: 0,
      space: data.length,
    };
  }
  function campaign(creator: string, total: bigint) {
    const data = new Uint8Array(48);
    data.set(ANCHOR_DISCRIMINATORS.campaign);
    data.set(encoder.encode(address(creator)), 8);
    new DataView(data.buffer).setBigUint64(40, total, true);
    return account(data, 1_224_960);
  }
  function contribution(backer: string, total: bigint) {
    const data = new Uint8Array(80);
    data.set(ANCHOR_DISCRIMINATORS.contribution);
    data.set(encoder.encode(address(creatorCampaign.campaignAddress)), 8);
    data.set(encoder.encode(address(backer)), 40);
    new DataView(data.buffer).setBigUint64(72, total, true);
    return account(data, 1_447_680);
  }
  accounts.set(
    creatorCampaign.campaignAddress,
    campaign(CREATOR, 3_000_000_000n),
  );
  accounts.set(backerCampaign.campaignAddress, campaign(BACKER, 0n));
  accounts.set(
    creatorCampaign.vaultAddress,
    account(new Uint8Array(ANCHOR_DISCRIMINATORS.vault), 3_000_690_880),
  );
  accounts.set(
    backerCampaign.vaultAddress,
    account(new Uint8Array(ANCHOR_DISCRIMINATORS.vault), 690_880),
  );
  accounts.set(backerContribution, contribution(BACKER, 2_000_000_000n));
  accounts.set(creatorContribution, contribution(CREATOR, 1_000_000_000n));

  const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: address(loader),
    seeds: [encoder.encode(address(OPENFUNDS_PROGRAM_ADDRESS))],
  });
  const program = new Uint8Array(36);
  new DataView(program.buffer).setUint32(0, 2, true);
  program.set(encoder.encode(programDataAddress), 4);
  accounts.set(
    OPENFUNDS_PROGRAM_ADDRESS,
    account(program, 1_000_000, loader, true),
  );
  const programData = new Uint8Array(49);
  new DataView(programData.buffer).setUint32(0, 3, true);
  programData.set([0x7f, 0x45, 0x4c, 0x46], 45);
  accounts.set(programDataAddress, account(programData, 1_000_000, loader));

  function transaction(
    actor: string,
    lamports: bigint,
    txSignature: string,
    failed = false,
  ) {
    const actorContribution =
      actor === BACKER ? backerContribution : creatorContribution;
    const keys = [
      actor,
      creatorCampaign.campaignAddress,
      creatorCampaign.vaultAddress,
      actorContribution,
      SYSTEM_PROGRAM,
      OPENFUNDS_PROGRAM_ADDRESS,
    ];
    const vaultBefore =
      690_880 + (actor === BACKER && !failed ? 1_000_000_000 : 0);
    const instruction = new Uint8Array(16);
    instruction.set(ANCHOR_DISCRIMINATORS.contribute);
    new DataView(instruction.buffer).setBigUint64(8, lamports, true);
    return {
      slot: failed ? 40 : actor === BACKER ? 42 : 41,
      blockTime: 1_780_000_000 - (failed ? 2 : actor === BACKER ? 0 : 1),
      version: "legacy",
      transaction: {
        signatures: [txSignature],
        message: {
          accountKeys: keys.map((pubkey, index) => ({
            pubkey,
            signer: index === 0,
            writable: index < 4,
            source: "transaction",
          })),
          recentBlockhash: getBase58Decoder().decode(
            new Uint8Array(32).fill(8),
          ),
          instructions: [
            {
              programId: OPENFUNDS_PROGRAM_ADDRESS,
              accounts: keys.slice(0, 5),
              data: getBase58Decoder().decode(instruction),
            },
          ],
        },
      },
      meta: {
        err: failed ? { InstructionError: [0, { Custom: 6000 }] } : null,
        fee: 5_000,
        preBalances: [
          5_000_000_000,
          1_224_960,
          vaultBefore,
          1_447_680,
          1,
          1_000_000,
        ],
        postBalances: [
          5_000_000_000 - (failed ? 0 : Number(lamports)) - 5_000,
          1_224_960,
          vaultBefore + (failed ? 0 : Number(lamports)),
          1_447_680,
          1,
          1_000_000,
        ],
        innerInstructions: failed
          ? []
          : [
              {
                index: 0,
                instructions: [
                  {
                    program: "system",
                    programId: SYSTEM_PROGRAM,
                    parsed: {
                      type: "transfer",
                      info: {
                        source: actor,
                        destination: creatorCampaign.vaultAddress,
                        lamports: Number(lamports),
                      },
                    },
                  },
                ],
              },
            ],
        logMessages: [],
      },
    };
  }
  const transactions = new Map([
    [backerSignature, transaction(BACKER, 2_000_000_000n, backerSignature)],
    [creatorSignature, transaction(CREATOR, 1_000_000_000n, creatorSignature)],
    [failedSignature, transaction(BACKER, 0n, failedSignature, true)],
  ]);

  if (options.wallet) {
    await page.addInitScript((initialWallet) => {
      let selected = initialWallet;
      let connected = true;
      const listeners = new Map<
        string,
        Set<(key?: { toString(): string } | null) => void>
      >();
      const provider = {
        isPhantom: true,
        get isConnected() {
          return connected;
        },
        get publicKey() {
          return connected ? { toString: () => selected } : null;
        },
        async connect() {
          connected = true;
          return { publicKey: this.publicKey! };
        },
        async disconnect() {
          connected = false;
          listeners.get("disconnect")?.forEach((listener) => listener());
        },
        async signAndSendTransaction() {
          throw new Error(
            "Read-only campaign test must never request a signature",
          );
        },
        on(
          event: string,
          listener: (key?: { toString(): string } | null) => void,
        ) {
          const registered = listeners.get(event) ?? new Set();
          registered.add(listener);
          listeners.set(event, registered);
        },
        removeListener(
          event: string,
          listener: (key?: { toString(): string } | null) => void,
        ) {
          listeners.get(event)?.delete(listener);
        },
      };
      Object.defineProperty(window, "phantom", { value: { solana: provider } });
      (
        window as unknown as { __realCampaignSwitch(wallet: string): void }
      ).__realCampaignSwitch = (wallet) => {
        selected = wallet;
        listeners
          .get("accountChanged")
          ?.forEach((listener) => listener(provider.publicKey));
      };
    }, options.wallet);
  }

  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    calls.push(request.method);
    if (request.method === options.unavailableMethod) {
      await route.fulfill({
        status: 503,
        json: {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: "Devnet fixture temporarily unavailable",
          },
        },
      });
      return;
    }
    let result: unknown;
    switch (request.method) {
      case "getGenesisHash":
        result = DEVNET_GENESIS;
        break;
      case "getAccountInfo":
        result = {
          context: { slot: 42 },
          value: accounts.get(request.params[0]) ?? null,
        };
        break;
      case "getMultipleAccounts":
        result = {
          context: { slot: 42 },
          value: request.params[0].map(
            (key: string) => accounts.get(key) ?? null,
          ),
        };
        break;
      case "getBalance":
        result = { context: { slot: 42 }, value: 5_000_000_000 };
        break;
      case "getProgramAccounts": {
        expect(request.params[0]).toBe(OPENFUNDS_PROGRAM_ADDRESS);
        const entries = [...accounts]
          .filter(([, value]) => value.owner === OPENFUNDS_PROGRAM_ADDRESS)
          .filter(([, value]) => {
            const data = Buffer.from(value.data[0], "base64");
            return (request.params[1].filters ?? []).every(
              (filter: {
                dataSize?: number;
                memcmp?: { offset: number; bytes: string };
              }) => {
                if (
                  filter.dataSize !== undefined &&
                  data.length !== filter.dataSize
                )
                  return false;
                if (filter.memcmp) {
                  const bytes = getBase58Encoder().encode(filter.memcmp.bytes);
                  return Buffer.from(bytes).equals(
                    data.subarray(
                      filter.memcmp.offset,
                      filter.memcmp.offset + bytes.length,
                    ),
                  );
                }
                return true;
              },
            );
          })
          .map(([pubkey, value]) => ({ pubkey, account: value }));
        result = request.params[1].withContext
          ? { context: { slot: 42 }, value: entries }
          : entries;
        break;
      }
      case "getSignaturesForAddress": {
        const list =
          request.params[0] === creatorCampaign.campaignAddress
            ? [
                backerSignature,
                creatorSignature,
                ...(options.failedTransaction ? [failedSignature] : []),
              ]
            : [];
        result = request.params[1]?.before
          ? []
          : list.map((txSignature, index) => ({
              signature: txSignature,
              slot: 42 - index,
              blockTime: 1_780_000_000 - index,
              err:
                txSignature === failedSignature
                  ? { InstructionError: [0, { Custom: 6000 }] }
                  : null,
              memo: null,
              confirmationStatus: "finalized",
            }));
        break;
      }
      case "getTransaction":
        result = transactions.get(request.params[0]) ?? null;
        break;
      default:
        throw new Error(`Unexpected or signing RPC method: ${request.method}`);
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  return {
    creatorCampaign,
    backerCampaign,
    backerSignature,
    creatorSignature,
    failedSignature,
    calls,
  };
}

test("primary projects show public Devnet campaigns instead of browser demo balances", async ({
  page,
}) => {
  await installRealCampaignFixture(page);
  await page.goto("/projects");
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
  const creatorCard = page
    .locator("article")
    .filter({ has: page.locator(`a[href='${PROJECT_PATH}']`) });
  await expect(creatorCard).toHaveCount(1);
  await expect(creatorCard).toContainText("3 SOL");
  const emptyCard = page
    .locator("article")
    .filter({ has: page.locator(`a[href='/projects/devnet/${BACKER}']`) });
  await expect(emptyCard).toContainText("0 SOL");
  await expect(page.getByText("SolEdu", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("backer dashboard separates its own empty startup from the startup it funded", async ({
  page,
}) => {
  await installRealCampaignFixture(page, { wallet: BACKER });
  await page.goto("/dashboard");
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
  const own = page
    .locator("article")
    .filter({ has: page.locator(`a[href='/projects/devnet/${BACKER}']`) });
  const sponsored = page
    .locator("article")
    .filter({ has: page.locator(`a[href='${PROJECT_PATH}']`) });
  await expect(own).toContainText("0 SOL");
  await expect(sponsored).toContainText("2 SOL");
  await expect(sponsored).toContainText("3 SOL");
  await sponsored.locator(`a[href='${PROJECT_PATH}']`).first().click();
  await expect(page).toHaveURL(PROJECT_PATH);
  await expect(
    page.getByLabel("Campaign creator's public address"),
  ).toHaveValue(CREATOR);
});

test("shared startup shows sponsors and permanent history across reloads and independent browsers", async ({
  page,
  browser,
}, testInfo) => {
  const fixture = await installRealCampaignFixture(page, { wallet: BACKER });
  await page.goto(PROJECT_PATH);
  await expect(
    page.getByLabel("Campaign creator's public address"),
  ).toHaveValue(CREATOR);
  const backers = page.getByRole("region", {
    name: "Campaign backers",
    exact: true,
  });
  const activity = page.getByRole("region", {
    name: "Campaign activity",
    exact: true,
  });
  await expect(backers).toContainText(BACKER);
  await expect(backers).toContainText(CREATOR);
  await expect(backers).toContainText("2 SOL");
  await expect(backers).toContainText("1 SOL");
  await expect(
    activity.locator(`a[href*='${fixture.backerSignature}']`),
  ).toHaveCount(1);
  await expect(
    activity.locator(`a[href*='${fixture.creatorSignature}']`),
  ).toHaveCount(1);
  await page.reload();
  await expect(backers).toContainText("2 SOL");
  await expect(
    activity.locator(`a[href*='${fixture.backerSignature}']`),
  ).toHaveCount(1);
  await page.evaluate(
    (wallet) =>
      (
        window as unknown as { __realCampaignSwitch(wallet: string): void }
      ).__realCampaignSwitch(wallet),
    CREATOR,
  );
  await expect(
    page.getByLabel("Campaign creator's public address"),
  ).toHaveValue(CREATOR);
  await expect(backers).toContainText("2 SOL");
  await expect(page).toHaveURL(PROJECT_PATH);
  const secondContext = await browser.newContext({
    viewport: testInfo.project.use.viewport,
  });
  try {
    const second = await secondContext.newPage();
    await installRealCampaignFixture(second);
    await second.goto(`${new URL(page.url()).origin}${PROJECT_PATH}`);
    await expect(
      second.getByRole("region", { name: "Campaign backers", exact: true }),
    ).toContainText("2 SOL");
    await expect(
      second
        .getByRole("region", { name: "Campaign activity", exact: true })
        .locator(`a[href*='${fixture.backerSignature}']`),
    ).toHaveCount(1);
    await expect(
      second.getByText("3 SOL", { exact: true }).first(),
    ).toBeVisible();
    expect(
      await second.evaluate(() =>
        localStorage.getItem("openfunds.projects.v1"),
      ),
    ).toBeNull();
  } finally {
    await secondContext.close();
  }
});

test("failed transactions stay failed without inflating the campaign balance", async ({
  page,
}) => {
  const fixture = await installRealCampaignFixture(page, {
    failedTransaction: true,
  });
  await page.goto(PROJECT_PATH);
  const activity = page.getByRole("region", {
    name: "Campaign activity",
    exact: true,
  });
  await expect(
    activity.locator(`a[href*='${fixture.failedSignature}']`),
  ).toHaveCount(1);
  await expect(activity).toContainText("Failed");
  await expect(page.getByText("3 SOL", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("4 SOL", { exact: true })).toHaveCount(0);
});

test("Devnet discovery failure is visible rather than reporting zero campaigns", async ({
  page,
}) => {
  await installRealCampaignFixture(page, {
    unavailableMethod: "getProgramAccounts",
  });
  await page.goto("/projects");
  const error = page.locator(".devnet-feedback[role='alert']");
  await expect(error).toContainText("Could not refresh campaigns");
  await expect(error).toContainText("Solana Devnet");
  await expect(error).not.toContainText(/Solana error #|Decode this error/);
  await expect(
    page.getByText("No Devnet campaigns found", { exact: true }),
  ).toHaveCount(0);
});
