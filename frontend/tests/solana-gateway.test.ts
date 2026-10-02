import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Message, Transaction } from "@solana/web3.js";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  ANCHOR_DISCRIMINATORS,
  CampaignNotInitializedError,
  DEVNET_GENESIS_HASH,
  DEVNET_PROXY_PATH,
  OPENFUNDS_PROGRAM_ADDRESS,
  PhantomCampaignGateway,
  TransactionConfirmationError,
  TransactionStageError,
  deriveCampaignAddresses,
  deriveContributionAddress,
  parseContributionLamports,
  type DevnetRpcMethod,
  type DevnetRpcTransport,
  type PhantomProvider,
  type RpcAccount,
} from "../src/lib/solana/phantom-gateway";

const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
const creator = getAddressDecoder().decode(new Uint8Array(32).fill(1));
const backer = getAddressDecoder().decode(new Uint8Array(32).fill(2));
const other = getAddressDecoder().decode(new Uint8Array(32).fill(3));
const validSignature = getBase58Decoder().decode(new Uint8Array(64).fill(7));

type WalletRequest = {
  transaction: Parameters<PhantomProvider["signAndSendTransaction"]>[0];
  options: Parameters<PhantomProvider["signAndSendTransaction"]>[1];
};

class TestPhantom implements PhantomProvider {
  readonly isPhantom = true;
  isConnected = true;
  publicKey: { toString(): string } | null;
  requests: WalletRequest[] = [];
  response: (request: WalletRequest) => Promise<unknown> = async () => ({
    signature: validSignature,
  });
  listeners = new Map<
    string,
    Set<(key?: { toString(): string } | null) => void>
  >();

  constructor(wallet: string = backer) {
    this.publicKey = { toString: () => wallet };
  }

  async connect() {
    this.isConnected = true;
    assert.ok(this.publicKey);
    return { publicKey: this.publicKey };
  }

  async disconnect() {
    this.isConnected = false;
    this.publicKey = null;
  }

  async signAndSendTransaction(
    transaction: WalletRequest["transaction"],
    options: WalletRequest["options"],
  ) {
    assert.ok(transaction instanceof Transaction);
    const messageBytes = transaction.serializeMessage();
    assert.deepEqual(transaction.serializeMessage(), messageBytes);
    assert.ok(transaction.signatures.every((slot) => slot.signature === null));
    const wire = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    // Use the actual independent legacy transaction decoder at the wallet
    // boundary, rather than accepting arbitrary base58 message text.
    const decoded = Transaction.from(wire);
    assert.deepEqual(decoded.serializeMessage(), messageBytes);
    assert.ok(decoded.signatures.every((slot) => slot.signature === null));
    assert.deepEqual(Message.from(messageBytes).serialize(), messageBytes);
    const request = { transaction, options };
    this.requests.push(request);
    return this.response(request);
  }

  async request() {
    throw new Error("Reached end of buffer unexpectedly");
  }

  on(
    event: "accountChanged" | "disconnect",
    listener: (key?: { toString(): string } | null) => void,
  ) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(
    event: "accountChanged" | "disconnect",
    listener: (key?: { toString(): string } | null) => void,
  ) {
    this.listeners.get(event)?.delete(listener);
  }

  changeWallet(wallet: string | null) {
    this.publicKey = wallet ? { toString: () => wallet } : null;
    this.isConnected = wallet !== null;
    this.listeners
      .get("accountChanged")
      ?.forEach((listener) => listener(this.publicKey));
  }
}

function account(
  data: Uint8Array,
  owner = OPENFUNDS_PROGRAM_ADDRESS,
  executable = false,
): RpcAccount {
  return {
    owner,
    executable,
    lamports: 1_000n,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}

function campaignAccount(wallet = creator, total = 20_000_000n) {
  const data = new Uint8Array(48);
  data.set(ANCHOR_DISCRIMINATORS.campaign);
  data.set(getAddressEncoder().encode(address(wallet)), 8);
  new DataView(data.buffer).setBigUint64(40, total, true);
  return account(data);
}

function contributionAccount(
  campaign: string,
  wallet = backer,
  total = 20_000_000n,
) {
  const data = new Uint8Array(80);
  data.set(ANCHOR_DISCRIMINATORS.contribution);
  data.set(getAddressEncoder().encode(address(campaign)), 8);
  data.set(getAddressEncoder().encode(address(wallet)), 40);
  new DataView(data.buffer).setBigUint64(72, total, true);
  return account(data);
}

async function fixture(
  options: { campaignExists?: boolean; wallet?: string } = {},
) {
  const provider = new TestPhantom(options.wallet ?? backer);
  const { campaignAddress, vaultAddress } =
    await deriveCampaignAddresses(creator);
  const contributionAddress = await deriveContributionAddress(
    campaignAddress,
    backer,
  );
  const accounts = new Map<string, RpcAccount>();
  const programDataAddress = (
    await getProgramDerivedAddress({
      programAddress: address(loader),
      seeds: [getAddressEncoder().encode(address(OPENFUNDS_PROGRAM_ADDRESS))],
    })
  )[0];
  const programData = new Uint8Array(49);
  new DataView(programData.buffer).setUint32(0, 3, true);
  programData.set([0x7f, 0x45, 0x4c, 0x46], 45);
  accounts.set(programDataAddress, account(programData, loader));
  const program = new Uint8Array(36);
  new DataView(program.buffer).setUint32(0, 2, true);
  program.set(getAddressEncoder().encode(address(programDataAddress)), 4);
  accounts.set(OPENFUNDS_PROGRAM_ADDRESS, account(program, loader, true));
  if (options.campaignExists !== false) {
    accounts.set(campaignAddress, campaignAccount());
    const vault = account(new Uint8Array(ANCHOR_DISCRIMINATORS.vault));
    vault.lamports = 20_001_000n;
    accounts.set(vaultAddress, vault);
    accounts.set(contributionAddress, contributionAccount(campaignAddress));
  }
  const calls: { method: DevnetRpcMethod; params: readonly unknown[] }[] = [];
  const state = {
    genesisHash: DEVNET_GENESIS_HASH,
    status: { err: null, confirmationStatus: "confirmed" } as {
      err: unknown;
      confirmationStatus: string;
    } | null,
    height: 10n,
    rpcError: null as DevnetRpcMethod | null,
    beforeCall: (method: DevnetRpcMethod) => {
      void method;
    },
  };
  const rpc: DevnetRpcTransport = {
    async call<T>(method: DevnetRpcMethod, params: readonly unknown[]) {
      calls.push({ method, params });
      state.beforeCall(method);
      if (state.rpcError === method) throw new Error("RPC unavailable");
      let result: unknown;
      switch (method) {
        case "getGenesisHash":
          result = state.genesisHash;
          break;
        case "getAccountInfo":
          result = { value: accounts.get(String(params[0])) ?? null };
          break;
        case "getMultipleAccounts":
          result = {
            value: (params[0] as string[]).map(
              (key) => accounts.get(key) ?? null,
            ),
          };
          break;
        case "getBalance":
          result = { value: 5_500_000_000n };
          break;
        case "getLatestBlockhash":
          result = {
            value: {
              blockhash: getAddressDecoder().decode(new Uint8Array(32).fill(8)),
              lastValidBlockHeight: 100n,
            },
          };
          break;
        case "getSignatureStatuses":
          result = { value: [state.status] };
          break;
        case "getBlockHeight":
          result = state.height;
          break;
      }
      return result as T;
    },
  };
  const gateway = new PhantomCampaignGateway({
    provider,
    rpc,
    confirmationTimeoutMs: 0,
  });
  return {
    gateway,
    provider,
    rpc,
    state,
    calls,
    accounts,
    campaignAddress,
    vaultAddress,
    contributionAddress,
    programDataAddress,
  };
}

test("Anchor wire discriminators match the public Rust instruction and account names", () => {
  for (const [key, name] of [
    ["initializeCampaign", "global:initialize_campaign"],
    ["contribute", "global:contribute"],
    ["campaign", "account:Campaign"],
    ["vault", "account:Vault"],
    ["contribution", "account:Contribution"],
  ] as const) {
    assert.deepEqual(ANCHOR_DISCRIMINATORS[key], [
      ...createHash("sha256").update(name).digest().subarray(0, 8),
    ]);
  }
});

test("PDAs use one campaign per creator and separate vault/backer seeds", async () => {
  const first = await deriveCampaignAddresses(creator);
  const second = await deriveCampaignAddresses(other);
  const expected = (
    await getProgramDerivedAddress({
      programAddress: address(OPENFUNDS_PROGRAM_ADDRESS),
      seeds: [Buffer.from("campaign"), getAddressEncoder().encode(creator)],
    })
  )[0];
  assert.equal(first.campaignAddress, expected);
  assert.notEqual(first.campaignAddress, second.campaignAddress);
  assert.notEqual(first.vaultAddress, second.vaultAddress);
  assert.equal(
    await deriveContributionAddress(first.campaignAddress, backer),
    await deriveContributionAddress(first.campaignAddress, backer),
  );
  assert.notEqual(
    await deriveContributionAddress(first.campaignAddress, backer),
    await deriveContributionAddress(first.campaignAddress, other),
  );
  assert.notEqual(
    await deriveContributionAddress(first.campaignAddress, backer),
    await deriveContributionAddress(second.campaignAddress, backer),
  );
});

test("lamports remain exact positive u64 integers", () => {
  assert.equal(parseContributionLamports("10000000"), 10_000_000n);
  assert.equal(
    parseContributionLamports("9007199254740993"),
    9_007_199_254_740_993n,
  );
  assert.equal(
    parseContributionLamports("18446744073709551615"),
    (1n << 64n) - 1n,
  );
  for (const value of [
    "0",
    "-1",
    "0.01",
    "1e7",
    " 1",
    "",
    "18446744073709551616",
  ])
    assert.throws(() => parseContributionLamports(value));
});

test("read validates campaign/vault/contribution and preserves large lamport balances", async () => {
  const f = await fixture();
  const large = 9_007_199_254_740_993n;
  f.accounts.set(f.campaignAddress, campaignAccount(creator, large));
  f.accounts.get(f.vaultAddress)!.lamports = large + 1_000n;
  const result = await f.gateway.readCampaign(f.campaignAddress);
  assert.equal(result.creatorAddress, creator);
  assert.equal(result.totalContributedLamports, large.toString());
  assert.equal(result.vaultBalanceLamports, (large + 1_000n).toString());
  assert.equal(result.contributionLamports, "20000000");
  assert.equal(result.contributionAddress, f.contributionAddress);
  assert.equal(await f.gateway.readWalletBalance(), "5500000000");
});

test("missing campaign is distinguishable and an unfunded contribution still has its PDA", async () => {
  const f = await fixture();
  f.accounts.delete(f.contributionAddress);
  const state = await f.gateway.readCampaign(f.campaignAddress);
  assert.equal(state.contributionLamports, "0");
  assert.equal(state.contributionAddress, f.contributionAddress);
  f.accounts.delete(f.campaignAddress);
  await assert.rejects(
    f.gateway.readCampaign(f.campaignAddress),
    CampaignNotInitializedError,
  );
});

test("substituted campaign PDA, owner, Anchor discriminator and contribution identities fail", async () => {
  const wrongPda = await fixture();
  wrongPda.accounts.set(other, campaignAccount());
  await assert.rejects(wrongPda.gateway.readCampaign(other), /creator PDA/);

  const wrongOwner = await fixture();
  wrongOwner.accounts.get(wrongOwner.vaultAddress)!.owner = loader;
  await assert.rejects(
    wrongOwner.gateway.readCampaign(wrongOwner.campaignAddress),
    /not owned/,
  );

  const wrongLayout = await fixture();
  wrongLayout.accounts.set(
    wrongLayout.campaignAddress,
    account(new Uint8Array(48)),
  );
  await assert.rejects(
    wrongLayout.gateway.readCampaign(wrongLayout.campaignAddress),
    /Anchor layout/,
  );

  const wrongIdentity = await fixture();
  wrongIdentity.accounts.set(
    wrongIdentity.contributionAddress,
    contributionAccount(wrongIdentity.campaignAddress, other),
  );
  await assert.rejects(
    wrongIdentity.gateway.readCampaign(wrongIdentity.campaignAddress),
    /identities/,
  );
});

test("zero and overflow contributions fail before asking Phantom to sign", async () => {
  const f = await fixture();
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "0"),
    /greater than zero/,
  );
  f.accounts.set(f.campaignAddress, campaignAccount(creator, (1n << 64n) - 1n));
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "1"),
    /overflow/,
  );
  assert.equal(f.provider.requests.length, 0);
});

test("executable flag alone is insufficient: missing ProgramData blocks signing", async () => {
  const f = await fixture({ campaignExists: false, wallet: creator });
  f.accounts.delete(f.programDataAddress);
  assert.equal((await f.gateway.inspectProgram()).deployed, false);
  await assert.rejects(f.gateway.initializeCampaign(), /ProgramData/);
  assert.equal(f.provider.requests.length, 0);
  f.accounts.delete(OPENFUNDS_PROGRAM_ADDRESS);
  await assert.rejects(f.gateway.initializeCampaign(), /not been deployed/);
});

test("initialize hands Phantom a genuine unsigned legacy transaction and succeeds only after confirmation", async () => {
  const f = await fixture({ campaignExists: false, wallet: creator });
  const result = await f.gateway.initializeCampaign();
  assert.equal(result.campaignAddress, f.campaignAddress);
  assert.equal(result.signature, validSignature);
  const sent = f.provider.requests[0];
  assert.ok(sent.transaction instanceof Transaction);
  assert.deepEqual(sent.options, {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const message = getCompiledTransactionMessageDecoder().decode(
    sent.transaction.serializeMessage(),
  );
  assert.equal(message.version, "legacy");
  assert.equal(message.staticAccounts[0], creator);
  assert.equal(message.header.numSignerAccounts, 1);
  assert.equal(message.instructions.length, 1);
  const ix = message.instructions[0];
  assert.equal(
    message.staticAccounts[ix.programAddressIndex],
    OPENFUNDS_PROGRAM_ADDRESS,
  );
  assert.deepEqual([...ix.data!], ANCHOR_DISCRIMINATORS.initializeCampaign);
  assert.deepEqual(
    ix.accountIndices!.map((index) => message.staticAccounts[index]),
    [
      creator,
      f.campaignAddress,
      f.vaultAddress,
      "11111111111111111111111111111111",
    ],
  );
  assert.ok(f.calls.some((call) => call.method === "getSignatureStatuses"));
});

test("repeat contribution uses the same PDA and exact 10000000 little-endian amount", async () => {
  const f = await fixture();
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(
      await f.gateway.contribute(f.campaignAddress, "10000000"),
      { signature: validSignature },
    );
    const message = getCompiledTransactionMessageDecoder().decode(
      f.provider.requests[i].transaction.serializeMessage(),
    );
    assert.equal(message.version, "legacy");
    const ix = message.instructions[0];
    assert.deepEqual(
      ix.accountIndices!.map((index) => message.staticAccounts[index]),
      [
        backer,
        f.campaignAddress,
        f.vaultAddress,
        f.contributionAddress,
        "11111111111111111111111111111111",
      ],
    );
    assert.deepEqual(
      [...ix.data!.subarray(0, 8)],
      ANCHOR_DISCRIMINATORS.contribute,
    );
    assert.equal(
      new DataView(
        ix.data!.buffer,
        ix.data!.byteOffset,
        ix.data!.byteLength,
      ).getBigUint64(8, true),
      10_000_000n,
    );
  }
});

test("duplicate initialization is rejected before signing", async () => {
  const f = await fixture({ wallet: creator });
  await assert.rejects(
    f.gateway.initializeCampaign(),
    /already has a campaign/,
  );
  assert.equal(f.provider.requests.length, 0);
});

test("rejected wallet approval cannot report success and releases the transaction lock", async () => {
  const f = await fixture();
  f.provider.response = async () => {
    throw new Error("User rejected the request");
  };
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "10000000"),
    /User rejected/,
  );
  assert.equal(
    f.calls.filter((call) => call.method === "getSignatureStatuses").length,
    0,
  );
  f.provider.response = async () => ({ signature: validSignature });
  assert.equal(
    (await f.gateway.contribute(f.campaignAddress, "10000000")).signature,
    validSignature,
  );
});

test("failed, pending and unreadable confirmations retain signature without false success", async () => {
  for (const scenario of ["failed", "pending", "rpc"] as const) {
    const f = await fixture();
    if (scenario === "failed")
      f.state.status = {
        err: { InstructionError: [0, { Custom: 6000 }] },
        confirmationStatus: "confirmed",
      };
    else if (scenario === "pending") f.state.status = null;
    else f.state.rpcError = "getSignatureStatuses";
    await assert.rejects(
      f.gateway.contribute(f.campaignAddress, "10000000"),
      (error) => {
        assert.ok(error instanceof TransactionConfirmationError);
        assert.equal(error.signature, validSignature);
        assert.equal(error.state, scenario === "failed" ? "failed" : "pending");
        return true;
      },
    );
  }
});

test("no mainnet or testnet fallback is possible through the Devnet gateway", async () => {
  const f = await fixture();
  f.state.genesisHash = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  await assert.rejects(f.gateway.readWalletBalance(), /not Solana Devnet/);
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "10000000"),
    /not Solana Devnet/,
  );
  assert.equal(f.provider.requests.length, 0);
  assert.equal(DEVNET_PROXY_PATH, "/api/solana/devnet");
});

test("account changes cancel the prepared transaction and wallet event listeners clean up", async () => {
  const f = await fixture();
  const received: (string | null)[] = [];
  const unsubscribe = f.gateway.onWalletChange((wallet) =>
    received.push(wallet),
  );
  f.state.beforeCall = (method) => {
    if (method === "getLatestBlockhash") f.provider.changeWallet(other);
  };
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "10000000"),
    /account changed/,
  );
  assert.equal(f.provider.requests.length, 0);
  assert.equal(f.gateway.connectedAddress, other);
  assert.deepEqual(received, [other]);
  unsubscribe();
  assert.equal(f.provider.listeners.get("accountChanged")!.size, 0);
});

test("concurrent transaction requests cannot open two Phantom approvals", async () => {
  const f = await fixture();
  let resolveRequest!: (response: unknown) => void;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  f.provider.response = async () => {
    requestStarted();
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };
  const first = f.gateway.contribute(f.campaignAddress, "10000000");
  await started;
  await assert.rejects(
    f.gateway.contribute(f.campaignAddress, "10000000"),
    /already in progress/,
  );
  resolveRequest({ signature: validSignature });
  await first;
  assert.equal(f.provider.requests.length, 1);
});

test("full canonical Devnet genesis hash succeeds while a truncated hash fails", async () => {
  const f = await fixture();
  f.state.genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  assert.equal(await f.gateway.readWalletBalance(), "5500000000");
  f.state.genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  await assert.rejects(f.gateway.readWalletBalance(), /not Solana Devnet/);
  assert.equal(f.provider.requests.length, 0);
});

test("transaction preparation errors retain their stage and never invoke Phantom", async () => {
  const f = await fixture({ campaignExists: false, wallet: creator });
  f.state.rpcError = "getLatestBlockhash";
  await assert.rejects(f.gateway.initializeCampaign(), (error) => {
    assert.ok(error instanceof TransactionStageError);
    assert.equal(error.stage, "preparation");
    assert.equal(error.message, "RPC unavailable");
    assert.equal(error.cancelled, false);
    return true;
  });
  assert.equal(f.provider.requests.length, 0);
});

test("Phantom object errors preserve wallet details and explicit cancellation", async () => {
  for (const scenario of ["cancelled", "buffer"] as const) {
    const f = await fixture({ campaignExists: false, wallet: creator });
    const cause =
      scenario === "cancelled"
        ? { code: 4001, message: "User rejected the request" }
        : { code: -32603, message: "Reached end of buffer unexpectedly" };
    f.provider.response = async () => {
      throw cause;
    };
    await assert.rejects(f.gateway.initializeCampaign(), (error) => {
      assert.ok(error instanceof TransactionStageError);
      assert.equal(error.stage, "wallet");
      assert.equal(error.message, cause.message);
      assert.equal(error.cancelled, scenario === "cancelled");
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(
      f.calls.filter((call) => call.method === "getSignatureStatuses").length,
      0,
    );
    f.provider.response = async () => ({ signature: validSignature });
    assert.equal(
      (await f.gateway.initializeCampaign()).signature,
      validSignature,
    );
  }
});

test("missing typed Phantom interface produces a wallet-stage error without raw-request fallback", async () => {
  const f = await fixture({ campaignExists: false, wallet: creator });
  Object.defineProperty(f.provider, "signAndSendTransaction", {
    value: undefined,
  });
  await assert.rejects(f.gateway.initializeCampaign(), (error) => {
    assert.ok(error instanceof TransactionStageError);
    assert.equal(error.stage, "wallet");
    assert.match(error.message, /interface is unavailable/);
    return true;
  });
  assert.equal(f.provider.requests.length, 0);
});

test("invalid wallet receipts cannot be confirmed or reported as successful", async () => {
  for (const response of [
    null,
    {},
    { signature: "bad-signature" },
    { signature: "1" },
  ]) {
    const f = await fixture({ campaignExists: false, wallet: creator });
    f.provider.response = async () => response;
    await assert.rejects(f.gateway.initializeCampaign(), TransactionStageError);
    assert.equal(
      f.calls.filter((call) => call.method === "getSignatureStatuses").length,
      0,
    );
  }
});
