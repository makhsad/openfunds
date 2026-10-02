import assert from "node:assert/strict";
import { test } from "node:test";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
} from "@solana/kit";
import { DevnetLedger } from "../src/lib/solana/devnet-ledger";
import {
  ANCHOR_DISCRIMINATORS,
  DEVNET_GENESIS_HASH,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
  type DevnetRpcMethod,
  type DevnetRpcTransport,
  type RpcAccount,
} from "../src/lib/solana/phantom-gateway";

const creator = getAddressDecoder().decode(new Uint8Array(32).fill(1));
const backer = getAddressDecoder().decode(new Uint8Array(32).fill(2));
const other = getAddressDecoder().decode(new Uint8Array(32).fill(3));
const system = "11111111111111111111111111111111";
const sig = (byte: number) =>
  getBase58Decoder().decode(new Uint8Array(64).fill(byte));

function account(
  name: "campaign" | "vault" | "contribution",
  keys: string[] = [],
  total = 0n,
  lamports = 1_000n,
): RpcAccount {
  const data = new Uint8Array(
    name === "campaign" ? 48 : name === "vault" ? 8 : 80,
  );
  data.set(ANCHOR_DISCRIMINATORS[name]);
  keys.forEach((key, index) =>
    data.set(getAddressEncoder().encode(address(key)), 8 + index * 32),
  );
  if (name !== "vault")
    new DataView(data.buffer).setBigUint64(data.length - 8, total, true);
  return {
    owner: OPENFUNDS_PROGRAM_ADDRESS,
    executable: false,
    lamports,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}

type Row = { pubkey: string; account: RpcAccount };
async function fixture() {
  const one = await deriveCampaignAddresses(creator);
  const two = await deriveCampaignAddresses(backer);
  const contribution = await deriveContributionAddress(
    one.campaignAddress,
    backer,
  );
  const ownContribution = await deriveContributionAddress(
    one.campaignAddress,
    creator,
  );
  let campaigns: Row[] = [
    {
      pubkey: one.campaignAddress,
      account: account("campaign", [creator], 3_000_000_000n),
    },
    { pubkey: two.campaignAddress, account: account("campaign", [backer], 0n) },
  ];
  let contributions: Row[] = [
    {
      pubkey: contribution,
      account: account(
        "contribution",
        [one.campaignAddress, backer],
        2_000_000_000n,
      ),
    },
    {
      pubkey: ownContribution,
      account: account(
        "contribution",
        [one.campaignAddress, creator],
        1_000_000_000n,
      ),
    },
  ];
  const vaults = new Map([
    [one.vaultAddress, account("vault", [], 0n, 3_000_690_880n)],
    [two.vaultAddress, account("vault", [], 0n, 690_880n)],
  ]);
  let history: {
    signature: string;
    err: unknown;
    blockTime: bigint;
    confirmationStatus: string;
  }[] = [];
  const transactions = new Map<string, unknown>();
  const calls: { method: DevnetRpcMethod; params: readonly unknown[] }[] = [];
  let genesis = DEVNET_GENESIS_HASH;
  let networkError: Error | null = null;
  let inFlight = 0;
  let maxInFlight = 0;
  const rpc: DevnetRpcTransport = {
    async call<T>(method: DevnetRpcMethod, params: readonly unknown[]) {
      calls.push({ method, params });
      if (networkError) throw networkError;
      let value: unknown;
      if (method === "getGenesisHash") value = genesis;
      else if (method === "getProgramAccounts") {
        assert.equal(params[0], OPENFUNDS_PROGRAM_ADDRESS);
        const config = params[1] as {
          encoding: string;
          withContext: boolean;
          commitment: string;
          filters: {
            dataSize?: number;
            memcmp?: { offset: number; bytes: string };
          }[];
        };
        assert.equal(config.withContext, true);
        assert.equal(config.encoding, "base64");
        const size = config.filters.find((filter) => filter.dataSize)?.dataSize;
        let rows = (
          size === 48 || size === 49 ? campaigns : contributions
        ).filter(
          (row) => Buffer.from(row.account.data[0], "base64").length === size,
        );
        const identity = config.filters.find(
          (filter) => filter.memcmp && filter.memcmp.offset !== 0,
        )?.memcmp;
        if (identity)
          rows = rows.filter((row) => {
            const data = Buffer.from(row.account.data[0], "base64");
            return (
              getAddressDecoder().decode(
                data.subarray(identity.offset, identity.offset + 32),
              ) === identity.bytes
            );
          });
        value = { context: { slot: 1n }, value: rows };
      } else if (method === "getMultipleAccounts") {
        value = {
          value: (params[0] as string[]).map((key) => vaults.get(key) ?? null),
        };
      } else if (method === "getAccountInfo") {
        value = {
          value:
            campaigns.find((row) => row.pubkey === params[0])?.account ?? null,
        };
      } else if (method === "getSignaturesForAddress") {
        const options = params[1] as { limit: number; before?: string };
        const start = options.before
          ? history.findIndex((row) => row.signature === options.before) + 1
          : 0;
        value = history.slice(start, start + options.limit);
      } else if (method === "getTransaction") {
        assert.deepEqual(params[1], {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        value = transactions.get(params[0] as string) ?? null;
        inFlight -= 1;
      } else throw new Error(`Unexpected RPC method ${method}`);
      return value as T;
    },
  };

  async function transaction(
    signature: string,
    actor = backer,
    amount = 10_000_000n,
    rent = 0n,
    failed = false,
    initialize = false,
  ) {
    const contributionAddress = await deriveContributionAddress(
      one.campaignAddress,
      actor,
    );
    const accounts = initialize
      ? [creator, one.campaignAddress, one.vaultAddress, system]
      : [
          actor,
          one.campaignAddress,
          one.vaultAddress,
          contributionAddress,
          system,
        ];
    const data = new Uint8Array(initialize ? 8 : 16);
    data.set(
      ANCHOR_DISCRIMINATORS[initialize ? "initializeCampaign" : "contribute"],
    );
    if (!initialize) new DataView(data.buffer).setBigUint64(8, amount, true);
    const inner = [];
    if (!initialize)
      inner.push({
        programId: system,
        parsed: {
          type: "transfer",
          info: {
            source: actor,
            destination: one.vaultAddress,
            lamports: amount,
          },
        },
      });
    if (rent > 0n)
      inner.push({
        programId: system,
        parsed: {
          type: "createAccount",
          info: {
            source: actor,
            newAccount: initialize ? one.campaignAddress : contributionAddress,
            owner: OPENFUNDS_PROGRAM_ADDRESS,
            lamports: rent,
          },
        },
      });
    const error = failed ? { InstructionError: [0, { Custom: 6000 }] } : null;
    const keys = [...accounts, OPENFUNDS_PROGRAM_ADDRESS];
    const before = 9_000_000_000n;
    return {
      blockTime: 1_760_000_000n,
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: keys.map((pubkey, index) => ({
            pubkey,
            signer: index === 0,
            writable: index !== keys.length - 1,
          })),
          instructions: [
            {
              programId: OPENFUNDS_PROGRAM_ADDRESS,
              accounts,
              data: getBase58Decoder().decode(data),
            },
          ],
        },
      },
      meta: {
        err: error,
        fee: 5_000n,
        preBalances: keys.map((_, index) => (index === 0 ? before : 0n)),
        postBalances: keys.map((_, index) =>
          index === 0
            ? before -
              (failed ? 5_000n : (initialize ? 0n : amount) + rent + 5_000n)
            : 0n,
        ),
        innerInstructions: [{ index: 0n, instructions: inner }],
      },
    };
  }
  function setHistory(
    rows: { signature: string; err?: unknown; confirmationStatus?: string }[],
  ) {
    history = rows.map((row) => ({
      ...row,
      err: row.err ?? null,
      blockTime: 1_760_000_000n,
      confirmationStatus: row.confirmationStatus ?? "confirmed",
    }));
  }
  return {
    one,
    two,
    contribution,
    ownContribution,
    rpc,
    calls,
    transactions,
    transaction,
    setHistory,
    vaults,
    get campaigns() {
      return campaigns;
    },
    set campaigns(value) {
      campaigns = value;
    },
    get contributions() {
      return contributions;
    },
    set contributions(value) {
      contributions = value;
    },
    set genesis(value: string) {
      genesis = value;
    },
    set networkError(value: Error | null) {
      networkError = value;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

test("real campaign catalogue separates the recipient campaign and its vault from a sponsor's zero campaign", async () => {
  const f = await fixture();
  const rows = await new DevnetLedger(f.rpc).listCampaigns();
  const funded = rows.find((row) => row.creatorAddress === creator)!;
  assert.deepEqual(funded, {
    creatorAddress: creator,
    ...f.one,
    totalContributedLamports: "3000000000",
    vaultBalanceLamports: "3000690880",
  });
  assert.equal(
    rows.find((row) => row.creatorAddress === backer)?.totalContributedLamports,
    "0",
  );
  assert.equal(
    f.calls.filter((call) => call.method === "getMultipleAccounts").length,
    1,
  );
});

test("support and all backers use program contribution accounts, not browser sessions or campaign ownership", async () => {
  const f = await fixture();
  const ledger = new DevnetLedger(f.rpc);
  assert.deepEqual(await ledger.readSupport(backer), [
    {
      backerAddress: backer,
      campaignAddress: f.one.campaignAddress,
      contributionAddress: f.contribution,
      totalContributedLamports: "2000000000",
    },
  ]);
  const all = await ledger.readBackers(f.one.campaignAddress);
  assert.equal(all.length, 2);
  assert.equal(
    all.reduce((sum, row) => sum + BigInt(row.totalContributedLamports), 0n),
    3_000_000_000n,
  );
  assert.deepEqual(
    await new DevnetLedger(f.rpc).readBackers(f.two.campaignAddress),
    [],
  );
  assert.deepEqual(
    await new DevnetLedger(f.rpc).readSupport(backer),
    await ledger.readSupport(backer),
  );
});

test("account totals and vault lamports preserve u64 precision beyond safe JS integers", async () => {
  const f = await fixture();
  const large = (1n << 64n) - 1n;
  f.campaigns[0].account = account("campaign", [creator], large);
  f.vaults.set(f.one.vaultAddress, account("vault", [], 0n, large));
  const campaign = (await new DevnetLedger(f.rpc).listCampaigns()).find(
    (row) => row.creatorAddress === creator,
  )!;
  assert.equal(campaign.totalContributedLamports, large.toString());
  assert.equal(campaign.vaultBalanceLamports, large.toString());
  f.vaults.get(f.one.vaultAddress)!.lamports = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(
    new DevnetLedger(f.rpc).listCampaigns(),
    /invalid vault balance/,
  );
});

test("campaign catalogue rejects substituted PDAs, discriminator/layout corruption and foreign accounts", async () => {
  for (const mutation of [
    (row: Row) => {
      row.pubkey = other;
    },
    (row: Row) => {
      row.account.owner = system;
    },
    (row: Row) => {
      row.account.executable = true;
    },
    (row: Row) => {
      const data = Buffer.from(row.account.data[0], "base64");
      data.set(ANCHOR_DISCRIMINATORS.contribution, 0);
      row.account.data = [data.toString("base64"), "base64"];
    },
  ]) {
    const f = await fixture();
    mutation(f.campaigns[0]);
    await assert.rejects(
      new DevnetLedger(f.rpc).listCampaigns(),
      /PDA|owned|layout/,
    );
  }
  const f = await fixture();
  f.vaults.delete(f.one.vaultAddress);
  await assert.rejects(
    new DevnetLedger(f.rpc).listCampaigns(),
    /Vault is missing/,
  );
});

test("support rejects substituted Contribution addresses and wrong account owners", async () => {
  const f = await fixture();
  f.contributions[0].pubkey = other;
  await assert.rejects(
    new DevnetLedger(f.rpc).readSupport(backer),
    /Contribution address/,
  );
  const fresh = await fixture();
  fresh.contributions[0].account.owner = system;
  await assert.rejects(
    new DevnetLedger(fresh.rpc).readBackers(fresh.one.campaignAddress),
    /owned/,
  );
});

test("RPC failure or wrong genesis is reported instead of a fabricated empty catalogue", async () => {
  const f = await fixture();
  f.networkError = new Error("RPC is busy");
  await assert.rejects(new DevnetLedger(f.rpc).listCampaigns(), /RPC is busy/);
  f.networkError = null;
  f.genesis = "wrong-network";
  await assert.rejects(
    new DevnetLedger(f.rpc).readSupport(backer),
    /not Solana Devnet/,
  );
});

test("persistent history verifies CPI funding and separates contribution, wallet debit, rent and fee", async () => {
  const f = await fixture();
  f.setHistory([
    { signature: sig(7), confirmationStatus: "finalized" },
    { signature: sig(8) },
  ]);
  f.transactions.set(
    sig(7),
    await f.transaction(sig(7), backer, 10_000_000n, 1_447_680n),
  );
  f.transactions.set(sig(8), await f.transaction(sig(8), backer, 10_000_000n));
  const page = await new DevnetLedger(f.rpc).readActivity(
    f.one.campaignAddress,
  );
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items[0], {
    signature: sig(7),
    campaignAddress: f.one.campaignAddress,
    vaultAddress: f.one.vaultAddress,
    actorAddress: backer,
    kind: "contribution",
    status: "finalized",
    amountLamports: "10000000",
    feeLamports: "5000",
    walletDebitLamports: "11452680",
    storageRentLamports: "1447680",
    blockTime: 1_760_000_000,
  });
  assert.equal(page.items[1].storageRentLamports, "0");
  assert.equal(page.items[1].walletDebitLamports, "10005000");
  assert.deepEqual(
    await new DevnetLedger(f.rpc).readActivity(f.one.campaignAddress),
    page,
  );
});

test("initialization appears as account creation rather than a donation", async () => {
  const f = await fixture();
  f.setHistory([{ signature: sig(7) }]);
  f.transactions.set(
    sig(7),
    await f.transaction(sig(7), creator, 0n, 1_224_960n, false, true),
  );
  const row = (
    await new DevnetLedger(f.rpc).readActivity(f.one.campaignAddress)
  ).items[0];
  assert.equal(row.kind, "initialize");
  assert.equal(row.amountLamports, "0");
  assert.equal(row.storageRentLamports, "1224960");
});

test("failed transactions never count requested amounts as contributions and missing transactions are explicit", async () => {
  const f = await fixture();
  f.setHistory([
    { signature: sig(7), err: { InstructionError: [0, "failed"] } },
    { signature: sig(8) },
  ]);
  f.transactions.set(
    sig(7),
    await f.transaction(sig(7), backer, 999_000_000n, 0n, true),
  );
  const rows = (
    await new DevnetLedger(f.rpc).readActivity(f.one.campaignAddress)
  ).items;
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].amountLamports, null);
  assert.equal(rows[0].walletDebitLamports, "5000");
  assert.equal(rows[0].storageRentLamports, null);
  assert.equal(rows[1].status, "unavailable");
  assert.equal(rows[1].kind, "unavailable");
  assert.equal(rows[1].amountLamports, null);
  assert.equal(
    (await new DevnetLedger(f.rpc).listCampaigns()).find(
      (row) => row.creatorAddress === creator,
    )?.totalContributedLamports,
    "3000000000",
  );
});

test("wallet transfers, unverified signer, wrong PDA and CPI amount mismatch are not labelled successful contributions", async () => {
  for (const mutate of [
    (
      tx: Awaited<
        ReturnType<Awaited<ReturnType<typeof fixture>>["transaction"]>
      >,
    ) => {
      tx.transaction.message.instructions[0].programId = system;
    },
    (
      tx: Awaited<
        ReturnType<Awaited<ReturnType<typeof fixture>>["transaction"]>
      >,
    ) => {
      tx.transaction.message.accountKeys[0].signer = false;
    },
    (
      tx: Awaited<
        ReturnType<Awaited<ReturnType<typeof fixture>>["transaction"]>
      >,
    ) => {
      tx.transaction.message.instructions[0].accounts[2] = other;
    },
    (
      tx: Awaited<
        ReturnType<Awaited<ReturnType<typeof fixture>>["transaction"]>
      >,
    ) => {
      tx.meta.innerInstructions = [];
    },
  ]) {
    const f = await fixture();
    f.setHistory([{ signature: sig(7) }]);
    const tx = await f.transaction(sig(7));
    mutate(tx);
    f.transactions.set(sig(7), tx);
    const page = await new DevnetLedger(f.rpc).readActivity(
      f.one.campaignAddress,
    );
    assert.ok(
      page.items.every(
        (row) => row.amountLamports === null && row.status === "unavailable",
      ),
    );
  }
});

test("history pagination is bounded, uses the last RPC signature cursor and limits concurrency to two", async () => {
  const f = await fixture();
  f.setHistory([7, 8, 9, 10, 11].map((byte) => ({ signature: sig(byte) })));
  for (const byte of [7, 8, 9, 10, 11])
    f.transactions.set(sig(byte), await f.transaction(sig(byte)));
  const ledger = new DevnetLedger(f.rpc);
  const first = await ledger.readActivity(f.one.campaignAddress, { limit: 3 });
  assert.equal(first.hasMore, true);
  assert.equal(first.nextBefore, sig(9));
  assert.equal(first.items.length, 3);
  const next = await ledger.readActivity(f.one.campaignAddress, {
    limit: 3,
    before: first.nextBefore!,
  });
  assert.equal(next.hasMore, false);
  assert.equal(next.nextBefore, null);
  assert.equal(next.items.length, 2);
  assert.ok(f.maxInFlight <= 2);
  const calls = f.calls.length;
  await assert.rejects(
    ledger.readActivity(f.one.campaignAddress, { limit: 21 }),
    /between 1 and 20/,
  );
  await assert.rejects(
    ledger.readActivity(f.one.campaignAddress, { before: "bad-signature" }),
  );
  assert.equal(f.calls.length, calls);
});
