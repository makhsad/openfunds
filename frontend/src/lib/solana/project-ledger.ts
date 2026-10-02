import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { DevnetLedger } from "./devnet-ledger";
import {
  ANCHOR_DISCRIMINATORS,
  DEVNET_GENESIS_HASH,
  OPENFUNDS_PROGRAM_ADDRESS,
  deriveCampaignAddresses,
  deriveContributionAddress,
  type DevnetRpcTransport,
  type RpcAccount,
} from "./phantom-gateway";

export const PROJECT_DISCRIMINATORS = Object.freeze({
  campaign: [143, 234, 125, 14, 236, 236, 204, 213],
  vault: [26, 72, 80, 70, 37, 88, 90, 39],
  contribution: [19, 24, 135, 107, 193, 82, 223, 211],
  message: [252, 10, 41, 3, 188, 198, 169, 52],
  platform: [15, 97, 77, 27, 65, 209, 38, 166],
  legacyClosure: [115, 115, 255, 252, 87, 49, 82, 124],
  legacyReceipt: [179, 155, 183, 47, 99, 172, 208, 176],
  legacyDiscussion: [22, 68, 176, 55, 114, 58, 124, 91],
});

export const PROJECT_INSTRUCTIONS = Object.freeze({
  initialize: [180, 127, 94, 38, 181, 138, 88, 137],
  contribution: [72, 65, 231, 106, 127, 64, 114, 110],
  close: [76, 245, 67, 18, 125, 174, 176, 179],
  refund: [208, 209, 47, 206, 47, 221, 34, 202],
  message: [53, 152, 232, 248, 116, 19, 81, 183],
  platform: [126, 54, 1, 225, 10, 153, 160, 107],
  legacyClose: [199, 225, 37, 91, 166, 17, 130, 64],
  legacyRefund: [146, 247, 100, 22, 157, 169, 223, 173],
  legacyMessage: [120, 113, 110, 137, 206, 115, 0, 167],
});

export interface ProjectSummary {
  campaignAddress: string;
  creatorAddress: string;
  campaignId: string;
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  goalLamports: string;
  totalContributedLamports: string;
  totalRefundedLamports: string;
  vaultAddress: string;
  vaultBalanceLamports: string;
  closed: boolean;
  status: "open" | "refunds-pending" | "refunded";
  legacy: boolean;
  messageCount: string;
  createdAt: string;
  closedAt: string;
}

export interface ProjectBacker {
  campaignAddress: string;
  backerAddress: string;
  contributionAddress: string;
  totalContributedLamports: string;
  totalRefundedLamports: string;
  refundableLamports: string;
}

export interface ProjectMessage {
  campaignAddress: string;
  messageAddress: string;
  authorAddress: string;
  messageId: string;
  body: string;
  createdAt: string;
}

export interface ProjectActivity {
  signature: string;
  kind:
    | "initialize"
    | "contribution"
    | "close"
    | "refund"
    | "message"
    | "unavailable";
  actorAddress: string | null;
  recipientAddress?: string | null;
  amountLamports: string | null;
  feeLamports: string | null;
  status: "confirmed" | "finalized" | "failed" | "unavailable";
  blockTime: number | null;
}

export interface ProjectActivityPage {
  items: ProjectActivity[];
  nextBefore: string | null;
  hasMore: boolean;
}

const U64_MAX = (1n << 64n) - 1n;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
type ObjectValue = Record<string, unknown>;
type ProgramAccount = { pubkey: string; account: RpcAccount };

export function projectU64(value: string, label = "value"): bigint {
  if (!/^[0-9]+$/.test(value))
    throw new Error(`Invalid ${label}: use a whole number.`);
  const parsed = BigInt(value);
  if (parsed > U64_MAX)
    throw new Error(`${label} exceeds the on-chain u64 limit.`);
  return parsed;
}

export function encodeProjectU64(value: string): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, projectU64(value), true);
  return result;
}

async function derive(
  label: string,
  keys: string[] = [],
  id?: string,
): Promise<string> {
  return (
    await getProgramDerivedAddress({
      programAddress: address(OPENFUNDS_PROGRAM_ADDRESS),
      seeds: [
        new TextEncoder().encode(label),
        ...keys.map((key) => getAddressEncoder().encode(address(key))),
        ...(id === undefined ? [] : [encodeProjectU64(id)]),
      ],
    })
  )[0];
}

export async function deriveProjectAddresses(
  creatorAddress: string,
  campaignId: string,
) {
  const campaignAddress = await derive(
    "campaign_v2",
    [creatorAddress],
    campaignId,
  );
  return {
    campaignAddress,
    vaultAddress: await derive("vault_v2", [campaignAddress]),
  };
}
export const deriveProjectContributionAddress = (
  campaign: string,
  backer: string,
) => derive("contribution_v2", [campaign, backer]);
export const deriveProjectMessageAddress = (campaign: string, index: string) =>
  derive("message_v2", [campaign], index);
export const derivePlatformAddress = () => derive("platform_v2");
export const deriveLegacyClosureAddress = (campaign: string) =>
  derive("legacy_close", [campaign]);
export const deriveLegacyReceiptAddress = (campaign: string, backer: string) =>
  derive("legacy_refund", [campaign, backer]);
export const deriveLegacyDiscussionAddress = (campaign: string) =>
  derive("legacy_discussion", [campaign]);

function rpcInteger(value: unknown): bigint {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  )
    throw new Error("RPC returned an invalid integer.");
  const result = BigInt(value);
  if (result < 0n) throw new Error("RPC returned an invalid integer.");
  return result;
}
function optionalInteger(value: unknown): bigint | null {
  try {
    return rpcInteger(value);
  } catch {
    return null;
  }
}
function object(value: unknown): ObjectValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
}
function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]) {
  return discriminator.every((byte, index) => data[index] === byte);
}
function accountBytes(
  account: RpcAccount | null,
  discriminator: readonly number[],
  size: number | number[],
  label: string,
): Uint8Array {
  if (
    !account ||
    account.owner !== OPENFUNDS_PROGRAM_ADDRESS ||
    account.executable
  )
    throw new Error(`Invalid ${label} owner.`);
  if (
    !Array.isArray(account.data) ||
    account.data[1] !== "base64" ||
    typeof account.data[0] !== "string"
  )
    throw new Error(`Invalid ${label} encoding.`);
  const data = Uint8Array.from(getBase64Encoder().encode(account.data[0]));
  if (
    !(Array.isArray(size)
      ? size.includes(data.length)
      : size === data.length) ||
    !hasDiscriminator(data, discriminator)
  )
    throw new Error(`Invalid ${label} account layout.`);
  return data;
}
function keyAt(data: Uint8Array, offset: number) {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
function uintAt(data: Uint8Array, offset: number) {
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}
function intAt(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
    .getBigInt64(offset, true)
    .toString();
}
function stringAt(
  data: Uint8Array,
  offset: number,
  max: number,
): [string, number] {
  if (offset + 4 > data.length) throw new Error("Truncated project metadata.");
  const length = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getUint32(offset, true);
  if (length > max || offset + 4 + length > data.length)
    throw new Error("Invalid project metadata length.");
  return [
    new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(offset + 4, offset + 4 + length),
    ),
    offset + 4 + length,
  ];
}
function discriminatorFilter(discriminator: readonly number[]) {
  return {
    memcmp: {
      offset: 0,
      bytes: getBase58Decoder().decode(Uint8Array.from(discriminator)),
    },
  };
}
function signature(value: string) {
  if (getBase58Encoder().encode(value).length !== 64)
    throw new Error("Invalid transaction signature.");
  return value;
}

/** Metadata, chat, contribution and refund state come from canonical program accounts. */
export class ProjectLedger {
  private readonly legacy: DevnetLedger;
  constructor(private readonly rpc: DevnetRpcTransport) {
    this.legacy = new DevnetLedger(rpc);
  }
  private async checkNetwork() {
    if (
      (await this.rpc.call<string>("getGenesisHash", [])) !==
      DEVNET_GENESIS_HASH
    )
      throw new Error("The connection is not Solana Devnet.");
  }
  private async getAccount(key: string) {
    address(key);
    return (
      await this.rpc.call<{ value: RpcAccount | null }>("getAccountInfo", [
        key,
        { encoding: "base64", commitment: "confirmed" },
      ])
    ).value;
  }
  private async scan(
    discriminator: readonly number[],
    size: number,
    campaign?: string,
    identityOffset = 8,
  ): Promise<ProgramAccount[]> {
    const response = await this.rpc.call<{ value: ProgramAccount[] }>(
      "getProgramAccounts",
      [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          withContext: true,
          filters: [
            { dataSize: size },
            discriminatorFilter(discriminator),
            ...(campaign
              ? [
                  {
                    memcmp: {
                      offset: identityOffset,
                      bytes: address(campaign),
                    },
                  },
                ]
              : []),
          ],
        },
      ],
    );
    if (!Array.isArray(response.value) || response.value.length > 1_000)
      throw new Error("Project catalogue exceeds the supported size.");
    const seen = new Set<string>();
    for (const row of response.value) {
      if (!row || typeof row.pubkey !== "string" || seen.has(row.pubkey))
        throw new Error("Invalid project account catalogue.");
      address(row.pubkey);
      seen.add(row.pubkey);
    }
    return response.value;
  }

  async readCapabilities(): Promise<{ version: number; available: boolean }> {
    await this.checkNetwork();
    const account = await this.getAccount(await derivePlatformAddress());
    if (!account) return { version: 1, available: false };
    const data = accountBytes(
      account,
      PROJECT_DISCRIMINATORS.platform,
      9,
      "platform",
    );
    if (data[8] !== 2)
      throw new Error("Unsupported OpenFunds platform version.");
    return { version: 2, available: true };
  }

  async readTransactionStatus(
    transactionSignature: string,
  ): Promise<"pending" | "confirmed" | "failed"> {
    signature(transactionSignature);
    await this.checkNetwork();
    const response = await this.rpc.call<{
      value: ({ err: unknown; confirmationStatus: string | null } | null)[];
    }>("getSignatureStatuses", [
      [transactionSignature],
      { searchTransactionHistory: true },
    ]);
    if (!Array.isArray(response.value) || response.value.length !== 1)
      throw new Error("Invalid transaction confirmation response.");
    const status = response.value[0];
    if (status === null) return "pending";
    if (!status || typeof status !== "object" || !("err" in status))
      throw new Error("Invalid transaction confirmation response.");
    if (status.err !== null) return "failed";
    return status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
      ? "confirmed"
      : "pending";
  }

  private async decodeCampaign(
    campaignAddress: string,
    account: RpcAccount,
  ): Promise<ProjectSummary> {
    const raw = Uint8Array.from(getBase64Encoder().encode(account.data[0]));
    if (hasDiscriminator(raw, ANCHOR_DISCRIMINATORS.campaign)) {
      const data = accountBytes(
        account,
        ANCHOR_DISCRIMINATORS.campaign,
        [48, 49],
        "legacy campaign",
      );
      const creatorAddress = keyAt(data, 8);
      const derived = await deriveCampaignAddresses(creatorAddress);
      if (
        campaignAddress !== derived.campaignAddress ||
        (data.length === 49 && data[48] !== 1)
      )
        throw new Error("Invalid legacy Campaign PDA or closure flag.");
      const closure = await this.getAccount(
        await deriveLegacyClosureAddress(campaignAddress),
      );
      let refunded = 0n;
      let closedAt = "0";
      let status: ProjectSummary["status"] = "open";
      if (closure) {
        const closureData = accountBytes(
          closure,
          PROJECT_DISCRIMINATORS.legacyClosure,
          89,
          "legacy closure",
        );
        if (
          keyAt(closureData, 8) !== campaignAddress ||
          keyAt(closureData, 40) !== creatorAddress ||
          ![1, 2].includes(closureData[80]) ||
          data.length !== 49
        )
          throw new Error("Invalid legacy closure identities.");
        refunded = uintAt(closureData, 72);
        closedAt = intAt(closureData, 81);
        status = closureData[80] === 2 ? "refunded" : "refunds-pending";
      } else if (data.length === 49)
        throw new Error("Closed legacy campaign is missing its refund state.");
      const raised = uintAt(data, 40);
      if (refunded > raised || (status === "refunded" && refunded !== raised))
        throw new Error("Invalid legacy refund totals.");
      const discussion = await this.getAccount(
        await deriveLegacyDiscussionAddress(campaignAddress),
      );
      let messageCount = "0";
      if (discussion) {
        const discussionData = accountBytes(
          discussion,
          PROJECT_DISCRIMINATORS.legacyDiscussion,
          48,
          "legacy discussion",
        );
        if (keyAt(discussionData, 8) !== campaignAddress)
          throw new Error("Invalid legacy discussion identity.");
        messageCount = uintAt(discussionData, 40).toString();
      }
      return {
        ...derived,
        creatorAddress,
        campaignId: "0",
        title: "",
        description: "",
        imageUrl: "",
        category: "general",
        goalLamports: "0",
        totalContributedLamports: raised.toString(),
        totalRefundedLamports: refunded.toString(),
        vaultBalanceLamports: "0",
        closed: status !== "open",
        status,
        legacy: true,
        messageCount,
        createdAt: "0",
        closedAt,
      };
    }
    const data = accountBytes(
      account,
      PROJECT_DISCRIMINATORS.campaign,
      789,
      "project",
    );
    const creatorAddress = keyAt(data, 8);
    const campaignId = uintAt(data, 40).toString();
    const derived = await deriveProjectAddresses(creatorAddress, campaignId);
    if (derived.campaignAddress !== campaignAddress)
      throw new Error(
        "Project does not match its canonical creator and identifier PDA.",
      );
    const raised = uintAt(data, 56),
      refunded = uintAt(data, 64);
    if (
      uintAt(data, 48) === 0n ||
      refunded > raised ||
      data[96] > 2 ||
      (data[96] === 0 && refunded !== 0n) ||
      (data[96] === 2 && refunded !== raised)
    )
      throw new Error("Invalid project funding state.");
    const [title, offset1] = stringAt(data, 97, 80);
    const [description, offset2] = stringAt(data, offset1, 400);
    const [imageUrl] = stringAt(data, offset2, 200);
    if (!title.trim() || !description.trim())
      throw new Error("Project has empty required metadata.");
    return {
      ...derived,
      creatorAddress,
      campaignId,
      title,
      description,
      imageUrl,
      category: "general",
      goalLamports: uintAt(data, 48).toString(),
      totalContributedLamports: raised.toString(),
      totalRefundedLamports: refunded.toString(),
      vaultBalanceLamports: "0",
      closed: data[96] !== 0,
      status: ["open", "refunds-pending", "refunded"][
        data[96]
      ] as ProjectSummary["status"],
      legacy: false,
      messageCount: uintAt(data, 72).toString(),
      createdAt: intAt(data, 80),
      closedAt: intAt(data, 88),
    };
  }

  async readProject(campaignAddress: string): Promise<ProjectSummary> {
    await this.checkNetwork();
    const account = await this.getAccount(campaignAddress);
    if (!account) throw new Error("Project was not found on Devnet.");
    const project = await this.decodeCampaign(campaignAddress, account);
    const vault = await this.getAccount(project.vaultAddress);
    accountBytes(
      vault,
      project.legacy
        ? ANCHOR_DISCRIMINATORS.vault
        : PROJECT_DISCRIMINATORS.vault,
      8,
      "vault",
    );
    const balance = rpcInteger(vault!.lamports);
    if (
      balance <
      BigInt(project.totalContributedLamports) -
        BigInt(project.totalRefundedLamports)
    )
      throw new Error(
        "Vault balance does not cover outstanding contributions.",
      );
    return { ...project, vaultBalanceLamports: balance.toString() };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.checkNetwork();
    const current = await this.scan(PROJECT_DISCRIMINATORS.campaign, 789);
    const old = await this.legacy.listCampaigns();
    const projects = [];
    // Small batches limit Devnet bursts and retain canonical validation for every project.
    for (let start = 0; start < current.length + old.length; start += 4) {
      const keys = [
        ...current.map((item) => item.pubkey),
        ...old.map((item) => item.campaignAddress),
      ].slice(start, start + 4);
      projects.push(
        ...(await Promise.all(keys.map((key) => this.readProject(key)))),
      );
    }
    return projects.sort((left, right) =>
      BigInt(left.createdAt) === BigInt(right.createdAt)
        ? left.campaignAddress.localeCompare(right.campaignAddress)
        : BigInt(left.createdAt) > BigInt(right.createdAt)
          ? -1
          : 1,
    );
  }

  private async decodeBacker(
    project: ProjectSummary,
    contributionAddress: string,
    account: RpcAccount,
  ): Promise<ProjectBacker> {
    const data = accountBytes(
      account,
      project.legacy
        ? ANCHOR_DISCRIMINATORS.contribution
        : PROJECT_DISCRIMINATORS.contribution,
      project.legacy ? 80 : 88,
      "contribution",
    );
    const campaignAddress = keyAt(data, 8),
      backerAddress = keyAt(data, 40);
    const expected = project.legacy
      ? await deriveContributionAddress(campaignAddress, backerAddress)
      : await deriveProjectContributionAddress(campaignAddress, backerAddress);
    if (
      campaignAddress !== project.campaignAddress ||
      expected !== contributionAddress
    )
      throw new Error(
        "Contribution does not match its canonical project and backer PDA.",
      );
    const contributed = uintAt(data, 72);
    let refunded = project.legacy ? 0n : uintAt(data, 80);
    if (project.legacy) {
      const receipt = await this.getAccount(
        await deriveLegacyReceiptAddress(campaignAddress, backerAddress),
      );
      if (receipt) {
        const bytes = accountBytes(
          receipt,
          PROJECT_DISCRIMINATORS.legacyReceipt,
          80,
          "refund receipt",
        );
        if (
          keyAt(bytes, 8) !== campaignAddress ||
          keyAt(bytes, 40) !== backerAddress
        )
          throw new Error("Invalid legacy refund receipt identities.");
        refunded = uintAt(bytes, 72);
      }
    }
    if (refunded > contributed || (!project.closed && refunded !== 0n))
      throw new Error("Invalid backer refund totals.");
    return {
      campaignAddress,
      backerAddress,
      contributionAddress,
      totalContributedLamports: contributed.toString(),
      totalRefundedLamports: refunded.toString(),
      refundableLamports: (contributed - refunded).toString(),
    };
  }

  async listBackers(campaignAddress: string): Promise<ProjectBacker[]> {
    const project = await this.readProject(campaignAddress);
    const rows = await this.scan(
      project.legacy
        ? ANCHOR_DISCRIMINATORS.contribution
        : PROJECT_DISCRIMINATORS.contribution,
      project.legacy ? 80 : 88,
      campaignAddress,
    );
    const backers = await Promise.all(
      rows.map((row) => this.decodeBacker(project, row.pubkey, row.account)),
    );
    return backers.sort((left, right) =>
      left.backerAddress.localeCompare(right.backerAddress),
    );
  }

  async readMyContribution(
    campaignAddress: string,
    backerAddress: string,
  ): Promise<ProjectBacker | null> {
    const project = await this.readProject(campaignAddress);
    const key = project.legacy
      ? await deriveContributionAddress(campaignAddress, backerAddress)
      : await deriveProjectContributionAddress(campaignAddress, backerAddress);
    const account = await this.getAccount(key);
    return account ? this.decodeBacker(project, key, account) : null;
  }

  async listMyContributions(backerAddress: string): Promise<ProjectBacker[]> {
    address(backerAddress);
    await this.checkNetwork();
    const current = await this.scan(
      PROJECT_DISCRIMINATORS.contribution,
      88,
      backerAddress,
      40,
    );
    const old = await this.scan(
      ANCHOR_DISCRIMINATORS.contribution,
      80,
      backerAddress,
      40,
    );
    const result: ProjectBacker[] = [];
    const projects = new Map<string, ProjectSummary>();
    for (const row of [...current, ...old]) {
      const data = accountBytes(
        row.account,
        current.includes(row)
          ? PROJECT_DISCRIMINATORS.contribution
          : ANCHOR_DISCRIMINATORS.contribution,
        current.includes(row) ? 88 : 80,
        "contribution",
      );
      if (keyAt(data, 40) !== backerAddress)
        throw new Error("Contribution does not match the requested backer.");
      const campaignAddress = keyAt(data, 8);
      const project =
        projects.get(campaignAddress) ??
        (await this.readProject(campaignAddress));
      projects.set(campaignAddress, project);
      result.push(await this.decodeBacker(project, row.pubkey, row.account));
    }
    return result.sort((left, right) =>
      left.campaignAddress.localeCompare(right.campaignAddress),
    );
  }

  async listMessages(campaignAddress: string): Promise<ProjectMessage[]> {
    const project = await this.readProject(campaignAddress);
    const rows = await this.scan(
      PROJECT_DISCRIMINATORS.message,
      332,
      campaignAddress,
    );
    const messages = [];
    const checkedAuthors = new Set<string>([project.creatorAddress]);
    for (const row of rows) {
      const data = accountBytes(
        row.account,
        PROJECT_DISCRIMINATORS.message,
        332,
        "message",
      );
      const messageId = uintAt(data, 72).toString();
      if (
        keyAt(data, 8) !== campaignAddress ||
        (await deriveProjectMessageAddress(campaignAddress, messageId)) !==
          row.pubkey ||
        BigInt(messageId) >= BigInt(project.messageCount)
      )
        throw new Error(
          "Message does not match its canonical project and index PDA.",
        );
      const [body] = stringAt(data, 88, 240);
      if (!body.trim()) throw new Error("Message body is empty.");
      const authorAddress = keyAt(data, 40);
      if (!checkedAuthors.has(authorAddress)) {
        const contributionAddress = project.legacy
          ? await deriveContributionAddress(campaignAddress, authorAddress)
          : await deriveProjectContributionAddress(
              campaignAddress,
              authorAddress,
            );
        const contributor = await this.getAccount(contributionAddress);
        if (
          !contributor ||
          BigInt(
            (await this.decodeBacker(project, contributionAddress, contributor))
              .totalContributedLamports,
          ) === 0n
        )
          throw new Error(
            "Message author is not this project's creator or recorded backer.",
          );
        checkedAuthors.add(authorAddress);
      }
      messages.push({
        campaignAddress,
        messageAddress: row.pubkey,
        authorAddress,
        messageId,
        body,
        createdAt: intAt(data, 80),
      });
    }
    return messages.sort((left, right) =>
      BigInt(left.messageId) < BigInt(right.messageId) ? -1 : 1,
    );
  }

  async listActivity(
    campaignAddress: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ProjectActivityPage> {
    const project = await this.readProject(campaignAddress);
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error("History page size must be between 1 and 20.");
    if (options.before) signature(options.before);
    const rows = await this.rpc.call<
      {
        signature: string;
        err: unknown;
        blockTime: bigint | number | null;
        confirmationStatus?: string | null;
      }[]
    >("getSignaturesForAddress", [
      campaignAddress,
      {
        commitment: "confirmed",
        limit,
        ...(options.before ? { before: options.before } : {}),
      },
    ]);
    if (!Array.isArray(rows) || rows.length > limit)
      throw new Error("Invalid transaction history page.");
    const items: ProjectActivity[] = [];
    for (const row of rows) {
      signature(row.signature);
      const raw = await this.rpc.call<unknown>("getTransaction", [
        row.signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      items.push(await this.parseActivity(project, row, raw));
    }
    return {
      items,
      hasMore: rows.length === limit,
      nextBefore: rows.length === limit ? rows.at(-1)!.signature : null,
    };
  }

  private async parseActivity(
    project: ProjectSummary,
    row: {
      signature: string;
      err: unknown;
      blockTime: bigint | number | null;
      confirmationStatus?: string | null;
    },
    raw: unknown,
  ): Promise<ProjectActivity> {
    const time = optionalInteger(row.blockTime);
    const empty: ProjectActivity = {
      signature: row.signature,
      kind: "unavailable",
      actorAddress: null,
      amountLamports: null,
      feeLamports: null,
      status: row.err ? "failed" : "unavailable",
      blockTime:
        time !== null && time <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(time)
          : null,
    };
    const root = object(raw),
      transaction = object(root?.transaction),
      message = object(transaction?.message),
      meta = object(root?.meta);
    if (
      !Array.isArray(transaction?.signatures) ||
      transaction.signatures[0] !== row.signature
    )
      return empty;
    if (
      !message ||
      !meta ||
      !Array.isArray(message.instructions) ||
      !Array.isArray(message.accountKeys)
    )
      return empty;
    const keys = message.accountKeys.map(object);
    const candidates = message.instructions
      .map(object)
      .filter((ix) => ix?.programId === OPENFUNDS_PROGRAM_ADDRESS);
    if (candidates.length !== 1) return empty;
    const ix = candidates[0]!;
    if (
      typeof ix.data !== "string" ||
      !Array.isArray(ix.accounts) ||
      !ix.accounts.every((key) => typeof key === "string")
    )
      return empty;
    let data: Uint8Array;
    try {
      data = Uint8Array.from(getBase58Encoder().encode(ix.data));
    } catch {
      return empty;
    }
    const accounts = ix.accounts as string[],
      actor = accounts[0];
    if (
      accounts[1] !== project.campaignAddress ||
      !keys.some((key) => key?.pubkey === actor && key.signer === true)
    )
      return empty;
    let kind: ProjectActivity["kind"] = "unavailable";
    const is = (disc: readonly number[], length?: number) =>
      hasDiscriminator(data, disc) &&
      (length === undefined || data.length === length);
    if (
      is(
        project.legacy
          ? ANCHOR_DISCRIMINATORS.initializeCampaign
          : PROJECT_INSTRUCTIONS.initialize,
      )
    )
      kind = "initialize";
    else if (
      is(
        project.legacy
          ? ANCHOR_DISCRIMINATORS.contribute
          : PROJECT_INSTRUCTIONS.contribution,
        16,
      )
    )
      kind = "contribution";
    else if (
      is(
        project.legacy
          ? PROJECT_INSTRUCTIONS.legacyClose
          : PROJECT_INSTRUCTIONS.close,
        8,
      )
    )
      kind = "close";
    else if (
      is(
        project.legacy
          ? PROJECT_INSTRUCTIONS.legacyRefund
          : PROJECT_INSTRUCTIONS.refund,
        8,
      )
    )
      kind = "refund";
    else if (
      is(
        project.legacy
          ? PROJECT_INSTRUCTIONS.legacyMessage
          : PROJECT_INSTRUCTIONS.message,
      )
    )
      kind = "message";
    if (kind === "unavailable") return empty;
    if (
      kind === "initialize" &&
      (actor !== project.creatorAddress ||
        accounts.length !== 4 ||
        accounts[2] !== project.vaultAddress ||
        accounts[3] !== SYSTEM_PROGRAM)
    )
      return empty;
    if (
      kind === "close" &&
      (actor !== project.creatorAddress ||
        (project.legacy
          ? accounts.length !== 5 ||
            accounts[2] !== project.vaultAddress ||
            accounts[3] !==
              (await deriveLegacyClosureAddress(project.campaignAddress)) ||
            accounts[4] !== SYSTEM_PROGRAM
          : accounts.length !== 2))
    )
      return empty;
    if (
      kind === "message" &&
      (data.length < 20 ||
        accounts.length !== (project.legacy ? 6 : 5) ||
        accounts[2] !==
          (project.legacy
            ? await deriveContributionAddress(project.campaignAddress, actor)
            : await deriveProjectContributionAddress(
                project.campaignAddress,
                actor,
              )) ||
        (project.legacy &&
          accounts[3] !==
            (await deriveLegacyDiscussionAddress(project.campaignAddress))) ||
        accounts[project.legacy ? 4 : 3] !==
          (await deriveProjectMessageAddress(
            project.campaignAddress,
            uintAt(data, 8).toString(),
          )) ||
        accounts[project.legacy ? 5 : 4] !== SYSTEM_PROGRAM)
    )
      return empty;
    const failed = row.err != null || meta.err != null;
    const fee = optionalInteger(meta.fee);
    const result = {
      ...empty,
      kind,
      actorAddress: actor,
      feeLamports: fee?.toString() ?? null,
      status: failed
        ? ("failed" as const)
        : row.confirmationStatus === "finalized"
          ? ("finalized" as const)
          : ("confirmed" as const),
    };
    if (failed) return result;
    if (kind === "contribution") {
      const expectedContribution = project.legacy
        ? await deriveContributionAddress(project.campaignAddress, actor)
        : await deriveProjectContributionAddress(
            project.campaignAddress,
            actor,
          );
      if (
        accounts.length !== 5 ||
        accounts[2] !== project.vaultAddress ||
        accounts[3] !== expectedContribution ||
        accounts[4] !== SYSTEM_PROGRAM
      )
        return empty;
      const amount = uintAt(data, 8);
      const instructionIndex = message.instructions.indexOf(ix);
      const groups = Array.isArray(meta.innerInstructions)
        ? meta.innerInstructions.map(object)
        : [];
      const group = groups.find(
        (item) => optionalInteger(item?.index) === BigInt(instructionIndex),
      );
      const inner =
        group && Array.isArray(group.instructions)
          ? group.instructions.map(object)
          : [];
      const transfers = inner
        .filter((item) => item?.programId === SYSTEM_PROGRAM)
        .map((item) => object(item?.parsed))
        .filter((item) => item?.type === "transfer")
        .map((item) => object(item?.info))
        .filter(
          (info) =>
            info?.source === actor && info.destination === project.vaultAddress,
        );
      if (
        amount <= 0n ||
        transfers.length !== 1 ||
        optionalInteger(transfers[0]?.lamports) !== amount
      )
        return { ...result, status: "unavailable", amountLamports: null };
      return { ...result, amountLamports: amount.toString() };
    }
    if (kind === "refund") {
      const recipient = accounts[project.legacy ? 6 : 4];
      if (accounts[2] !== project.vaultAddress || typeof recipient !== "string")
        return empty;
      const expectedContribution = project.legacy
        ? await deriveContributionAddress(project.campaignAddress, recipient)
        : await deriveProjectContributionAddress(
            project.campaignAddress,
            recipient,
          );
      if (
        accounts[3] !== expectedContribution ||
        (actor !== project.creatorAddress && actor !== recipient)
      )
        return empty;
      if (
        project.legacy &&
        (accounts.length !== 8 ||
          accounts[4] !==
            (await deriveLegacyClosureAddress(project.campaignAddress)) ||
          accounts[5] !==
            (await deriveLegacyReceiptAddress(
              project.campaignAddress,
              recipient,
            )) ||
          accounts[7] !== SYSTEM_PROGRAM)
      )
        return empty;
      if (!project.legacy && accounts.length !== 5) return empty;
      const vaultIndex = keys.findIndex(
          (key) => key?.pubkey === project.vaultAddress,
        ),
        backerIndex = keys.findIndex((key) => key?.pubkey === recipient);
      const pre = Array.isArray(meta.preBalances)
          ? optionalInteger(meta.preBalances[vaultIndex])
          : null,
        post = Array.isArray(meta.postBalances)
          ? optionalInteger(meta.postBalances[vaultIndex])
          : null;
      const backerPre = Array.isArray(meta.preBalances)
          ? optionalInteger(meta.preBalances[backerIndex])
          : null,
        backerPost = Array.isArray(meta.postBalances)
          ? optionalInteger(meta.postBalances[backerIndex])
          : null;
      // Refunds mutate program-owned lamports directly; reconcile both endpoints.
      const amount =
        pre !== null && post !== null && pre > post ? pre - post : null;
      const received =
        backerPre !== null && backerPost !== null
          ? backerPost -
            backerPre +
            (keys[0]?.pubkey === recipient ? (fee ?? 0n) : 0n)
          : null;
      let receiptRent = 0n;
      if (project.legacy && actor === recipient) {
        const groups = Array.isArray(meta.innerInstructions)
          ? meta.innerInstructions.map(object)
          : [];
        const all = groups.flatMap((group) =>
          group && Array.isArray(group.instructions)
            ? group.instructions.map(object)
            : [],
        );
        const creations = all
          .filter((item) => item?.programId === SYSTEM_PROGRAM)
          .map((item) => object(item?.parsed))
          .filter((item) => item?.type === "createAccount")
          .map((item) => object(item?.info));
        for (const info of creations) {
          if (
            info?.source !== recipient ||
            info.newAccount !== accounts[5] ||
            info.owner !== OPENFUNDS_PROGRAM_ADDRESS ||
            optionalInteger(info.lamports) === null
          )
            return { ...result, status: "unavailable", amountLamports: null };
          receiptRent += optionalInteger(info.lamports)!;
        }
      }
      if (
        amount === null ||
        received === null ||
        received + receiptRent !== amount
      )
        return { ...result, status: "unavailable", amountLamports: null };
      return {
        ...result,
        recipientAddress: recipient,
        amountLamports: amount.toString(),
      };
    }
    return { ...result, amountLamports: "0" };
  }
}
