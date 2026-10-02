import { AccountRole, address, type Instruction } from "@solana/kit";
import {
  PhantomCampaignGateway,
  deriveContributionAddress,
  type DevnetRpcTransport,
} from "./phantom-gateway";
import {
  PROJECT_INSTRUCTIONS,
  ProjectLedger,
  deriveLegacyClosureAddress,
  deriveLegacyReceiptAddress,
  deriveLegacyDiscussionAddress,
  derivePlatformAddress,
  deriveProjectAddresses,
  deriveProjectContributionAddress,
  deriveProjectMessageAddress,
  encodeProjectU64,
  projectU64,
} from "./project-ledger";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const U64_MAX = (1n << 64n) - 1n;
export const PROJECT_LIMITS = Object.freeze({
  title: 80,
  description: 400,
  imageUrl: 200,
  message: 240,
});

export interface InitializeProjectInput {
  campaignId: string;
  title: string;
  description: string;
  imageUrl: string;
  category?: string;
  goalLamports: string;
}

function encodeString(
  value: string,
  max: number,
  label: string,
  required = false,
): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if ((required && !value.trim()) || encoded.length > max)
    throw new Error(
      `${label} must ${required ? "be nonempty and " : ""}fit in ${max} UTF-8 bytes.`,
    );
  const result = new Uint8Array(4 + encoded.length);
  new DataView(result.buffer).setUint32(0, encoded.length, true);
  result.set(encoded, 4);
  return result;
}

function concat(
  ...parts: readonly (Uint8Array | readonly number[])[]
): Uint8Array {
  const data = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return data;
}

export function validateProjectMetadata(input: InitializeProjectInput): void {
  projectU64(input.campaignId, "campaign identifier");
  if (projectU64(input.goalLamports, "funding goal") === 0n)
    throw new Error("Funding goal must be greater than zero.");
  encodeString(input.title, PROJECT_LIMITS.title, "Title", true);
  encodeString(
    input.description,
    PROJECT_LIMITS.description,
    "Description",
    true,
  );
  encodeString(input.imageUrl, PROJECT_LIMITS.imageUrl, "Image URL");
  if (input.imageUrl) {
    let url: URL;
    try {
      url = new URL(input.imageUrl);
    } catch {
      throw new Error("Use a valid HTTPS image URL.");
    }
    if (url.protocol !== "https:")
      throw new Error("Use a valid HTTPS image URL.");
  }
}

/** One active Phantom signer; every mutation rechecks wallet, chain and account state. */
export class ProjectGateway {
  readonly ledger: ProjectLedger;
  private readonly wallet: PhantomCampaignGateway;
  private readonly rpc: DevnetRpcTransport;
  constructor(options: {
    walletGateway: PhantomCampaignGateway;
    rpc: DevnetRpcTransport;
  }) {
    this.wallet = options.walletGateway;
    this.rpc = options.rpc;
    this.ledger = new ProjectLedger(options.rpc);
  }
  get connectedAddress() {
    return this.wallet.connectedAddress;
  }
  readTransactionStatus(transactionSignature: string) {
    return this.ledger.readTransactionStatus(transactionSignature);
  }
  private requireWallet() {
    const wallet = this.connectedAddress;
    if (!wallet) throw new Error("Connect Phantom before using this action.");
    return wallet;
  }
  private async requireV2() {
    if (!(await this.ledger.readCapabilities()).available)
      throw new Error(
        "OpenFunds requires the Devnet program upgrade and platform setup before this action is available.",
      );
  }
  private instruction(
    data: Uint8Array,
    accounts: { address: string; role: AccountRole }[],
  ): Instruction {
    return {
      programAddress: address(this.wallet.programAddress),
      accounts: accounts.map((account) => ({
        ...account,
        address: address(account.address),
      })),
      data,
    };
  }
  private async send(
    wallet: string,
    data: Uint8Array,
    accounts: { address: string; role: AccountRole }[],
  ): Promise<string> {
    if (this.requireWallet() !== wallet)
      throw new Error(
        "Phantom account changed. Review the new wallet and try again.",
      );
    return this.wallet.sendInstruction(this.instruction(data, accounts));
  }

  /** Explicit signed setup after an approved program upgrade; never run on mount. */
  async initializePlatform(): Promise<{ signature: string }> {
    const wallet = this.requireWallet();
    const capability = await this.ledger.readCapabilities();
    if (capability.available)
      throw new Error("OpenFunds platform is already initialized.");
    return {
      signature: await this.send(
        wallet,
        Uint8Array.from(PROJECT_INSTRUCTIONS.platform),
        [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          {
            address: await derivePlatformAddress(),
            role: AccountRole.WRITABLE,
          },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
      ),
    };
  }

  async initializeProject(
    input: InitializeProjectInput,
  ): Promise<{ campaignAddress: string; signature: string }> {
    validateProjectMetadata(input);
    const wallet = this.requireWallet();
    await this.requireV2();
    const { campaignAddress, vaultAddress } = await deriveProjectAddresses(
      wallet,
      input.campaignId,
    );
    const existing = await this.rpc.call<{ value: unknown }>("getAccountInfo", [
      campaignAddress,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (existing.value)
      throw new Error(
        "This campaign identifier already exists for the selected creator.",
      );
    const data = concat(
      PROJECT_INSTRUCTIONS.initialize,
      encodeProjectU64(input.campaignId),
      encodeProjectU64(input.goalLamports),
      encodeString(input.title, PROJECT_LIMITS.title, "Title", true),
      encodeString(
        input.description,
        PROJECT_LIMITS.description,
        "Description",
        true,
      ),
      encodeString(input.imageUrl, PROJECT_LIMITS.imageUrl, "Image URL"),
    );
    return {
      campaignAddress,
      signature: await this.send(wallet, data, [
        { address: wallet, role: AccountRole.WRITABLE_SIGNER },
        { address: campaignAddress, role: AccountRole.WRITABLE },
        { address: vaultAddress, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ]),
    };
  }

  async contribute(
    campaignAddress: string,
    amountLamports: string,
  ): Promise<{ signature: string }> {
    const amount = projectU64(amountLamports, "contribution");
    if (amount === 0n)
      throw new Error("Contribution must be greater than zero.");
    const wallet = this.requireWallet();
    const project = await this.ledger.readProject(campaignAddress);
    if (project.closed)
      throw new Error(
        "This project is closed and no longer accepts contributions.",
      );
    if (project.legacy) {
      if (this.requireWallet() !== wallet)
        throw new Error(
          "Phantom account changed. Review the new wallet and try again.",
        );
      return this.wallet.contribute(campaignAddress, amountLamports);
    }
    await this.requireV2();
    const own = await this.ledger.readMyContribution(campaignAddress, wallet);
    if (
      BigInt(project.totalContributedLamports) + amount > U64_MAX ||
      BigInt(own?.totalContributedLamports ?? "0") + amount > U64_MAX
    )
      throw new Error("Contribution would overflow an on-chain total.");
    return {
      signature: await this.send(
        wallet,
        concat(
          PROJECT_INSTRUCTIONS.contribution,
          encodeProjectU64(amountLamports),
        ),
        [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: campaignAddress, role: AccountRole.WRITABLE },
          { address: project.vaultAddress, role: AccountRole.WRITABLE },
          {
            address: await deriveProjectContributionAddress(
              campaignAddress,
              wallet,
            ),
            role: AccountRole.WRITABLE,
          },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
      ),
    };
  }

  async closeProject(campaignAddress: string): Promise<{ signature: string }> {
    const wallet = this.requireWallet();
    await this.requireV2();
    const project = await this.ledger.readProject(campaignAddress);
    if (wallet !== project.creatorAddress)
      throw new Error("Only the project creator can close this project.");
    if (project.closed) throw new Error("This project is already closed.");
    const accounts = project.legacy
      ? [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: campaignAddress, role: AccountRole.WRITABLE },
          { address: project.vaultAddress, role: AccountRole.READONLY },
          {
            address: await deriveLegacyClosureAddress(campaignAddress),
            role: AccountRole.WRITABLE,
          },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ]
      : [
          { address: wallet, role: AccountRole.READONLY_SIGNER },
          { address: campaignAddress, role: AccountRole.WRITABLE },
        ];
    return {
      signature: await this.send(
        wallet,
        Uint8Array.from(
          project.legacy
            ? PROJECT_INSTRUCTIONS.legacyClose
            : PROJECT_INSTRUCTIONS.close,
        ),
        accounts,
      ),
    };
  }

  async refund(
    campaignAddress: string,
    backerAddress: string,
  ): Promise<{ signature: string }> {
    address(backerAddress);
    const wallet = this.requireWallet();
    await this.requireV2();
    const project = await this.ledger.readProject(campaignAddress);
    if (!project.closed)
      throw new Error("Close the project before refunding contributions.");
    if (wallet !== project.creatorAddress && wallet !== backerAddress)
      throw new Error(
        "Only the creator or this contribution's backer can request its refund.",
      );
    const backer = await this.ledger.readMyContribution(
      campaignAddress,
      backerAddress,
    );
    if (!backer || BigInt(backer.refundableLamports) === 0n)
      throw new Error("This contribution has no remaining funds to refund.");
    const accounts = project.legacy
      ? [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: campaignAddress, role: AccountRole.READONLY },
          { address: project.vaultAddress, role: AccountRole.WRITABLE },
          {
            address: await deriveContributionAddress(
              campaignAddress,
              backerAddress,
            ),
            role: AccountRole.READONLY,
          },
          {
            address: await deriveLegacyClosureAddress(campaignAddress),
            role: AccountRole.WRITABLE,
          },
          {
            address: await deriveLegacyReceiptAddress(
              campaignAddress,
              backerAddress,
            ),
            role: AccountRole.WRITABLE,
          },
          { address: backerAddress, role: AccountRole.WRITABLE },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ]
      : [
          { address: wallet, role: AccountRole.READONLY_SIGNER },
          { address: campaignAddress, role: AccountRole.WRITABLE },
          { address: project.vaultAddress, role: AccountRole.WRITABLE },
          { address: backer.contributionAddress, role: AccountRole.WRITABLE },
          { address: backerAddress, role: AccountRole.WRITABLE },
        ];
    return {
      signature: await this.send(
        wallet,
        Uint8Array.from(
          project.legacy
            ? PROJECT_INSTRUCTIONS.legacyRefund
            : PROJECT_INSTRUCTIONS.refund,
        ),
        accounts,
      ),
    };
  }

  async postMessage(
    campaignAddress: string,
    body: string,
  ): Promise<{ signature: string }> {
    const encoded = encodeString(body, PROJECT_LIMITS.message, "Message", true);
    const wallet = this.requireWallet();
    await this.requireV2();
    const project = await this.ledger.readProject(campaignAddress);
    if (project.closed)
      throw new Error("This project's chat is archived after closure.");
    if (wallet !== project.creatorAddress) {
      const backer = await this.ledger.readMyContribution(
        campaignAddress,
        wallet,
      );
      if (!backer || BigInt(backer.totalContributedLamports) === 0n)
        throw new Error(
          "Only the creator and project backers can post messages.",
        );
    }
    const accounts = project.legacy
      ? [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: campaignAddress, role: AccountRole.READONLY },
          {
            address: await deriveContributionAddress(campaignAddress, wallet),
            role: AccountRole.READONLY,
          },
          {
            address: await deriveLegacyDiscussionAddress(campaignAddress),
            role: AccountRole.WRITABLE,
          },
          {
            address: await deriveProjectMessageAddress(
              campaignAddress,
              project.messageCount,
            ),
            role: AccountRole.WRITABLE,
          },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ]
      : [
          { address: wallet, role: AccountRole.WRITABLE_SIGNER },
          { address: campaignAddress, role: AccountRole.WRITABLE },
          {
            address: await deriveProjectContributionAddress(
              campaignAddress,
              wallet,
            ),
            role: AccountRole.READONLY,
          },
          {
            address: await deriveProjectMessageAddress(
              campaignAddress,
              project.messageCount,
            ),
            role: AccountRole.WRITABLE,
          },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ];
    return {
      signature: await this.send(
        wallet,
        concat(
          project.legacy
            ? PROJECT_INSTRUCTIONS.legacyMessage
            : PROJECT_INSTRUCTIONS.message,
          encodeProjectU64(project.messageCount),
          encoded,
        ),
        accounts,
      ),
    };
  }
}
