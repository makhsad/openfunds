import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  type Instruction,
} from "@solana/kit";
import {
  ProjectGateway,
  validateProjectMetadata,
} from "../src/lib/solana/project-gateway";
import {
  PROJECT_DISCRIMINATORS,
  PROJECT_INSTRUCTIONS,
  ProjectLedger,
  deriveLegacyClosureAddress,
  deriveLegacyReceiptAddress,
  deriveLegacyDiscussionAddress,
  derivePlatformAddress,
  deriveProjectAddresses,
  deriveProjectContributionAddress,
  deriveProjectMessageAddress,
  projectU64,
} from "../src/lib/solana/project-ledger";
import {
  ANCHOR_DISCRIMINATORS,
  DEVNET_GENESIS_HASH,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
  type DevnetRpcTransport,
  type DevnetRpcMethod,
  type PhantomCampaignGateway,
  type RpcAccount,
} from "../src/lib/solana/phantom-gateway";

const creator = getAddressDecoder().decode(new Uint8Array(32).fill(11));
const backer = getAddressDecoder().decode(new Uint8Array(32).fill(12));
const other = getAddressDecoder().decode(new Uint8Array(32).fill(13));
const sig = getBase58Decoder().decode(new Uint8Array(64).fill(14));
const system = "11111111111111111111111111111111";
const amount = 9_007_199_254_740_993n;

function key(data: Uint8Array, offset: number, value: string) {
  data.set(getAddressEncoder().encode(address(value)), offset);
}
function u64(data: Uint8Array, offset: number, value: bigint) {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(
    offset,
    value,
    true,
  );
}
function text(data: Uint8Array, offset: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  new DataView(data.buffer).setUint32(offset, bytes.length, true);
  data.set(bytes, offset + 4);
  return offset + 4 + bytes.length;
}
function account(data: Uint8Array, lamports = 1_000n): RpcAccount {
  return {
    owner: OPENFUNDS_PROGRAM_ADDRESS,
    executable: false,
    lamports,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}
function blank(name: keyof typeof PROJECT_DISCRIMINATORS, size: number) {
  const data = new Uint8Array(size);
  data.set(PROJECT_DISCRIMINATORS[name]);
  return data;
}
function project(
  creatorAddress = creator,
  id = 1n,
  raised = amount,
  refunded = 0n,
  status = 0,
): RpcAccount {
  const data = blank("campaign", 789);
  key(data, 8, creatorAddress);
  u64(data, 40, id);
  u64(data, 48, amount * 2n);
  u64(data, 56, raised);
  u64(data, 64, refunded);
  u64(data, 72, 1n);
  u64(data, 80, 1_700_000_000n);
  data[96] = status;
  const afterTitle = text(data, 97, "Тестовый проект");
  const afterDescription = text(
    data,
    afterTitle,
    "Общий проект для двух устройств",
  );
  text(data, afterDescription, "https://example.org/image.png");
  return account(data);
}
function contribution(
  campaign: string,
  backerAddress = backer,
  raised = amount,
  refunded = 0n,
): RpcAccount {
  const data = blank("contribution", 88);
  key(data, 8, campaign);
  key(data, 40, backerAddress);
  u64(data, 72, raised);
  u64(data, 80, refunded);
  return account(data);
}

async function fixture() {
  const one = await deriveProjectAddresses(creator, "1");
  const two = await deriveProjectAddresses(creator, "2");
  const sponsor = await deriveProjectContributionAddress(
    one.campaignAddress,
    backer,
  );
  const messageAddress = await deriveProjectMessageAddress(
    one.campaignAddress,
    "0",
  );
  const platformAddress = await derivePlatformAddress();
  const platform = blank("platform", 9);
  platform[8] = 2;
  const message = blank("message", 332);
  key(message, 8, one.campaignAddress);
  key(message, 40, backer);
  u64(message, 72, 0n);
  u64(message, 80, 1_700_000_010n);
  text(message, 88, "Поддержал проект!");
  const accounts = new Map<string, RpcAccount>([
    [one.campaignAddress, project()],
    [two.campaignAddress, project(creator, 2n, 0n)],
    [one.vaultAddress, account(blank("vault", 8), amount + 690_880n)],
    [two.vaultAddress, account(blank("vault", 8), 690_880n)],
    [sponsor, contribution(one.campaignAddress)],
    [messageAddress, account(message)],
    [platformAddress, account(platform)],
  ]);
  let genesis = DEVNET_GENESIS_HASH;
  let history: unknown[] = [];
  let transactionStatus: {
    err: unknown;
    confirmationStatus: string | null;
  } | null = null;
  const transactions = new Map<string, unknown>();
  const sent: Instruction[] = [];
  const wallet = {
    connectedAddress: creator as string | null,
    programAddress: OPENFUNDS_PROGRAM_ADDRESS,
    async sendInstruction(ix: Instruction) {
      sent.push(ix);
      return sig;
    },
    async contribute() {
      throw new Error("Legacy contribution not expected in this fixture.");
    },
  };
  const rpc: DevnetRpcTransport = {
    async call<T>(method: DevnetRpcMethod, params: readonly unknown[]) {
      let result: unknown;
      if (method === "getGenesisHash") result = genesis;
      else if (method === "getAccountInfo")
        result = { value: accounts.get(params[0] as string) ?? null };
      else if (method === "getMultipleAccounts")
        result = {
          value: (params[0] as string[]).map(
            (key) => accounts.get(key) ?? null,
          ),
        };
      else if (method === "getProgramAccounts") {
        const config = params[1] as {
          filters: {
            dataSize?: number;
            memcmp?: { offset: number; bytes: string };
          }[];
        };
        result = {
          value: [...accounts.entries()]
            .filter(([, account]) => {
              const bytes = Buffer.from(account.data[0], "base64");
              return config.filters.every((filter) =>
                filter.dataSize !== undefined
                  ? bytes.length === filter.dataSize
                  : filter.memcmp
                    ? Buffer.from(
                        getBase58Encoder().encode(filter.memcmp.bytes),
                      ).equals(
                        bytes.subarray(
                          filter.memcmp.offset,
                          filter.memcmp.offset +
                            getBase58Encoder().encode(filter.memcmp.bytes)
                              .length,
                        ),
                      )
                    : true,
              );
            })
            .map(([pubkey, account]) => ({ pubkey, account })),
        };
      } else if (method === "getSignaturesForAddress") result = history;
      else if (method === "getSignatureStatuses")
        result = { value: [transactionStatus] };
      else if (method === "getTransaction")
        result = transactions.get(params[0] as string) ?? null;
      else throw new Error(`Unexpected RPC ${method}`);
      return result as T;
    },
  };
  return {
    one,
    two,
    sponsor,
    messageAddress,
    platformAddress,
    accounts,
    wallet,
    sent,
    transactions,
    rpc,
    ledger: new ProjectLedger(rpc),
    gateway: new ProjectGateway({
      walletGateway: wallet as unknown as PhantomCampaignGateway,
      rpc,
    }),
    setGenesis(value: string) {
      genesis = value;
    },
    setHistory(value: unknown[]) {
      history = value;
    },
    setStatus(value: typeof transactionStatus) {
      transactionStatus = value;
    },
  };
}

test("project identifiers derive independent campaigns, vaults and per-project contributions", async () => {
  const fixture1 = await fixture();
  const creatorB = await deriveProjectAddresses(other, "1");
  assert.notEqual(fixture1.one.campaignAddress, fixture1.two.campaignAddress);
  assert.notEqual(fixture1.one.vaultAddress, fixture1.two.vaultAddress);
  assert.notEqual(fixture1.one.campaignAddress, creatorB.campaignAddress);
  assert.notEqual(
    await deriveProjectContributionAddress(
      fixture1.one.campaignAddress,
      backer,
    ),
    await deriveProjectContributionAddress(
      fixture1.two.campaignAddress,
      backer,
    ),
  );
  const result = await fixture1.ledger.listProjects();
  assert.equal(result.length, 2);
  assert.equal(
    result.find((item) => item.campaignId === "1")!.totalContributedLamports,
    amount.toString(),
  );
  assert.equal(
    result.find((item) => item.campaignId === "2")!.totalContributedLamports,
    "0",
  );
});

test("pending confirmations can be rechecked without repeating the signed transaction", async () => {
  const f = await fixture();
  assert.equal(await f.gateway.readTransactionStatus(sig), "pending");
  f.setStatus({ err: null, confirmationStatus: "processed" });
  assert.equal(await f.gateway.readTransactionStatus(sig), "pending");
  f.setStatus({ err: null, confirmationStatus: "confirmed" });
  assert.equal(await f.gateway.readTransactionStatus(sig), "confirmed");
  f.setStatus({
    err: { InstructionError: [0, "Failed"] },
    confirmationStatus: "finalized",
  });
  assert.equal(await f.gateway.readTransactionStatus(sig), "failed");
  await assert.rejects(
    f.gateway.readTransactionStatus("not-a-signature"),
    /signature/,
  );
  assert.equal(f.sent.length, 0);
});

test("read model preserves lamport precision, metadata and shared chat identities", async () => {
  const f = await fixture();
  const p = await f.ledger.readProject(f.one.campaignAddress);
  assert.equal(p.title, "Тестовый проект");
  assert.equal(p.totalContributedLamports, amount.toString());
  assert.equal(p.vaultBalanceLamports, (amount + 690_880n).toString());
  const supporter = await f.ledger.readMyContribution(
    f.one.campaignAddress,
    backer,
  );
  assert.equal(supporter?.refundableLamports, amount.toString());
  assert.equal(
    (await f.ledger.listBackers(f.one.campaignAddress))[0].backerAddress,
    backer,
  );
  assert.equal(
    (await f.ledger.listMyContributions(backer))[0].campaignAddress,
    f.one.campaignAddress,
  );
  assert.equal((await f.ledger.listMyContributions(other)).length, 0);
  const messages = await f.ledger.listMessages(f.one.campaignAddress);
  assert.deepEqual(
    messages.map((item) => [item.authorAddress, item.body, item.messageId]),
    [[backer, "Поддержал проект!", "0"]],
  );
});

test("read model rejects substituted project, contribution, message and vault accounts", async () => {
  const f = await fixture();
  f.accounts.set(f.one.campaignAddress, project(other));
  await assert.rejects(
    f.ledger.readProject(f.one.campaignAddress),
    /canonical/,
  );
  f.accounts.set(f.one.campaignAddress, project());
  f.accounts.set(f.sponsor, contribution(f.one.campaignAddress, other));
  await assert.rejects(
    f.ledger.readMyContribution(f.one.campaignAddress, backer),
    /canonical/,
  );
  f.accounts.set(f.sponsor, contribution(f.one.campaignAddress));
  f.accounts.set(f.one.vaultAddress, {
    ...f.accounts.get(f.one.vaultAddress)!,
    owner: system,
  });
  await assert.rejects(f.ledger.readProject(f.one.campaignAddress), /owner/);
  f.accounts.set(
    f.one.vaultAddress,
    account(blank("vault", 8), amount + 690_880n),
  );
  const badMessage = Buffer.from(
    f.accounts.get(f.messageAddress)!.data[0],
    "base64",
  );
  u64(badMessage, 72, 1n);
  f.accounts.set(f.messageAddress, account(badMessage));
  await assert.rejects(
    f.ledger.listMessages(f.one.campaignAddress),
    /canonical/,
  );
});

test("read model rejects truncated Borsh strings, unsafe RPC numbers and impossible refunds", async () => {
  const f = await fixture();
  const data = Buffer.from(project().data[0], "base64");
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(
    97,
    81,
    true,
  );
  f.accounts.set(f.one.campaignAddress, account(data));
  await assert.rejects(
    f.ledger.readProject(f.one.campaignAddress),
    /metadata length/,
  );
  f.accounts.set(
    f.one.campaignAddress,
    project(creator, 1n, amount, amount + 1n, 1),
  );
  await assert.rejects(
    f.ledger.readProject(f.one.campaignAddress),
    /funding state/,
  );
  f.accounts.set(f.one.campaignAddress, project());
  f.accounts.set(f.one.vaultAddress, account(blank("vault", 8), amount));
  f.accounts.set(f.one.vaultAddress, {
    ...f.accounts.get(f.one.vaultAddress)!,
    lamports: Number(amount),
  });
  await assert.rejects(
    f.ledger.readProject(f.one.campaignAddress),
    /invalid integer/,
  );
});

test("capability marker, metadata and signer guards block unsupported mutations before Phantom", async () => {
  const f = await fixture();
  assert.deepEqual(await f.ledger.readCapabilities(), {
    available: true,
    version: 2,
  });
  f.accounts.delete(f.platformAddress);
  assert.deepEqual(await f.ledger.readCapabilities(), {
    available: false,
    version: 1,
  });
  await assert.rejects(
    f.gateway.initializeProject({
      campaignId: "3",
      title: "New",
      description: "Description",
      imageUrl: "",
      goalLamports: "10",
    }),
    /upgrade/,
  );
  assert.equal(f.sent.length, 0);
  await f.gateway.initializePlatform();
  assert.equal(f.sent.length, 1);
  assert.deepEqual([...f.sent[0].data!], PROJECT_INSTRUCTIONS.platform);
  assert.throws(
    () =>
      validateProjectMetadata({
        campaignId: "1",
        title: "я".repeat(41),
        description: "",
        imageUrl: "",
        goalLamports: "10",
      }),
    /UTF-8/,
  );
  assert.throws(
    () =>
      validateProjectMetadata({
        campaignId: "1",
        title: "Fine",
        description: "Description",
        imageUrl: "javascript:alert(1)",
        goalLamports: "10",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateProjectMetadata({
        campaignId: "1",
        title: "Fine",
        description: " ",
        imageUrl: "",
        goalLamports: "10",
      }),
    /Description/,
  );
  assert.throws(() => projectU64("18446744073709551616"), /u64/);
  f.setGenesis("Mainnet");
  await assert.rejects(f.ledger.readCapabilities(), /not Solana Devnet/);
});

test("gateway encodes exact V2 ABI and signs only selected wallet", async () => {
  const f = await fixture();
  const created = await f.gateway.initializeProject({
    campaignId: "3",
    title: "Title",
    description: "Desc",
    imageUrl: "",
    goalLamports: "1000000000",
  });
  assert.equal(
    created.campaignAddress,
    (await deriveProjectAddresses(creator, "3")).campaignAddress,
  );
  assert.deepEqual(
    [...f.sent[0].data!.subarray(0, 8)],
    PROJECT_INSTRUCTIONS.initialize,
  );
  assert.equal(
    new DataView(
      f.sent[0].data!.buffer,
      f.sent[0].data!.byteOffset,
    ).getBigUint64(8, true),
    3n,
  );
  await assert.rejects(
    f.gateway.initializeProject({
      campaignId: "1",
      title: "Duplicate",
      description: "Description",
      imageUrl: "",
      goalLamports: "1000000000",
    }),
    /already exists/,
  );
  f.wallet.connectedAddress = backer;
  await f.gateway.contribute(f.one.campaignAddress, "10000000");
  assert.equal(f.sent[1].accounts![0].address, backer);
  assert.equal(f.sent[1].accounts![3].address, f.sponsor);
  await f.gateway.postMessage(f.one.campaignAddress, "Спасибо!");
  assert.equal(
    f.sent[2].accounts![3].address,
    await deriveProjectMessageAddress(f.one.campaignAddress, "1"),
  );
  await assert.rejects(
    f.gateway.contribute(f.one.campaignAddress, "0"),
    /greater than zero/,
  );
  f.wallet.connectedAddress = other;
  await assert.rejects(
    f.gateway.postMessage(f.one.campaignAddress, "Spam"),
    /backers/,
  );
  await assert.rejects(
    f.gateway.closeProject(f.one.campaignAddress),
    /creator/,
  );
});

test("closure and refunds require creator or exact backer, and reject double refund", async () => {
  const f = await fixture();
  await f.gateway.closeProject(f.one.campaignAddress);
  assert.deepEqual([...f.sent[0].data!], PROJECT_INSTRUCTIONS.close);
  assert.equal(f.sent[0].accounts![0].role, AccountRole.READONLY_SIGNER);
  f.accounts.set(f.one.campaignAddress, project(creator, 1n, amount, 0n, 1));
  await assert.rejects(
    f.gateway.contribute(f.one.campaignAddress, "1"),
    /closed/,
  );
  await assert.rejects(
    f.gateway.postMessage(f.one.campaignAddress, "after close"),
    /archived/,
  );
  f.wallet.connectedAddress = other;
  await assert.rejects(
    f.gateway.refund(f.one.campaignAddress, backer),
    /creator or/,
  );
  f.wallet.connectedAddress = backer;
  await f.gateway.refund(f.one.campaignAddress, backer);
  assert.equal(f.sent[1].accounts![4].address, backer);
  f.accounts.set(
    f.sponsor,
    contribution(f.one.campaignAddress, backer, amount, amount),
  );
  f.accounts.set(
    f.one.campaignAddress,
    project(creator, 1n, amount, amount, 2),
  );
  f.accounts.set(f.one.vaultAddress, account(blank("vault", 8), 690_880n));
  assert.equal(
    (await f.ledger.readMyContribution(f.one.campaignAddress, backer))!
      .refundableLamports,
    "0",
  );
  await assert.rejects(
    f.gateway.refund(f.one.campaignAddress, backer),
    /no remaining/,
  );
  f.wallet.connectedAddress = creator;
  await assert.rejects(
    f.gateway.closeProject(f.one.campaignAddress),
    /already closed/,
  );
});

test("legacy closure preserves historical totals and refunds use protected receipt PDAs", async () => {
  const f = await fixture();
  const legacy = await deriveCampaignAddresses(creator);
  const support = await deriveContributionAddress(
    legacy.campaignAddress,
    backer,
  );
  const campaign = new Uint8Array(49);
  campaign.set(ANCHOR_DISCRIMINATORS.campaign);
  key(campaign, 8, creator);
  u64(campaign, 40, 100_000_000n);
  campaign[48] = 1;
  const vault = new Uint8Array(8);
  vault.set(ANCHOR_DISCRIMINATORS.vault);
  const contribution = new Uint8Array(80);
  contribution.set(ANCHOR_DISCRIMINATORS.contribution);
  key(contribution, 8, legacy.campaignAddress);
  key(contribution, 40, backer);
  u64(contribution, 72, 100_000_000n);
  const closure = blank("legacyClosure", 89);
  key(closure, 8, legacy.campaignAddress);
  key(closure, 40, creator);
  closure[80] = 1;
  u64(closure, 81, 1_700_000_000n);
  f.accounts.set(legacy.campaignAddress, account(campaign));
  f.accounts.set(legacy.vaultAddress, account(vault, 100_690_880n));
  f.accounts.set(support, account(contribution));
  f.accounts.set(
    await deriveLegacyClosureAddress(legacy.campaignAddress),
    account(closure),
  );
  const p = await f.ledger.readProject(legacy.campaignAddress);
  assert.equal(p.legacy, true);
  assert.equal(p.closed, true);
  assert.equal(p.totalContributedLamports, "100000000");
  await f.gateway.refund(legacy.campaignAddress, backer);
  assert.deepEqual([...f.sent[0].data!], PROJECT_INSTRUCTIONS.legacyRefund);
  assert.equal(
    f.sent[0].accounts![5].address,
    await deriveLegacyReceiptAddress(legacy.campaignAddress, backer),
  );
  assert.equal(f.sent[0].accounts![6].address, backer);
  const receipt = blank("legacyReceipt", 80);
  key(receipt, 8, legacy.campaignAddress);
  key(receipt, 40, backer);
  u64(receipt, 72, 100_000_000n);
  f.accounts.set(
    await deriveLegacyReceiptAddress(legacy.campaignAddress, backer),
    account(receipt),
  );
  await assert.rejects(
    f.gateway.refund(legacy.campaignAddress, backer),
    /no remaining/,
  );
});

test("existing campaigns share participant-only on-chain chat without changing their financial accounts", async () => {
  const f = await fixture();
  const legacy = await deriveCampaignAddresses(creator);
  const campaign = new Uint8Array(48);
  campaign.set(ANCHOR_DISCRIMINATORS.campaign);
  key(campaign, 8, creator);
  u64(campaign, 40, 100_000_000n);
  const vault = new Uint8Array(8);
  vault.set(ANCHOR_DISCRIMINATORS.vault);
  const support = new Uint8Array(80);
  support.set(ANCHOR_DISCRIMINATORS.contribution);
  key(support, 8, legacy.campaignAddress);
  key(support, 40, backer);
  u64(support, 72, 100_000_000n);
  const discussion = blank("legacyDiscussion", 48);
  key(discussion, 8, legacy.campaignAddress);
  u64(discussion, 40, 1n);
  const message = blank("message", 332);
  key(message, 8, legacy.campaignAddress);
  key(message, 40, backer);
  u64(message, 72, 0n);
  u64(message, 80, 1_700_000_000n);
  text(message, 88, "Вижу свой взнос");
  f.accounts.set(legacy.campaignAddress, account(campaign));
  f.accounts.set(legacy.vaultAddress, account(vault, 100_690_880n));
  f.accounts.set(
    await deriveContributionAddress(legacy.campaignAddress, backer),
    account(support),
  );
  f.accounts.set(
    await deriveLegacyDiscussionAddress(legacy.campaignAddress),
    account(discussion),
  );
  f.accounts.set(
    await deriveProjectMessageAddress(legacy.campaignAddress, "0"),
    account(message),
  );
  const project = await f.ledger.readProject(legacy.campaignAddress);
  assert.equal(project.messageCount, "1");
  assert.equal(project.totalContributedLamports, "100000000");
  assert.equal(
    (await f.ledger.listMessages(legacy.campaignAddress))[0].body,
    "Вижу свой взнос",
  );
  f.wallet.connectedAddress = backer;
  await f.gateway.postMessage(legacy.campaignAddress, "Спасибо");
  assert.deepEqual(
    [...f.sent[0].data!.subarray(0, 8)],
    PROJECT_INSTRUCTIONS.legacyMessage,
  );
  assert.equal(f.sent[0].accounts!.length, 6);
  assert.equal(
    f.sent[0].accounts![3].address,
    await deriveLegacyDiscussionAddress(legacy.campaignAddress),
  );
  assert.equal(
    f.sent[0].accounts![4].address,
    await deriveProjectMessageAddress(legacy.campaignAddress, "1"),
  );
  f.wallet.connectedAddress = other;
  await assert.rejects(
    f.gateway.postMessage(legacy.campaignAddress, "Spam"),
    /backers/,
  );
  key(message, 40, other);
  f.accounts.set(
    await deriveProjectMessageAddress(legacy.campaignAddress, "0"),
    account(message),
  );
  await assert.rejects(
    f.ledger.listMessages(legacy.campaignAddress),
    /recorded backer/,
  );
});

test("transaction history counts only confirmed exact vault transfers and verified refunds", async () => {
  const f = await fixture();
  const data = new Uint8Array(16);
  data.set(PROJECT_INSTRUCTIONS.contribution);
  u64(data, 8, 10_000_000n);
  f.setHistory([
    {
      signature: sig,
      err: null,
      blockTime: 1_700_000_000n,
      confirmationStatus: "finalized",
    },
  ]);
  const raw = {
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [
          { pubkey: backer, signer: true },
          { pubkey: f.one.campaignAddress, signer: false },
          { pubkey: f.one.vaultAddress, signer: false },
        ],
        instructions: [
          {
            programId: OPENFUNDS_PROGRAM_ADDRESS,
            accounts: [
              backer,
              f.one.campaignAddress,
              f.one.vaultAddress,
              f.sponsor,
              system,
            ],
            data: getBase58Decoder().decode(data),
          },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000n,
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programId: system,
              parsed: {
                type: "transfer",
                info: {
                  source: backer,
                  destination: f.one.vaultAddress,
                  lamports: 10_000_000n,
                },
              },
            },
          ],
        },
      ],
    },
  };
  f.transactions.set(sig, raw);
  let history = await f.ledger.listActivity(f.one.campaignAddress);
  assert.equal(history.items[0].amountLamports, "10000000");
  assert.equal(history.items[0].status, "finalized");
  raw.meta.innerInstructions[0].instructions[0].parsed.info.destination = other;
  history = await f.ledger.listActivity(f.one.campaignAddress);
  assert.equal(history.items[0].amountLamports, null);
  assert.equal(history.items[0].status, "unavailable");
  raw.meta.err = { InstructionError: [0, "Rejected"] } as unknown as null;
  history = await f.ledger.listActivity(f.one.campaignAddress);
  assert.equal(history.items[0].status, "failed");
  assert.equal(history.items[0].amountLamports, null);
  f.transactions.set(sig, {
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [
          { pubkey: creator, signer: true },
          { pubkey: f.one.campaignAddress, signer: false },
          { pubkey: f.one.vaultAddress, signer: false },
          { pubkey: f.sponsor, signer: false },
          { pubkey: backer, signer: false },
        ],
        instructions: [
          {
            programId: OPENFUNDS_PROGRAM_ADDRESS,
            accounts: [
              creator,
              f.one.campaignAddress,
              f.one.vaultAddress,
              f.sponsor,
              backer,
            ],
            data: getBase58Decoder().decode(
              Uint8Array.from(PROJECT_INSTRUCTIONS.refund),
            ),
          },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000n,
      preBalances: [1000000n, 1000n, amount + 690880n, 1000n, 10000n],
      postBalances: [995000n, 1000n, 690880n, 1000n, amount + 10000n],
    },
  });
  history = await f.ledger.listActivity(f.one.campaignAddress);
  assert.equal(history.items[0].kind, "refund");
  assert.equal(history.items[0].amountLamports, amount.toString());
  assert.equal(history.items[0].recipientAddress, backer);
});

test("history rejects a transaction whose returned signature does not match the requested signature", async () => {
  const f = await fixture();
  f.setHistory([
    {
      signature: sig,
      err: null,
      blockTime: 1_700_000_000n,
      confirmationStatus: "finalized",
    },
  ]);
  f.transactions.set(sig, {
    transaction: {
      signatures: [getBase58Decoder().decode(new Uint8Array(64).fill(99))],
      message: {
        accountKeys: [
          { pubkey: creator, signer: true },
          { pubkey: f.one.campaignAddress, signer: false },
        ],
        instructions: [
          {
            programId: OPENFUNDS_PROGRAM_ADDRESS,
            accounts: [creator, f.one.campaignAddress],
            data: getBase58Decoder().decode(
              Uint8Array.from(PROJECT_INSTRUCTIONS.close),
            ),
          },
        ],
      },
    },
    meta: { err: null, fee: 5000n },
  });
  const history = await f.ledger.listActivity(f.one.campaignAddress);
  assert.equal(history.items[0].status, "unavailable");
  assert.equal(history.items[0].kind, "unavailable");
  assert.equal(history.items[0].amountLamports, null);
  assert.equal(history.items[0].actorAddress, null);
});
