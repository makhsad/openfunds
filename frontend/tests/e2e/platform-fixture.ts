import { expect, type Page } from "@playwright/test";
import { Transaction } from "@solana/web3.js";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  PROJECT_DISCRIMINATORS,
  PROJECT_INSTRUCTIONS,
  derivePlatformAddress,
  deriveProjectAddresses,
  deriveProjectContributionAddress,
  deriveProjectMessageAddress,
  deriveLegacyClosureAddress,
  deriveLegacyReceiptAddress,
  deriveLegacyDiscussionAddress,
} from "../../src/lib/solana/project-ledger";
import {
  ANCHOR_DISCRIMINATORS,
  DEVNET_GENESIS_HASH,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
} from "../../src/lib/solana/phantom-gateway";

export const CREATOR = getAddressDecoder().decode(new Uint8Array(32).fill(31));
export const SPONSOR_A = getAddressDecoder().decode(
  new Uint8Array(32).fill(32),
);
export const SPONSOR_B = getAddressDecoder().decode(
  new Uint8Array(32).fill(33),
);
export const TITLE = "Общий проект OpenFunds";
const SYSTEM = "11111111111111111111111111111111";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const RENT = 690_880n;
const FEE = 5_000n;
const signature = (index: number) =>
  getBase58Decoder().decode(new Uint8Array(64).fill(index));
const blockhash = getBase58Decoder().decode(new Uint8Array(32).fill(41));
type Account = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, "base64"];
  rentEpoch: number;
  space: number;
};
type State = {
  creator: string;
  id: string;
  title: string;
  description: string;
  image: string;
  goal: bigint;
  raised: bigint;
  refunded: bigint;
  messages: bigint;
  closed: boolean;
};
type Backer = {
  campaign: string;
  address: string;
  raised: bigint;
  refunded: bigint;
};
type TransferInfo = { source: string; destination: string; lamports: number };
function innerTransfers(transfer: TransferInfo | null) {
  return transfer
    ? [
        {
          index: 0,
          instructions: [
            { programId: SYSTEM, parsed: { type: "transfer", info: transfer } },
          ],
        },
      ]
    : [];
}
export type Outcome = "success" | "cancel" | "pending";
export type FixtureWindow = Window & {
  __platformFixture: {
    switchAccount(address: string): void;
    outcomes(values: Outcome[]): void;
    switchAfterSignedTransactions(count: number, address: string): void;
  };
};

function key(data: Uint8Array, offset: number, value: string) {
  data.set(getAddressEncoder().encode(address(value)), offset);
}
function u64(data: Uint8Array, offset: number, value: bigint) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function text(data: Uint8Array, offset: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  new DataView(data.buffer).setUint32(offset, bytes.length, true);
  data.set(bytes, offset + 4);
  return offset + 4 + bytes.length;
}
function account(
  data: Uint8Array,
  lamports = 1_500_000n,
  owner = OPENFUNDS_PROGRAM_ADDRESS,
  executable = false,
): Account {
  return {
    owner,
    executable,
    lamports: Number(lamports),
    data: [Buffer.from(data).toString("base64"), "base64"],
    rentEpoch: 0,
    space: data.length,
  };
}
function blank(name: keyof typeof PROJECT_DISCRIMINATORS, size: number) {
  const data = new Uint8Array(size);
  data.set(PROJECT_DISCRIMINATORS[name]);
  return data;
}

/** Stateful public-account fixtures exercise the real wallet envelope and SDK codecs.
 * They never hold private keys or send transactions to a network. */
export async function createPlatformFixture(
  options: { funded?: boolean; closed?: boolean; capability?: boolean } = {},
) {
  const accounts = new Map<string, Account>();
  const projects = new Map<string, State>();
  const backers = new Map<string, Backer>();
  const balances = new Map<string, bigint>(
    [CREATOR, SPONSOR_A, SPONSOR_B].map((wallet) => [wallet, 5_000_000_000n]),
  );
  const receipts = new Map<string, Record<string, unknown>>();
  const pendingExecutions = new Map<string, () => Promise<void>>();
  let omittedBackers = new Set<string>();
  const history: { campaign: string; signature: string; confirmed: boolean }[] =
    [];
  const submissions: {
    actor: string;
    kind: string;
    campaign: string;
    recipient?: string;
    amount?: string;
  }[] = [];
  const first = await deriveProjectAddresses(CREATOR, "1");
  const legacy = await deriveCampaignAddresses(CREATOR);
  const legacyState = {
    raised: 3_000_000_000n,
    refunded: 0n,
    messages: 0n,
    closed: false,
  };
  const legacyBackers = new Map<string, Backer>();
  await syncLegacyBacker(CREATOR, 1_000_000_000n, 0n);
  await syncLegacyBacker(SPONSOR_A, 2_000_000_000n, 0n);
  await syncLegacy();
  // The existing 3 SOL is backed by two canonical records and two finalized
  // transfers. Closing must keep both the original records and this history.
  for (const [actor, quantity, index] of [
    [CREATOR, 1_000_000_000n, 43],
    [SPONSOR_A, 2_000_000_000n, 44],
  ] as const) {
    const sig = signature(index);
    const data = new Uint8Array(16);
    data.set(ANCHOR_DISCRIMINATORS.contribute);
    u64(data, 8, quantity);
    const keys = [
      actor,
      legacy.campaignAddress,
      legacy.vaultAddress,
      await deriveContributionAddress(legacy.campaignAddress, actor),
      SYSTEM,
    ];
    receipts.set(sig, {
      slot: 98,
      blockTime: 1_780_000_000 + index,
      version: "legacy",
      transaction: {
        signatures: [sig],
        message: {
          accountKeys: keys.map((pubkey) => ({
            pubkey,
            signer: pubkey === actor,
            writable: pubkey !== SYSTEM,
          })),
          instructions: [
            {
              programId: OPENFUNDS_PROGRAM_ADDRESS,
              accounts: keys,
              data: getBase58Decoder().decode(data),
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: Number(FEE),
        innerInstructions: innerTransfers({
          source: actor,
          destination: legacy.vaultAddress,
          lamports: Number(quantity),
        }),
      },
    });
    history.push({
      campaign: legacy.campaignAddress,
      signature: sig,
      confirmed: true,
    });
  }
  if (options.capability !== false) {
    const platform = blank("platform", 9);
    platform[8] = 2;
    accounts.set(await derivePlatformAddress(), account(platform));
    projects.set(first.campaignAddress, {
      creator: CREATOR,
      id: "1",
      title: TITLE,
      description: "Общий проект для автора и двух спонсоров",
      image: "",
      goal: 1_000_000_000n,
      raised: options.funded ? 300_000_000n : 0n,
      refunded: 0n,
      messages: 0n,
      closed: options.closed ?? false,
    });
    await syncProject(first.campaignAddress);
    if (options.funded) {
      await syncBacker(first.campaignAddress, SPONSOR_A, 100_000_000n, 0n);
      await syncBacker(first.campaignAddress, SPONSOR_B, 200_000_000n, 0n);
    }
  }
  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: address(LOADER),
    seeds: [getAddressEncoder().encode(address(OPENFUNDS_PROGRAM_ADDRESS))],
  });
  const program = new Uint8Array(36);
  new DataView(program.buffer).setUint32(0, 2, true);
  key(program, 4, programDataAddress);
  accounts.set(
    OPENFUNDS_PROGRAM_ADDRESS,
    account(program, 1_000_000n, LOADER, true),
  );
  const programData = new Uint8Array(49);
  new DataView(programData.buffer).setUint32(0, 3, true);
  programData.set([0x7f, 0x45, 0x4c, 0x46], 45);
  accounts.set(programDataAddress, account(programData, 1_000_000n, LOADER));

  async function syncProject(campaign: string) {
    const value = projects.get(campaign)!;
    const bytes = blank("campaign", 789);
    key(bytes, 8, value.creator);
    u64(bytes, 40, BigInt(value.id));
    u64(bytes, 48, value.goal);
    u64(bytes, 56, value.raised);
    u64(bytes, 64, value.refunded);
    u64(bytes, 72, value.messages);
    u64(bytes, 80, 1_780_000_000n);
    u64(bytes, 88, value.closed ? 1_780_000_100n : 0n);
    bytes[96] = value.closed ? (value.refunded === value.raised ? 2 : 1) : 0;
    const offset = text(bytes, 97, value.title);
    const next = text(bytes, offset, value.description);
    text(bytes, next, value.image);
    accounts.set(campaign, account(bytes));
    const derived = await deriveProjectAddresses(value.creator, value.id);
    accounts.set(
      derived.vaultAddress,
      account(blank("vault", 8), RENT + value.raised - value.refunded),
    );
  }
  async function syncLegacy() {
    const data = new Uint8Array(legacyState.closed ? 49 : 48);
    data.set(ANCHOR_DISCRIMINATORS.campaign);
    key(data, 8, CREATOR);
    u64(data, 40, legacyState.raised);
    if (legacyState.closed) data[48] = 1;
    accounts.set(legacy.campaignAddress, account(data));
    accounts.set(
      legacy.vaultAddress,
      account(
        Uint8Array.from(ANCHOR_DISCRIMINATORS.vault),
        RENT + legacyState.raised - legacyState.refunded,
      ),
    );
    if (legacyState.closed) {
      const closure = blank("legacyClosure", 89);
      key(closure, 8, legacy.campaignAddress);
      key(closure, 40, CREATOR);
      u64(closure, 72, legacyState.refunded);
      closure[80] = legacyState.refunded === legacyState.raised ? 2 : 1;
      u64(closure, 81, 1_780_000_100n);
      accounts.set(
        await deriveLegacyClosureAddress(legacy.campaignAddress),
        account(closure),
      );
    }
    if (legacyState.messages > 0n) {
      const discussion = blank("legacyDiscussion", 48);
      key(discussion, 8, legacy.campaignAddress);
      u64(discussion, 40, legacyState.messages);
      accounts.set(
        await deriveLegacyDiscussionAddress(legacy.campaignAddress),
        account(discussion),
      );
    }
  }
  async function syncLegacyBacker(
    wallet: string,
    raised: bigint,
    refunded: bigint,
  ) {
    const derived = await deriveContributionAddress(
      legacy.campaignAddress,
      wallet,
    );
    legacyBackers.set(derived, {
      campaign: legacy.campaignAddress,
      address: wallet,
      raised,
      refunded,
    });
    const bytes = new Uint8Array(80);
    bytes.set(ANCHOR_DISCRIMINATORS.contribution);
    key(bytes, 8, legacy.campaignAddress);
    key(bytes, 40, wallet);
    u64(bytes, 72, raised);
    accounts.set(derived, account(bytes));
    if (refunded > 0n) {
      const receipt = blank("legacyReceipt", 80);
      key(receipt, 8, legacy.campaignAddress);
      key(receipt, 40, wallet);
      u64(receipt, 72, refunded);
      accounts.set(
        await deriveLegacyReceiptAddress(legacy.campaignAddress, wallet),
        account(receipt),
      );
    }
  }
  async function syncBacker(
    campaign: string,
    wallet: string,
    raised: bigint,
    refunded: bigint,
  ) {
    const derived = await deriveProjectContributionAddress(campaign, wallet);
    backers.set(derived, { campaign, address: wallet, raised, refunded });
    const bytes = blank("contribution", 88);
    key(bytes, 8, campaign);
    key(bytes, 40, wallet);
    u64(bytes, 72, raised);
    u64(bytes, 80, refunded);
    accounts.set(derived, account(bytes));
  }
  function balanceFor(key: string) {
    return balances.get(key) ?? BigInt(accounts.get(key)?.lamports ?? 0);
  }
  function readString(bytes: Uint8Array, offset: number): [string, number] {
    const size = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(offset, true);
    return [
      new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + size)),
      offset + 4 + size,
    ];
  }

  async function attach(page: Page, wallet: string | null = CREATOR) {
    await page.exposeFunction(
      "__platformSubmit",
      async ({
        bytes,
        actor,
        outcome,
      }: {
        bytes: number[];
        actor: string;
        outcome: Outcome;
      }) => {
        if (outcome === "cancel") return { cancelled: true };
        const transaction = Transaction.from(Uint8Array.from(bytes));
        expect(transaction.signatures).toHaveLength(1);
        expect(transaction.signatures[0].signature).toBeNull();
        expect(transaction.feePayer?.toBase58()).toBe(actor);
        expect(transaction.instructions).toHaveLength(1);
        const ix = transaction.instructions[0];
        expect(ix.programId.toBase58()).toBe(OPENFUNDS_PROGRAM_ADDRESS);
        const keys = ix.keys.map((item) => item.pubkey.toBase58());
        expect(keys[0]).toBe(actor);
        const campaign = keys[1];
        const kind =
          Object.entries(PROJECT_INSTRUCTIONS).find(([, disc]) =>
            Buffer.from(disc).equals(ix.data.subarray(0, 8)),
          )?.[0] ??
          (Buffer.from(ANCHOR_DISCRIMINATORS.contribute).equals(
            ix.data.subarray(0, 8),
          )
            ? "legacyContribution"
            : undefined);
        expect(kind).toBeTruthy();
        const beforeKeys = [...new Set([actor, ...keys])];
        const pre = beforeKeys.map((key) => Number(balanceFor(key)));
        let transfer: TransferInfo | null = null;
        let refundedAmount = 0n;
        let recipient: string | undefined;
        const applyMutation = async () => {
          balances.set(actor, balanceFor(actor) - FEE);
          if (kind === "platform") {
            expect(campaign).toBe(await derivePlatformAddress());
            expect(keys[2]).toBe(SYSTEM);
            expect(accounts.has(campaign)).toBe(false);
            const platform = blank("platform", 9);
            platform[8] = 2;
            accounts.set(campaign, account(platform));
          } else if (kind === "initialize") {
            const id = ix.data.readBigUInt64LE(8).toString();
            const goal = ix.data.readBigUInt64LE(16);
            const [title, next] = readString(ix.data, 24);
            const [description, last] = readString(ix.data, next);
            const [image] = readString(ix.data, last);
            const derived = await deriveProjectAddresses(actor, id);
            expect(campaign).toBe(derived.campaignAddress);
            expect(keys[2]).toBe(derived.vaultAddress);
            expect(projects.has(campaign)).toBe(false);
            projects.set(campaign, {
              creator: actor,
              id,
              title,
              description,
              image,
              goal,
              raised: 0n,
              refunded: 0n,
              messages: 0n,
              closed: false,
            });
            await syncProject(campaign);
          } else if (kind!.startsWith("legacy")) {
            expect(campaign).toBe(legacy.campaignAddress);
            if (kind === "legacyClose") {
              expect(actor).toBe(CREATOR);
              expect(legacyState.closed).toBe(false);
              expect(keys[2]).toBe(legacy.vaultAddress);
              expect(keys[3]).toBe(await deriveLegacyClosureAddress(campaign));
              expect(keys[4]).toBe(SYSTEM);
              legacyState.closed = true;
            } else if (kind === "legacyRefund") {
              expect(legacyState.closed).toBe(true);
              expect(keys[2]).toBe(legacy.vaultAddress);
              recipient = keys[6];
              const old = legacyBackers.get(keys[3])!;
              expect(old).toBeTruthy();
              expect(old.campaign).toBe(campaign);
              expect(old.address).toBe(recipient);
              expect(keys[4]).toBe(await deriveLegacyClosureAddress(campaign));
              expect(keys[5]).toBe(
                await deriveLegacyReceiptAddress(campaign, recipient),
              );
              expect(keys[7]).toBe(SYSTEM);
              expect(actor === CREATOR || actor === recipient).toBe(true);
              refundedAmount = old.raised - old.refunded;
              expect(refundedAmount > 0n).toBe(true);
              legacyState.refunded += refundedAmount;
              await syncLegacyBacker(recipient, old.raised, old.raised);
              balances.set(recipient, balanceFor(recipient) + refundedAmount);
            } else if (kind === "legacyMessage") {
              expect(legacyState.closed).toBe(false);
              const contributionKey = await deriveContributionAddress(
                campaign,
                actor,
              );
              expect(keys[2]).toBe(contributionKey);
              expect(
                actor === CREATOR ||
                  (legacyBackers.get(contributionKey)?.raised ?? 0n) > 0n,
              ).toBe(true);
              expect(keys[3]).toBe(
                await deriveLegacyDiscussionAddress(campaign),
              );
              expect(keys[5]).toBe(SYSTEM);
              const id = ix.data.readBigUInt64LE(8);
              expect(id).toBe(legacyState.messages);
              const messageAddress = await deriveProjectMessageAddress(
                campaign,
                id.toString(),
              );
              expect(keys[4]).toBe(messageAddress);
              const [body] = readString(ix.data, 16);
              const message = blank("message", 332);
              key(message, 8, campaign);
              key(message, 40, actor);
              u64(message, 72, id);
              u64(message, 80, 1_780_000_020n + id);
              text(message, 88, body);
              accounts.set(messageAddress, account(message));
              legacyState.messages++;
            } else if (kind === "legacyContribution") {
              expect(legacyState.closed).toBe(false);
              expect(keys[2]).toBe(legacy.vaultAddress);
              expect(keys[3]).toBe(
                await deriveContributionAddress(campaign, actor),
              );
              expect(keys[4]).toBe(SYSTEM);
              const quantity = ix.data.readBigUInt64LE(8);
              expect(quantity > 0n).toBe(true);
              const old = legacyBackers.get(keys[3]);
              legacyState.raised += quantity;
              await syncLegacyBacker(
                actor,
                (old?.raised ?? 0n) + quantity,
                old?.refunded ?? 0n,
              );
              balances.set(actor, balanceFor(actor) - quantity);
              transfer = {
                source: actor,
                destination: legacy.vaultAddress,
                lamports: Number(quantity),
              };
            } else
              throw new Error("Unexpected legacy fixture instruction: " + kind);
            await syncLegacy();
          } else {
            const state = projects.get(campaign)!;
            expect(state).toBeTruthy();
            const derived = await deriveProjectAddresses(
              state.creator,
              state.id,
            );
            if (kind === "contribution") {
              expect(state.closed).toBe(false);
              const quantity = ix.data.readBigUInt64LE(8);
              expect(quantity > 0n).toBe(true);
              expect(keys[2]).toBe(derived.vaultAddress);
              expect(keys[3]).toBe(
                await deriveProjectContributionAddress(campaign, actor),
              );
              const old = backers.get(keys[3]);
              state.raised += quantity;
              await syncBacker(
                campaign,
                actor,
                (old?.raised ?? 0n) + quantity,
                old?.refunded ?? 0n,
              );
              balances.set(actor, balanceFor(actor) - quantity);
              transfer = {
                source: actor,
                destination: derived.vaultAddress,
                lamports: Number(quantity),
              };
            } else if (kind === "close") {
              expect(actor).toBe(state.creator);
              expect(state.closed).toBe(false);
              state.closed = true;
            } else if (kind === "refund") {
              expect(state.closed).toBe(true);
              recipient = keys[4];
              const old = backers.get(keys[3])!;
              expect(old.address).toBe(recipient);
              expect(actor === state.creator || actor === recipient).toBe(true);
              refundedAmount = old.raised - old.refunded;
              expect(refundedAmount > 0n).toBe(true);
              state.refunded += refundedAmount;
              await syncBacker(campaign, recipient, old.raised, old.raised);
              balances.set(recipient, balanceFor(recipient) + refundedAmount);
            } else if (kind === "message") {
              expect(state.closed).toBe(false);
              expect(
                actor === state.creator ||
                  Boolean(
                    backers.get(
                      await deriveProjectContributionAddress(campaign, actor),
                    ),
                  ),
              ).toBe(true);
              const id = ix.data.readBigUInt64LE(8);
              expect(id).toBe(state.messages);
              const [body] = readString(ix.data, 16);
              const messageAddress = await deriveProjectMessageAddress(
                campaign,
                id.toString(),
              );
              expect(keys[3]).toBe(messageAddress);
              const message = blank("message", 332);
              key(message, 8, campaign);
              key(message, 40, actor);
              u64(message, 72, id);
              u64(message, 80, 1_780_000_020n + id);
              text(message, 88, body);
              accounts.set(messageAddress, account(message));
              state.messages++;
            } else throw new Error("Unexpected fixture instruction: " + kind);
            await syncProject(campaign);
          }
        };
        if (outcome !== "pending") await applyMutation();
        const sig = signature(50 + history.length);
        const post = beforeKeys.map((key) => Number(balanceFor(key)));
        const raw = {
          slot: 100 + history.length,
          blockTime: 1_780_000_100 + history.length,
          version: "legacy",
          transaction: {
            signatures: [sig],
            message: {
              accountKeys: beforeKeys.map((pubkey) => ({
                pubkey,
                signer: pubkey === actor,
                writable: keys.includes(pubkey),
                source: "transaction",
              })),
              recentBlockhash: blockhash,
              instructions: [
                {
                  programId: OPENFUNDS_PROGRAM_ADDRESS,
                  accounts: keys,
                  data: getBase58Decoder().decode(ix.data),
                },
              ],
            },
          },
          meta: {
            err: null,
            fee: Number(FEE),
            preBalances: pre,
            postBalances: post,
            innerInstructions: innerTransfers(transfer),
          },
        };
        receipts.set(sig, raw);
        history.push({
          campaign,
          signature: sig,
          confirmed: outcome !== "pending",
        });
        submissions.push({
          actor,
          kind: kind!,
          campaign,
          ...(recipient ? { recipient } : {}),
          ...(kind === "contribution" || kind === "legacyContribution"
            ? { amount: ix.data.readBigUInt64LE(8).toString() }
            : kind === "refund" || kind === "legacyRefund"
              ? { amount: refundedAmount.toString() }
              : {}),
        });
        if (outcome === "pending") {
          pendingExecutions.set(sig, async () => {
            const actualPre = beforeKeys.map((key) => Number(balanceFor(key)));
            await applyMutation();
            raw.meta.preBalances = actualPre;
            raw.meta.postBalances = beforeKeys.map((key) =>
              Number(balanceFor(key)),
            );
            raw.meta.innerInstructions = innerTransfers(transfer);
            history.find((item) => item.signature === sig)!.confirmed = true;
          });
        }
        return { signature: sig };
      },
    );
    await page.addInitScript(
      ({ wallet }) => {
        if (wallet === null) return;
        let selected = wallet;
        let connected = true;
        let queue: Outcome[] = [];
        let afterSigned: { remaining: number; address: string } | null = null;
        const listeners = new Map<
          string,
          Set<(value?: { toString(): string } | null) => void>
        >();
        const emit = (event: string, value?: { toString(): string } | null) =>
          listeners.get(event)?.forEach((listener) => listener(value));
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
            return { publicKey: { toString: () => selected } };
          },
          async disconnect() {
            connected = false;
            emit("disconnect");
          },
          async signAndSendTransaction(
            transaction: {
              serialize(options: {
                requireAllSignatures: boolean;
                verifySignatures: boolean;
              }): Uint8Array;
            },
            options: unknown,
          ) {
            if (
              JSON.stringify(options) !==
              JSON.stringify({
                preflightCommitment: "confirmed",
                skipPreflight: false,
              })
            )
              throw new Error("Unexpected wallet options");
            const result = await (
              window as unknown as {
                __platformSubmit(
                  input: unknown,
                ): Promise<{ cancelled?: boolean; signature?: string }>;
              }
            ).__platformSubmit({
              bytes: Array.from(
                transaction.serialize({
                  requireAllSignatures: false,
                  verifySignatures: false,
                }),
              ),
              actor: selected,
              outcome: queue.shift() ?? "success",
            });
            if (result.cancelled)
              throw Object.assign(new Error("User rejected the request."), {
                code: 4001,
              });
            if (afterSigned) {
              afterSigned.remaining--;
              if (afterSigned.remaining === 0) {
                selected = afterSigned.address;
                afterSigned = null;
                connected = true;
                emit("accountChanged", { toString: () => selected });
              }
            }
            return { signature: result.signature };
          },
          on(
            event: string,
            listener: (value?: { toString(): string } | null) => void,
          ) {
            const values = listeners.get(event) ?? new Set();
            values.add(listener);
            listeners.set(event, values);
          },
          removeListener(
            event: string,
            listener: (value?: { toString(): string } | null) => void,
          ) {
            listeners.get(event)?.delete(listener);
          },
        };
        Object.defineProperty(window, "phantom", {
          value: { solana: provider },
          configurable: true,
        });
        (window as unknown as FixtureWindow).__platformFixture = {
          switchAccount(value) {
            selected = value;
            connected = true;
            emit("accountChanged", { toString: () => selected });
          },
          outcomes(values) {
            queue = [...values];
          },
          switchAfterSignedTransactions(count, value) {
            afterSigned = { remaining: count, address: value };
          },
        };
      },
      { wallet },
    );
    await page.route("**/api/solana/devnet", async (route) => {
      const request = route.request().postDataJSON();
      let result: unknown;
      switch (request.method) {
        case "getGenesisHash":
          result = DEVNET_GENESIS_HASH;
          break;
        case "getAccountInfo":
          result = {
            context: { slot: 100 },
            value: accounts.get(request.params[0]) ?? null,
          };
          break;
        case "getMultipleAccounts":
          result = {
            context: { slot: 100 },
            value: request.params[0].map(
              (key: string) => accounts.get(key) ?? null,
            ),
          };
          break;
        case "getBalance":
          result = {
            context: { slot: 100 },
            value: Number(balanceFor(request.params[0])),
          };
          break;
        case "getLatestBlockhash":
          result = {
            context: { slot: 100 },
            value: { blockhash, lastValidBlockHeight: 200 },
          };
          break;
        case "getBlockHeight":
          result = 199;
          break;
        case "getSignatureStatuses":
          if (
            request.params[0].some((sig: string) =>
              history.some((row) => row.signature === sig && !row.confirmed),
            )
          ) {
            // Confirmation RPC can be unavailable after a valid submission.
            // Its blockhash remains valid; a later readonly check may confirm it.
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                error: {
                  code: -32000,
                  message: "Confirmation is temporarily unavailable.",
                },
              }),
            });
            return;
          }
          result = {
            context: { slot: 100 },
            value: request.params[0].map((sig: string) =>
              history.some((row) => row.signature === sig && row.confirmed)
                ? {
                    err: null,
                    confirmationStatus: "finalized",
                    slot: 100,
                    confirmations: null,
                  }
                : null,
            ),
          };
          break;
        case "getProgramAccounts": {
          const config = request.params[1];
          expect(request.params[0]).toBe(OPENFUNDS_PROGRAM_ADDRESS);
          result = {
            context: { slot: 100 },
            value: [...accounts]
              .filter(([, value]) => value.owner === OPENFUNDS_PROGRAM_ADDRESS)
              .filter(([, value]) => {
                const bytes = Buffer.from(value.data[0], "base64");
                if (
                  bytes.length === 88 &&
                  Buffer.from(PROJECT_DISCRIMINATORS.contribution).equals(
                    bytes.subarray(0, 8),
                  ) &&
                  omittedBackers.has(
                    getAddressDecoder().decode(bytes.subarray(40, 72)),
                  )
                )
                  return false;
                return config.filters.every(
                  (filter: {
                    dataSize?: number;
                    memcmp?: { offset: number; bytes: string };
                  }) => {
                    if (filter.dataSize !== undefined)
                      return bytes.length === filter.dataSize;
                    if (filter.memcmp) {
                      const expected = Buffer.from(
                        getBase58Encoder().encode(filter.memcmp.bytes),
                      );
                      return bytes
                        .subarray(
                          filter.memcmp.offset,
                          filter.memcmp.offset + expected.length,
                        )
                        .equals(expected);
                    }
                    return false;
                  },
                );
              })
              .map(([pubkey, account]) => ({ pubkey, account })),
          };
          break;
        }
        case "getSignaturesForAddress": {
          const config = request.params[1];
          const rows = history
            .filter(
              (item) => item.confirmed && item.campaign === request.params[0],
            )
            .reverse();
          const start = config.before
            ? rows.findIndex((row) => row.signature === config.before) + 1
            : 0;
          result = rows.slice(start, start + config.limit).map((row) => ({
            signature: row.signature,
            err: null,
            blockTime: 1_780_000_100,
            confirmationStatus: "finalized",
          }));
          break;
        }
        case "getTransaction":
          result = receipts.get(request.params[0]) ?? null;
          break;
        default:
          throw new Error("Unexpected public RPC: " + request.method);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      });
    });
  }
  return {
    attach,
    first,
    legacy,
    legacyState,
    legacyBackers,
    accounts,
    projects,
    backers,
    balances,
    submissions,
    async confirmPending() {
      for (const [sig, apply] of [...pendingExecutions]) {
        await apply();
        pendingExecutions.delete(sig);
      }
    },
    omitBackers(values: string[]) {
      omittedBackers = new Set(values);
    },
    async switchAfterSignedTransactions(
      page: Page,
      count: number,
      wallet: string,
    ) {
      await page.evaluate(
        ({ count, wallet }) =>
          (
            window as unknown as FixtureWindow
          ).__platformFixture.switchAfterSignedTransactions(count, wallet),
        { count, wallet },
      );
    },
    async switchAccount(page: Page, wallet: string) {
      await page.evaluate(
        (wallet) =>
          (window as unknown as FixtureWindow).__platformFixture.switchAccount(
            wallet,
          ),
        wallet,
      );
    },
    async outcomes(page: Page, values: Outcome[]) {
      await page.evaluate(
        (values) =>
          (window as unknown as FixtureWindow).__platformFixture.outcomes(
            values,
          ),
        values,
      );
    },
    async translate(page: Page) {
      await page.evaluate(() => {
        const nodes = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = nodes.nextNode())) {
          if (node.parentElement?.closest('[translate="no"],.notranslate'))
            continue;
          if (node.textContent?.trim())
            node.textContent = "translated " + node.textContent;
        }
      });
    },
  };
}
