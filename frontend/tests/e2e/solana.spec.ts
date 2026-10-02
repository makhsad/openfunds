import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { Transaction } from "@solana/web3.js";
import {
  ANCHOR_DISCRIMINATORS,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
} from "../../src/lib/solana/phantom-gateway";

const TEST_PUBLIC_ADDRESS = getBase58Decoder().decode(
  new Uint8Array(32).fill(7),
);
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

test("Devnet page has honest undeployed state, no demo controls and accessible responsive layout", async ({
  page,
}) => {
  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    const result =
      request.method === "getGenesisHash"
        ? DEVNET_GENESIS
        : { context: { slot: 1 }, value: null };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/solana");
  await expect(
    page.getByRole("heading", { name: "Test your OpenFunds campaign" }),
  ).toBeVisible();
  await expect(page.getByText("Not deployed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create campaign on Devnet",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
  await expect(
    page.getByText("Phantom was not found.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toBeDisabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Phantom public connection reads test SOL while undeployed program cannot request signatures", async ({
  page,
}) => {
  await page.addInitScript((publicAddress) => {
    let isConnected = false;
    let publicKey: { toString(): string } | null = null;
    const listeners = new Map<string, ((key?: unknown) => void)[]>();
    const provider = {
      isPhantom: true,
      get isConnected() {
        return isConnected;
      },
      get publicKey() {
        return publicKey;
      },
      async connect() {
        isConnected = true;
        publicKey = { toString: () => publicAddress };
        return { publicKey };
      },
      async disconnect() {
        isConnected = false;
        publicKey = null;
        listeners.get("disconnect")?.forEach((listener) => listener());
      },
      async signAndSendTransaction() {
        throw new Error("Undeployed program must never ask to sign");
      },
      async request() {
        throw new Error("Reached end of buffer unexpectedly");
      },
      on(event: string, listener: (key?: unknown) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      removeListener(event: string, listener: (key?: unknown) => void) {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== listener),
        );
      },
    };
    Object.defineProperty(window, "phantom", { value: { solana: provider } });
  }, TEST_PUBLIC_ADDRESS);
  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    const result =
      request.method === "getGenesisHash"
        ? DEVNET_GENESIS
        : request.method === "getBalance"
          ? { context: { slot: 1 }, value: 5_500_000_000 }
          : { context: { slot: 1 }, value: null };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/solana");
  await page
    .getByRole("button", { name: "Connect Phantom", exact: true })
    .click();
  await expect(
    page.getByText("Phantom connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByText("5.5 SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create campaign on Devnet",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: /transaction/i })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Disconnect Phantom", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toBeEnabled();
});

test("An already-connected Phantom wallet is restored when the page opens or reloads", async ({
  page,
}) => {
  await page.addInitScript((publicAddress) => {
    const provider = {
      isPhantom: true,
      isConnected: true,
      publicKey: { toString: () => publicAddress },
      async connect() {
        throw new Error(
          "An existing connection must not request another wallet connection",
        );
      },
      async disconnect() {
        this.isConnected = false;
      },
      async signAndSendTransaction() {
        throw new Error("An undeployed program must not request a signature");
      },
      async request() {
        throw new Error("Reached end of buffer unexpectedly");
      },
    };
    Object.defineProperty(window, "phantom", { value: { solana: provider } });
  }, TEST_PUBLIC_ADDRESS);
  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    const result =
      request.method === "getGenesisHash"
        ? DEVNET_GENESIS
        : request.method === "getBalance"
          ? { context: { slot: 1 }, value: 5_500_000_000 }
          : { context: { slot: 1 }, value: null };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });

  await page.goto("/solana");
  await expect(
    page.getByText("Phantom connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByText("5.5 SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Campaign creator's public address"),
  ).toHaveValue(TEST_PUBLIC_ADDRESS);
  await expect(
    page.getByRole("button", { name: "Disconnect Phantom", exact: true }),
  ).toBeEnabled();

  await page.reload();
  await expect(
    page.getByText("Phantom connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByText("5.5 SOL", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toHaveCount(0);
});

type FixtureWalletOutcome = "success" | "cancelled" | "wallet-error";
type FixtureWalletRequest = {
  bytes: number[];
  wallet: string;
  options: unknown;
  outcome: FixtureWalletOutcome;
};
type FixtureAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, "base64"];
  rentEpoch: number;
  space: number;
};

/** Fully mocked RPC and wallet: only public fixture addresses and unsigned bytes. */
async function installDeployedWalletFixture(page: Page) {
  const creator = getBase58Decoder().decode(new Uint8Array(32).fill(1));
  const backer = getBase58Decoder().decode(new Uint8Array(32).fill(2));
  const blockhash = getBase58Decoder().decode(new Uint8Array(32).fill(8));
  const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
  const { campaignAddress, vaultAddress } =
    await deriveCampaignAddresses(creator);
  const contributionAddress = await deriveContributionAddress(
    campaignAddress,
    backer,
  );
  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: address(loader),
    seeds: [getAddressEncoder().encode(address(OPENFUNDS_PROGRAM_ADDRESS))],
  });
  const accounts = new Map<string, FixtureAccount>();
  const balances = new Map([
    [creator, 5_500_000_000],
    [backer, 5_500_000_000],
  ]);
  const vaultRent = 946_560;
  const campaignRent = 1_224_960;
  const contributionRent = 1_447_680;
  const fee = 5_000;
  let campaignTotal = 0;
  let backerTotal = 0;
  const submissions: {
    action: "create" | "contribute";
    wallet: string;
    contributionAddress: string | null;
  }[] = [];
  const signatures: string[] = [];

  function chainAccount(
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
  const program = new Uint8Array(36);
  new DataView(program.buffer).setUint32(0, 2, true);
  program.set(getAddressEncoder().encode(programDataAddress), 4);
  accounts.set(
    OPENFUNDS_PROGRAM_ADDRESS,
    chainAccount(program, 1_000_000, loader, true),
  );
  const programData = new Uint8Array(49);
  new DataView(programData.buffer).setUint32(0, 3, true);
  programData.set([0x7f, 0x45, 0x4c, 0x46], 45);
  accounts.set(
    programDataAddress,
    chainAccount(programData, 1_000_000, loader),
  );

  function saveCampaign() {
    const data = new Uint8Array(48);
    data.set(ANCHOR_DISCRIMINATORS.campaign);
    data.set(getAddressEncoder().encode(address(creator)), 8);
    new DataView(data.buffer).setBigUint64(40, BigInt(campaignTotal), true);
    accounts.set(campaignAddress, chainAccount(data, campaignRent));
  }
  function saveContribution() {
    const data = new Uint8Array(80);
    data.set(ANCHOR_DISCRIMINATORS.contribution);
    data.set(getAddressEncoder().encode(address(campaignAddress)), 8);
    data.set(getAddressEncoder().encode(address(backer)), 40);
    new DataView(data.buffer).setBigUint64(72, BigInt(backerTotal), true);
    accounts.set(contributionAddress, chainAccount(data, contributionRent));
  }

  await page.exposeFunction(
    "__openFundsFixtureSubmit",
    ({ bytes, wallet, options, outcome }: FixtureWalletRequest) => {
      // Decode the complete unsigned envelope with the official wallet library.
      // Applying fixture accounting before this succeeds would hide parser errors.
      const transaction = Transaction.from(Uint8Array.from(bytes));
      expect(transaction.signatures).toHaveLength(1);
      expect(transaction.signatures[0].signature).toBeNull();
      expect(transaction.signatures[0].publicKey.toBase58()).toBe(wallet);
      expect(transaction.feePayer?.toBase58()).toBe(wallet);
      expect(transaction.recentBlockhash).toBe(blockhash);
      expect(transaction.compileMessage().header).toEqual({
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 2,
      });
      expect(transaction.instructions).toHaveLength(1);
      expect(options).toEqual({
        preflightCommitment: "confirmed",
        skipPreflight: false,
      });
      const ix = transaction.instructions[0];
      expect(ix.programId.toBase58()).toBe(OPENFUNDS_PROGRAM_ADDRESS);
      const isCreate = Buffer.from(
        ANCHOR_DISCRIMINATORS.initializeCampaign,
      ).equals(ix.data.subarray(0, 8));
      const expectedKeys = isCreate
        ? [
            creator,
            campaignAddress,
            vaultAddress,
            "11111111111111111111111111111111",
          ]
        : [
            backer,
            campaignAddress,
            vaultAddress,
            contributionAddress,
            "11111111111111111111111111111111",
          ];
      expect(ix.keys.map((key) => key.pubkey.toBase58())).toEqual(expectedKeys);
      expect(ix.keys.map((key) => key.isSigner)).toEqual(
        expectedKeys.map((_, index) => index === 0),
      );
      expect(ix.keys.map((key) => key.isWritable)).toEqual(
        expectedKeys.map((_, index) => index !== expectedKeys.length - 1),
      );
      if (isCreate) expect(ix.data).toHaveLength(8);
      else {
        expect(ix.data).toHaveLength(16);
        expect([...ix.data.subarray(0, 8)]).toEqual(
          ANCHOR_DISCRIMINATORS.contribute,
        );
        expect(ix.data.readBigUInt64LE(8)).toBe(10_000_000n);
      }
      submissions.push({
        action: isCreate ? "create" : "contribute",
        wallet,
        contributionAddress: isCreate ? null : contributionAddress,
      });
      if (outcome !== "success") {
        return {
          error: {
            code: outcome === "cancelled" ? 4001 : -32603,
            message:
              outcome === "cancelled"
                ? "User rejected the request"
                : "Reached end of buffer unexpectedly",
          },
        };
      }
      if (isCreate) {
        expect(accounts.has(campaignAddress)).toBe(false);
        saveCampaign();
        accounts.set(
          vaultAddress,
          chainAccount(new Uint8Array(ANCHOR_DISCRIMINATORS.vault), vaultRent),
        );
        balances.set(
          creator,
          balances.get(creator)! - campaignRent - vaultRent - fee,
        );
      } else {
        expect(accounts.has(campaignAddress)).toBe(true);
        const first = !accounts.has(contributionAddress);
        campaignTotal += 10_000_000;
        backerTotal += 10_000_000;
        saveCampaign();
        saveContribution();
        accounts.get(vaultAddress)!.lamports += 10_000_000;
        balances.set(
          backer,
          balances.get(backer)! -
            10_000_000 -
            fee -
            (first ? contributionRent : 0),
        );
      }
      const signature = getBase58Decoder().decode(
        new Uint8Array(64).fill(signatures.length + 10),
      );
      signatures.push(signature);
      return { signature };
    },
  );

  await page.addInitScript(
    ({ creatorAddress }) => {
      type UnsignedTransaction = {
        serialize(config: {
          requireAllSignatures: false;
          verifySignatures: false;
        }): Uint8Array;
        serializeMessage(): Uint8Array;
        compileMessage(): unknown;
      };
      const testWindow = window as unknown as {
        __openFundsFixtureSubmit(request: FixtureWalletRequest): Promise<{
          signature?: string;
          error?: { code: number; message: string };
        }>;
        __openFundsFixtureWallet: {
          switchWallet(publicAddress: string): void;
          setOutcome(next: FixtureWalletOutcome): void;
        };
      };
      let selectedAddress = creatorAddress;
      let connected = false;
      let publicKey: { toString(): string } | null = null;
      let outcome: FixtureWalletOutcome = "success";
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
          return publicKey;
        },
        async connect() {
          connected = true;
          publicKey = { toString: () => selectedAddress };
          return { publicKey };
        },
        async disconnect() {
          connected = false;
          publicKey = null;
          listeners.get("disconnect")?.forEach((listener) => listener());
        },
        async request() {
          throw new Error("Reached end of buffer unexpectedly");
        },
        async signAndSendTransaction(
          transaction: UnsignedTransaction,
          options: unknown,
        ) {
          if (!connected || !publicKey)
            throw new Error("Fixture wallet is disconnected");
          if (
            Object.getPrototypeOf(transaction) === Object.prototype ||
            typeof transaction.serializeMessage !== "function" ||
            typeof transaction.compileMessage !== "function"
          )
            throw new Error(
              "Phantom requires a real legacy Transaction object",
            );
          const bytes = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          });
          const result = await testWindow.__openFundsFixtureSubmit({
            bytes: Array.from(bytes),
            wallet: selectedAddress,
            options,
            outcome,
          });
          if (result.error)
            throw Object.assign(new Error(result.error.message), {
              code: result.error.code,
            });
          return { signature: result.signature };
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
      testWindow.__openFundsFixtureWallet = {
        switchWallet(publicAddress) {
          selectedAddress = publicAddress;
          publicKey = connected ? { toString: () => selectedAddress } : null;
          listeners
            .get("accountChanged")
            ?.forEach((listener) => listener(publicKey));
        },
        setOutcome(next) {
          outcome = next;
        },
      };
    },
    { creatorAddress: creator },
  );

  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    let result: unknown;
    switch (request.method) {
      case "getGenesisHash":
        result = DEVNET_GENESIS;
        break;
      case "getAccountInfo":
        result = {
          context: { slot: 10 },
          value: accounts.get(request.params[0]) ?? null,
        };
        break;
      case "getMultipleAccounts":
        result = {
          context: { slot: 10 },
          value: request.params[0].map(
            (key: string) => accounts.get(key) ?? null,
          ),
        };
        break;
      case "getProgramAccounts": {
        expect(request.params[0]).toBe(OPENFUNDS_PROGRAM_ADDRESS);
        const config = request.params[1];
        expect(config.withContext).toBe(true);
        expect(config.encoding).toBe("base64");
        const rows = [...accounts.entries()]
          .filter(([, account]) => account.owner === request.params[0])
          .filter(([, account]) => {
            const data = Buffer.from(account.data[0], "base64");
            return config.filters.every(
              (filter: {
                dataSize?: number;
                memcmp?: { offset: number; bytes: string };
              }) => {
                if (filter.dataSize !== undefined)
                  return data.length === filter.dataSize;
                if (filter.memcmp) {
                  const expected = Buffer.from(
                    getBase58Encoder().encode(filter.memcmp.bytes),
                  );
                  return data
                    .subarray(
                      filter.memcmp.offset,
                      filter.memcmp.offset + expected.length,
                    )
                    .equals(expected);
                }
                throw new Error("Unexpected fixture account filter");
              },
            );
          })
          .map(([pubkey, account]) => ({ pubkey, account }));
        result = { context: { slot: 10 }, value: rows };
        break;
      }
      case "getSignaturesForAddress":
        expect(request.params[0]).toBe(campaignAddress);
        // This fixture models wallet submissions and current accounts only.
        // Persistent chain history has independent coverage in real-devnet.spec.ts.
        result = [];
        break;
      case "getBalance":
        result = {
          context: { slot: 10 },
          value: balances.get(request.params[0]) ?? 0,
        };
        break;
      case "getLatestBlockhash":
        result = {
          context: { slot: 10 },
          value: { blockhash, lastValidBlockHeight: 100 },
        };
        break;
      case "getSignatureStatuses":
        result = {
          context: { slot: 10 },
          value: request.params[0].map((signature: string) =>
            signatures.includes(signature)
              ? {
                  slot: 10,
                  confirmations: 1,
                  err: null,
                  confirmationStatus: "confirmed",
                }
              : null,
          ),
        };
        break;
      case "getBlockHeight":
        result = 10;
        break;
      default:
        throw new Error(`Unexpected fixture RPC method: ${request.method}`);
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  return {
    creator,
    backer,
    campaignAddress,
    vaultAddress,
    contributionAddress,
    accounts,
    submissions,
    signatures,
  };
}

function chainStat(page: Page, label: string) {
  return page
    .locator(".chain-stat-grid > div")
    .filter({
      has: page.getByText(label, { exact: true }),
    })
    .locator("strong");
}

async function fixtureWalletOutcome(page: Page, outcome: FixtureWalletOutcome) {
  await page.evaluate((next) => {
    (
      window as unknown as {
        __openFundsFixtureWallet: {
          setOutcome(value: FixtureWalletOutcome): void;
        };
      }
    ).__openFundsFixtureWallet.setOutcome(next);
  }, outcome);
}

test("Phantom typed transactions create a campaign and accumulate two backer deposits after real envelope decoding", async ({
  page,
}) => {
  const fixture = await installDeployedWalletFixture(page);
  await page.goto("/solana");
  await expect(page.getByText("Deployed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Connect Phantom", exact: true })
    .click();
  await expect(
    page.locator("main").getByText("5.5 SOL", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create campaign on Devnet", exact: true })
    .click();
  await expect(chainStat(page, "Campaign contributions")).toHaveText("0 SOL");
  await expect(chainStat(page, "Vault balance")).toHaveText("0.00094656 SOL");
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(1);

  await page.evaluate((publicAddress) => {
    (
      window as unknown as {
        __openFundsFixtureWallet: { switchWallet(value: string): void };
      }
    ).__openFundsFixtureWallet.switchWallet(publicAddress);
  }, fixture.backer);
  await page
    .getByLabel("Campaign creator's public address")
    .fill(fixture.creator);
  await page
    .getByRole("button", { name: "Load campaign", exact: true })
    .click();
  await expect(chainStat(page, "Your contribution")).toHaveText("0 SOL");
  await expect(
    page.getByText(
      "To create a campaign for the creator entered below, connect that creator's account in Phantom first.",
      { exact: true },
    ),
  ).toBeVisible();
  const contributionLink = page
    .locator(".chain-addresses > div")
    .filter({ has: page.getByText("Your Contribution PDA", { exact: true }) })
    .getByRole("link");
  const contributionHref = `https://explorer.solana.com/address/${fixture.contributionAddress}?cluster=devnet`;
  await expect(contributionLink).toHaveAttribute("href", contributionHref);

  for (const total of ["0.01", "0.02"]) {
    await page.getByLabel("Contribution amount (SOL)").fill("0.01");
    await page
      .getByRole("button", { name: "Contribute on Devnet", exact: true })
      .click();
    await expect(chainStat(page, "Campaign contributions")).toHaveText(
      `${total} SOL`,
    );
    await expect(chainStat(page, "Your contribution")).toHaveText(
      `${total} SOL`,
    );
    const backers = page.getByRole("region", { name: "Campaign backers" });
    await expect(backers.getByRole("listitem")).toHaveCount(1);
    await expect(
      backers.getByRole("listitem", { name: `Backer ${fixture.backer}` }),
    ).toContainText(`${total} SOL`);
    await expect(backers.getByRole("link")).toHaveAttribute(
      "href",
      `https://explorer.solana.com/address/${fixture.backer}?cluster=devnet`,
    );
    await expect(contributionLink).toHaveAttribute("href", contributionHref);
    await expect(
      page.getByText("The confirmed contribution updated all three amounts.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const label of [
      "Vault increase",
      "Campaign total increase",
      "Your contribution increase",
    ]) {
      await expect(
        page
          .locator(".chain-verification dl > div")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("dd"),
      ).toHaveText("0.01 SOL");
    }
  }
  await expect(chainStat(page, "Vault balance")).toHaveText("0.02094656 SOL");
  await expect(page.getByText("5.47854232 SOL", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(3);
  expect(fixture.submissions).toEqual([
    { action: "create", wallet: fixture.creator, contributionAddress: null },
    {
      action: "contribute",
      wallet: fixture.backer,
      contributionAddress: fixture.contributionAddress,
    },
    {
      action: "contribute",
      wallet: fixture.backer,
      contributionAddress: fixture.contributionAddress,
    },
  ]);
  expect(new Set(fixture.signatures).size).toBe(3);
});

for (const scenario of [
  {
    outcome: "cancelled",
    message: "Transaction approval was cancelled in Phantom.",
  },
  {
    outcome: "wallet-error",
    message: "Phantom could not complete this transaction.",
  },
] as const) {
  test(`Phantom ${scenario.outcome} reports the wallet stage without a false receipt and permits retry`, async ({
    page,
  }) => {
    const fixture = await installDeployedWalletFixture(page);
    await page.goto("/solana");
    await page
      .getByRole("button", { name: "Connect Phantom", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Create campaign on Devnet",
        exact: true,
      }),
    ).toBeEnabled();
    await fixtureWalletOutcome(page, scenario.outcome);
    await page
      .getByRole("button", { name: "Create campaign on Devnet", exact: true })
      .click();
    const feedbackAlert = page.locator('.chain-feedback[role="alert"]');
    await expect(feedbackAlert).toContainText(scenario.message);
    if (scenario.outcome === "wallet-error") {
      await expect(feedbackAlert).toContainText(
        "Reached end of buffer unexpectedly",
      );
    }
    await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        "No transaction receipt has been received in this session yet.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(fixture.accounts.has(fixture.campaignAddress)).toBe(false);
    expect(fixture.signatures).toHaveLength(0);
    await fixtureWalletOutcome(page, "success");
    await page
      .getByRole("button", { name: "Create campaign on Devnet", exact: true })
      .click();
    await expect(chainStat(page, "Campaign contributions")).toHaveText("0 SOL");
    await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(1);
    await expect(feedbackAlert).toHaveCount(0);
    expect(fixture.submissions).toHaveLength(2);
  });
}
