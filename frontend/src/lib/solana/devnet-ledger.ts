import {
  address,
  getAddressDecoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
} from "@solana/kit";
import {
  ANCHOR_DISCRIMINATORS,
  DEVNET_GENESIS_HASH,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
  type DevnetRpcTransport,
  type RpcAccount,
} from "./phantom-gateway";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const MAX_CAMPAIGNS = 1_000;
const MAX_HISTORY_LIMIT = 20;

export interface DevnetCampaign {
  creatorAddress: string;
  campaignAddress: string;
  vaultAddress: string;
  totalContributedLamports: string;
  vaultBalanceLamports: string;
}

export interface DevnetSupport {
  backerAddress: string;
  campaignAddress: string;
  contributionAddress: string;
  totalContributedLamports: string;
}

export interface DevnetActivity {
  signature: string;
  campaignAddress: string;
  vaultAddress: string;
  actorAddress: string | null;
  kind: "initialize" | "contribution" | "unavailable";
  status: "confirmed" | "finalized" | "failed" | "unavailable";
  amountLamports: string | null;
  feeLamports: string | null;
  walletDebitLamports: string | null;
  storageRentLamports: string | null;
  blockTime: number | null;
}

export interface DevnetActivityPage {
  items: DevnetActivity[];
  nextBefore: string | null;
  hasMore: boolean;
}

interface ProgramAccount {
  pubkey: string;
  account: RpcAccount;
}
interface SignatureRow {
  signature: string;
  err: unknown;
  blockTime: bigint | number | null;
  confirmationStatus?: string | null;
}
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function integer(value: unknown, label: string): bigint {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  )
    throw new Error(`Devnet returned an invalid ${label}.`);
  const result = BigInt(value);
  if (result < 0n) throw new Error(`Devnet returned an invalid ${label}.`);
  return result;
}

function optionalInteger(value: unknown): bigint | null {
  try {
    return integer(value, "transaction integer");
  } catch {
    return null;
  }
}

function blockTime(value: unknown): number | null {
  const parsed = optionalInteger(value);
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(parsed)
    : null;
}

function bytes(
  account: RpcAccount,
  name: keyof Pick<
    typeof ANCHOR_DISCRIMINATORS,
    "campaign" | "vault" | "contribution"
  >,
  size: number,
): Uint8Array {
  if (
    !account ||
    account.owner !== OPENFUNDS_PROGRAM_ADDRESS ||
    account.executable
  )
    throw new Error(`The ${name} account is not owned by OpenFunds.`);
  if (
    !Array.isArray(account.data) ||
    account.data[1] !== "base64" ||
    typeof account.data[0] !== "string"
  )
    throw new Error(`The ${name} account has unsupported data.`);
  const data = new Uint8Array(getBase64Encoder().encode(account.data[0]));
  if (
    !(
      data.length === size ||
      (name === "campaign" &&
        size === 48 &&
        data.length === 49 &&
        data[48] === 1)
    ) ||
    !ANCHOR_DISCRIMINATORS[name].every((byte, index) => data[index] === byte)
  )
    throw new Error(`The ${name} account has an invalid Anchor layout.`);
  return data;
}

function keyAt(data: Uint8Array, offset: number): string {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}

function amountAt(data: Uint8Array, offset: number): string {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
    .getBigUint64(offset, true)
    .toString();
}

function discriminator(name: "campaign" | "contribution"): string {
  return getBase58Decoder().decode(new Uint8Array(ANCHOR_DISCRIMINATORS[name]));
}

function signature(value: string): string {
  if (getBase58Encoder().encode(value).length !== 64)
    throw new Error("Invalid transaction history cursor.");
  return value;
}

/** Public chain accounts are the shared source of truth across wallets/devices. */
export class DevnetLedger {
  constructor(private readonly rpc: DevnetRpcTransport) {}

  private async checkNetwork() {
    if (
      (await this.rpc.call<string>("getGenesisHash", [])) !==
      DEVNET_GENESIS_HASH
    )
      throw new Error("The campaign connection is not Solana Devnet.");
  }

  private async campaign(
    pubkey: string,
    account: RpcAccount,
  ): Promise<Omit<DevnetCampaign, "vaultBalanceLamports">> {
    const data = bytes(account, "campaign", 48);
    const creatorAddress = keyAt(data, 8);
    const derived = await deriveCampaignAddresses(creatorAddress);
    if (pubkey !== derived.campaignAddress)
      throw new Error("The Campaign address does not match its creator PDA.");
    return {
      creatorAddress,
      ...derived,
      totalContributedLamports: amountAt(data, 40),
    };
  }

  async listCampaigns(): Promise<DevnetCampaign[]> {
    await this.checkNetwork();
    const responses = await Promise.all(
      [48, 49].map((dataSize) =>
        this.rpc.call<{ value: ProgramAccount[] }>("getProgramAccounts", [
          OPENFUNDS_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            commitment: "confirmed",
            withContext: true,
            filters: [
              { dataSize },
              { memcmp: { offset: 0, bytes: discriminator("campaign") } },
            ],
          },
        ]),
      ),
    );
    if (responses.some((response) => !Array.isArray(response.value)))
      throw new Error("Devnet returned an invalid campaign catalogue.");
    const rows = responses.flatMap((response) => response.value);
    if (!Array.isArray(rows) || rows.length > MAX_CAMPAIGNS)
      throw new Error(
        "The Devnet campaign catalogue exceeds the supported size.",
      );
    const seen = new Set<string>();
    const campaigns = [];
    for (const row of rows) {
      if (!row || typeof row.pubkey !== "string" || seen.has(row.pubkey))
        throw new Error("Devnet returned an invalid campaign catalogue.");
      seen.add(row.pubkey);
      campaigns.push(await this.campaign(row.pubkey, row.account));
    }
    const result: DevnetCampaign[] = [];
    for (let start = 0; start < campaigns.length; start += 100) {
      const batch = campaigns.slice(start, start + 100);
      const response = await this.rpc.call<{ value: (RpcAccount | null)[] }>(
        "getMultipleAccounts",
        [
          batch.map((item) => item.vaultAddress),
          { encoding: "base64", commitment: "confirmed" },
        ],
      );
      if (
        !Array.isArray(response.value) ||
        response.value.length !== batch.length
      )
        throw new Error("Devnet returned an incomplete vault snapshot.");
      batch.forEach((campaign, index) => {
        const vault = response.value[index];
        if (!vault) throw new Error("The campaign Vault is missing on Devnet.");
        bytes(vault, "vault", 8);
        result.push({
          ...campaign,
          vaultBalanceLamports: integer(
            vault.lamports,
            "vault balance",
          ).toString(),
        });
      });
    }
    return result.sort((left, right) =>
      left.campaignAddress.localeCompare(right.campaignAddress),
    );
  }

  async readSupport(backerAddress: string): Promise<DevnetSupport[]> {
    address(backerAddress);
    return this.contributions(40, backerAddress);
  }

  async readBackers(campaignAddress: string): Promise<DevnetSupport[]> {
    address(campaignAddress);
    return this.contributions(8, campaignAddress);
  }

  private async contributions(
    offset: 8 | 40,
    identity: string,
  ): Promise<DevnetSupport[]> {
    await this.checkNetwork();
    const response = await this.rpc.call<{ value: ProgramAccount[] }>(
      "getProgramAccounts",
      [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          withContext: true,
          filters: [
            { dataSize: 80 },
            { memcmp: { offset: 0, bytes: discriminator("contribution") } },
            { memcmp: { offset, bytes: identity } },
          ],
        },
      ],
    );
    const rows = response.value;
    if (!Array.isArray(rows) || rows.length > MAX_CAMPAIGNS)
      throw new Error(
        "The Devnet support catalogue exceeds the supported size.",
      );
    const result: DevnetSupport[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const data = bytes(row.account, "contribution", 80);
      const campaignAddress = keyAt(data, 8);
      const backerAddress = keyAt(data, 40);
      if (
        (offset === 8 ? campaignAddress : backerAddress) !== identity ||
        row.pubkey !==
          (await deriveContributionAddress(campaignAddress, backerAddress)) ||
        seen.has(row.pubkey)
      )
        throw new Error(
          "The Contribution address does not match its campaign and backer PDA.",
        );
      seen.add(row.pubkey);
      result.push({
        backerAddress,
        campaignAddress,
        contributionAddress: row.pubkey,
        totalContributedLamports: amountAt(data, 72),
      });
    }
    return result.sort((left, right) =>
      left.campaignAddress.localeCompare(right.campaignAddress),
    );
  }

  async readActivity(
    campaignAddress: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<DevnetActivityPage> {
    address(campaignAddress);
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT)
      throw new Error(
        "Transaction history page size must be between 1 and 20.",
      );
    if (options.before) signature(options.before);
    await this.checkNetwork();
    const snapshot = await this.rpc.call<{ value: RpcAccount | null }>(
      "getAccountInfo",
      [campaignAddress, { encoding: "base64", commitment: "confirmed" }],
    );
    if (!snapshot.value) throw new Error("The Campaign is missing on Devnet.");
    const campaign = await this.campaign(campaignAddress, snapshot.value);
    const rows = await this.rpc.call<SignatureRow[]>(
      "getSignaturesForAddress",
      [
        campaignAddress,
        {
          commitment: "confirmed",
          limit,
          ...(options.before ? { before: options.before } : {}),
        },
      ],
    );
    if (!Array.isArray(rows) || rows.length > limit)
      throw new Error("Devnet returned an invalid transaction history page.");
    rows.forEach((row) => signature(row.signature));
    const items: DevnetActivity[] = [];
    // Two concurrent lookups keep a page bounded and avoid RPC bursts.
    for (let start = 0; start < rows.length; start += 2) {
      const batch = await Promise.all(
        rows.slice(start, start + 2).map(async (row) => {
          const transaction = await this.rpc.call<unknown>("getTransaction", [
            row.signature,
            {
              encoding: "jsonParsed",
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            },
          ]);
          return this.parseActivity(campaign, row, transaction);
        }),
      );
      batch.forEach((item) => {
        if (item) items.push(item);
      });
    }
    return {
      items,
      hasMore: rows.length === limit,
      nextBefore: rows.length === limit ? rows.at(-1)!.signature : null,
    };
  }

  private async parseActivity(
    campaign: Omit<DevnetCampaign, "vaultBalanceLamports">,
    row: SignatureRow,
    raw: unknown,
  ): Promise<DevnetActivity | null> {
    const empty: DevnetActivity = {
      signature: row.signature,
      campaignAddress: campaign.campaignAddress,
      vaultAddress: campaign.vaultAddress,
      actorAddress: null,
      kind: "unavailable",
      status: row.err ? "failed" : "unavailable",
      amountLamports: null,
      feeLamports: null,
      walletDebitLamports: null,
      storageRentLamports: null,
      blockTime: blockTime(row.blockTime),
    };
    if (raw === null) return empty;
    const root = object(raw);
    const transaction = object(root?.transaction);
    const message = object(transaction?.message);
    const meta = object(root?.meta);
    if (
      !message ||
      !meta ||
      !Array.isArray(message.instructions) ||
      !Array.isArray(message.accountKeys)
    )
      return empty;
    if (
      !Array.isArray(transaction?.signatures) ||
      transaction.signatures[0] !== row.signature
    )
      return empty;
    const keys = message.accountKeys.map((value) => {
      const key = object(value);
      return key && typeof key.pubkey === "string"
        ? { pubkey: key.pubkey, signer: key.signer === true }
        : null;
    });
    if (keys.some((key) => key === null)) return empty;
    const programInstructions = message.instructions
      .map(object)
      .filter(
        (instruction) => instruction?.programId === OPENFUNDS_PROGRAM_ADDRESS,
      );
    if (programInstructions.length === 0) return null; // Direct wallet transfers are not OpenFunds contributions.
    if (programInstructions.length !== 1) return empty;
    const instruction = programInstructions[0]!;
    if (
      typeof instruction.data !== "string" ||
      !Array.isArray(instruction.accounts) ||
      instruction.accounts.some((key) => typeof key !== "string")
    )
      return empty;
    let data: Uint8Array;
    try {
      data = new Uint8Array(getBase58Encoder().encode(instruction.data));
    } catch {
      return empty;
    }
    const isInitialize =
      data.length === 8 &&
      ANCHOR_DISCRIMINATORS.initializeCampaign.every(
        (byte, index) => data[index] === byte,
      );
    const isContribution =
      data.length === 16 &&
      ANCHOR_DISCRIMINATORS.contribute.every(
        (byte, index) => data[index] === byte,
      );
    if (!isInitialize && !isContribution) return empty;
    const accounts = instruction.accounts as string[];
    const actorAddress = accounts[0];
    if (!keys.some((key) => key?.pubkey === actorAddress && key.signer))
      return empty;
    const expected = isInitialize
      ? [
          campaign.creatorAddress,
          campaign.campaignAddress,
          campaign.vaultAddress,
          SYSTEM_PROGRAM,
        ]
      : [
          actorAddress,
          campaign.campaignAddress,
          campaign.vaultAddress,
          await deriveContributionAddress(
            campaign.campaignAddress,
            actorAddress,
          ),
          SYSTEM_PROGRAM,
        ];
    if (
      accounts.length !== expected.length ||
      accounts.some((key, index) => key !== expected[index])
    )
      return empty;
    const kind = isInitialize ? "initialize" : "contribution";
    const fee = optionalInteger(meta.fee);
    const failed =
      (row.err !== null && row.err !== undefined) ||
      (meta.err !== null && meta.err !== undefined);
    const result: DevnetActivity = {
      ...empty,
      actorAddress,
      kind,
      status: failed
        ? "failed"
        : row.confirmationStatus === "finalized"
          ? "finalized"
          : "confirmed",
      feeLamports: fee?.toString() ?? null,
      blockTime: blockTime(root?.blockTime) ?? empty.blockTime,
    };
    const actorIndex = keys.findIndex((key) => key?.pubkey === actorAddress);
    const pre = Array.isArray(meta.preBalances)
      ? optionalInteger(meta.preBalances[actorIndex])
      : null;
    const post = Array.isArray(meta.postBalances)
      ? optionalInteger(meta.postBalances[actorIndex])
      : null;
    const debit =
      pre !== null && post !== null && pre >= post ? pre - post : null;
    result.walletDebitLamports = debit?.toString() ?? null;
    if (failed) return result; // A failed instruction's requested amount never becomes a contribution.
    const index = message.instructions.indexOf(instruction);
    const innerGroups = Array.isArray(meta.innerInstructions)
      ? meta.innerInstructions.map(object)
      : [];
    const group = innerGroups.find(
      (item) => optionalInteger(item?.index) === BigInt(index),
    );
    const inner =
      group && Array.isArray(group.instructions)
        ? group.instructions.map(object)
        : [];
    const system = inner
      .filter((item) => item?.programId === SYSTEM_PROGRAM)
      .map((item) => object(item?.parsed));
    let amount = 0n;
    if (isContribution) {
      amount = new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ).getBigUint64(8, true);
      const transfers = system
        .filter((parsed) => parsed?.type === "transfer")
        .map((parsed) => object(parsed?.info))
        .filter(
          (info) =>
            info?.source === actorAddress &&
            info.destination === campaign.vaultAddress,
        );
      if (
        amount === 0n ||
        transfers.length !== 1 ||
        optionalInteger(transfers[0]?.lamports) !== amount
      )
        return {
          ...result,
          status: "unavailable",
          amountLamports: null,
          storageRentLamports: null,
        };
    }
    result.amountLamports = amount.toString();
    let rent = 0n;
    let validRent = true;
    const storageAddresses = isInitialize
      ? [campaign.campaignAddress, campaign.vaultAddress]
      : [expected[3]];
    for (const parsed of system.filter(
      (item) => item?.type === "createAccount",
    )) {
      const info = object(parsed?.info);
      const lamports = optionalInteger(info?.lamports);
      if (
        !info ||
        info.source !== actorAddress ||
        !storageAddresses.includes(info.newAccount as string) ||
        info.owner !== OPENFUNDS_PROGRAM_ADDRESS ||
        lamports === null
      ) {
        validRent = false;
        break;
      }
      rent += lamports;
    }
    // Only label rent when the observed wallet debit reconciles with the CPI amounts and fee payer.
    const actorFee = keys[0]?.pubkey === actorAddress ? fee : 0n;
    if (
      validRent &&
      debit !== null &&
      actorFee !== null &&
      debit === amount + rent + actorFee
    )
      result.storageRentLamports = rent.toString();
    return result;
  }
}
