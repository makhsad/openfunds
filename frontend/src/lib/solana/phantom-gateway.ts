import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransactionMessage,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageEncoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";
import type { SolanaCampaignGateway } from "./campaign-boundary";

export const OPENFUNDS_PROGRAM_ADDRESS =
  "6NTwPcQMGArcmjStAfica2toF3qqwSD1nsEw2qc1RRHA";
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_PROXY_PATH = "/api/solana/devnet";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const U64_MAX = (1n << 64n) - 1n;

export const ANCHOR_DISCRIMINATORS = Object.freeze({
  initializeCampaign: Object.freeze([169, 88, 7, 6, 9, 165, 65, 132]),
  contribute: Object.freeze([82, 33, 68, 131, 32, 0, 205, 95]),
  campaign: Object.freeze([50, 40, 49, 11, 157, 220, 229, 192]),
  vault: Object.freeze([211, 8, 232, 43, 2, 152, 117, 119]),
  contribution: Object.freeze([182, 187, 14, 111, 72, 167, 242, 212]),
});

interface PhantomPublicKey {
  toString(): string;
}

export interface PhantomProvider {
  readonly isPhantom: boolean;
  readonly isConnected?: boolean;
  readonly publicKey: PhantomPublicKey | null;
  connect(): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  request(request: {
    method: "signAndSendTransaction";
    params: {
      message: string;
      options: { preflightCommitment: "confirmed"; skipPreflight: false };
    };
  }): Promise<unknown>;
  on?(
    event: "accountChanged" | "disconnect",
    listener: (publicKey?: PhantomPublicKey | null) => void,
  ): void;
  removeListener?(
    event: "accountChanged" | "disconnect",
    listener: (publicKey?: PhantomPublicKey | null) => void,
  ): void;
}

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window as unknown as { phantom?: { solana?: PhantomProvider } }
  ).phantom?.solana;
  return candidate?.isPhantom === true ? candidate : null;
}

export type DevnetRpcMethod =
  | "getGenesisHash"
  | "getAccountInfo"
  | "getMultipleAccounts"
  | "getBalance"
  | "getLatestBlockhash"
  | "getSignatureStatuses"
  | "getBlockHeight";

export interface DevnetRpcTransport {
  call<T>(method: DevnetRpcMethod, params: readonly unknown[]): Promise<T>;
}

/** Kit preserves RPC integer precision; the proxy forwards raw response text. */
export function createDevnetRpcTransport(): DevnetRpcTransport {
  if (typeof window === "undefined")
    throw new Error("The Devnet connection is available in the browser.");
  const rpc = createSolanaRpc(
    new URL(DEVNET_PROXY_PATH, window.location.origin).href,
  );
  const methods = rpc as unknown as Record<
    DevnetRpcMethod,
    (...args: readonly unknown[]) => {
      send(config: { abortSignal: AbortSignal }): Promise<unknown>;
    }
  >;
  return {
    async call<T>(method: DevnetRpcMethod, params: readonly unknown[]) {
      return (await methods[method](...params).send({
        abortSignal: AbortSignal.timeout(15_000),
      })) as T;
    },
  };
}

export interface RpcAccount {
  owner: string;
  executable: boolean;
  lamports: bigint | number;
  data: readonly [string, "base64"];
}

export interface CampaignChainState {
  campaignAddress: string;
  creatorAddress: string;
  vaultAddress: string;
  contributionAddress: string | null;
  totalContributedLamports: string;
  vaultBalanceLamports: string;
  contributionLamports: string;
}

export interface ProgramReadiness {
  programAddress: string;
  deployed: boolean;
  reason: string | null;
}

export class CampaignNotInitializedError extends Error {
  constructor() {
    super("Campaign is not initialized on Devnet. Create it first.");
    this.name = "CampaignNotInitializedError";
  }
}

export function isCampaignMissing(error: unknown): boolean {
  return error instanceof CampaignNotInitializedError;
}

export class TransactionConfirmationError extends Error {
  constructor(
    message: string,
    public readonly signature: string,
    public readonly state: "pending" | "failed",
  ) {
    super(message);
    this.name = "TransactionConfirmationError";
  }
}

export function parseContributionLamports(value: string): bigint {
  if (!/^[0-9]+$/.test(value))
    throw new Error("Enter a whole number of lamports.");
  const amount = BigInt(value);
  if (amount <= 0n || amount > U64_MAX)
    throw new Error("Contribution must be greater than zero and fit in u64.");
  return amount;
}

function rpcInteger(value: bigint | number, label: string): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new Error(`Invalid ${label} returned by Devnet.`);
  if (typeof value !== "bigint" && typeof value !== "number")
    throw new Error(`Invalid ${label} returned by Devnet.`);
  const result = BigInt(value);
  if (result < 0n) throw new Error(`Invalid ${label} returned by Devnet.`);
  return result;
}

function accountData(account: RpcAccount): Uint8Array {
  if (
    !Array.isArray(account.data) ||
    account.data[1] !== "base64" ||
    typeof account.data[0] !== "string"
  )
    throw new Error("Devnet returned unsupported account data.");
  return new Uint8Array(getBase64Encoder().encode(account.data[0]));
}

function checkedAccount(
  account: RpcAccount | null,
  name: "campaign" | "vault" | "contribution",
  size: number,
): Uint8Array {
  if (!account) throw new Error(`The ${name} account is missing on Devnet.`);
  if (account.owner !== OPENFUNDS_PROGRAM_ADDRESS || account.executable)
    throw new Error(`The ${name} account is not owned by OpenFunds.`);
  const data = accountData(account);
  if (
    data.length !== size ||
    !ANCHOR_DISCRIMINATORS[name].every((value, index) => data[index] === value)
  )
    throw new Error(`The ${name} account has an invalid Anchor layout.`);
  return data;
}

function u64At(data: Uint8Array, offset: number): bigint {
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}

async function derivePda(label: string, ...keys: string[]): Promise<string> {
  return (
    await getProgramDerivedAddress({
      programAddress: address(OPENFUNDS_PROGRAM_ADDRESS),
      seeds: [
        new TextEncoder().encode(label),
        ...keys.map((key) => getAddressEncoder().encode(address(key))),
      ],
    })
  )[0];
}

export async function deriveCampaignAddresses(creatorAddress: string): Promise<{
  campaignAddress: string;
  vaultAddress: string;
}> {
  const campaignAddress = await derivePda("campaign", creatorAddress);
  return {
    campaignAddress,
    vaultAddress: await derivePda("vault", campaignAddress),
  };
}

export async function deriveContributionAddress(
  campaignAddress: string,
  backerAddress: string,
): Promise<string> {
  return derivePda("contribution", campaignAddress, backerAddress);
}

function instruction(
  signerAddress: string,
  accounts: string[],
  amount?: bigint,
): Instruction {
  const data = new Uint8Array(amount === undefined ? 8 : 16);
  data.set(
    amount === undefined
      ? ANCHOR_DISCRIMINATORS.initializeCampaign
      : ANCHOR_DISCRIMINATORS.contribute,
  );
  if (amount !== undefined)
    new DataView(data.buffer).setBigUint64(8, amount, true);
  return {
    programAddress: address(OPENFUNDS_PROGRAM_ADDRESS),
    accounts: [
      { address: address(signerAddress), role: AccountRole.WRITABLE_SIGNER },
      ...accounts.map((key) => ({
        address: address(key),
        role: AccountRole.WRITABLE,
      })),
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
    ],
    data,
  };
}

export class PhantomCampaignGateway implements SolanaCampaignGateway {
  readonly programAddress = OPENFUNDS_PROGRAM_ADDRESS;
  private readonly provider: PhantomProvider | null;
  private readonly rpc: DevnetRpcTransport;
  private readonly confirmationTimeoutMs: number;
  private walletAddress: string | null;
  private readonly listeners = new Set<(address: string | null) => void>();
  private sending = false;

  constructor(
    options: {
      provider?: PhantomProvider | null;
      rpc?: DevnetRpcTransport;
      confirmationTimeoutMs?: number;
    } = {},
  ) {
    this.provider = options.provider ?? getPhantomProvider();
    this.rpc = options.rpc ?? createDevnetRpcTransport();
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 60_000;
    this.walletAddress =
      this.provider?.isConnected && this.provider.publicKey
        ? address(this.provider.publicKey.toString())
        : null;
  }

  get connectedAddress(): string | null {
    return this.walletAddress;
  }

  async connect(): Promise<string> {
    if (!this.provider?.isPhantom)
      throw new Error("Install the Phantom browser extension to connect.");
    const result = await this.provider.connect();
    const publicAddress = address(result.publicKey.toString());
    this.updateWallet(publicAddress);
    return publicAddress;
  }

  async disconnect(): Promise<void> {
    await this.provider?.disconnect();
    this.updateWallet(null);
  }

  onWalletChange(listener: (address: string | null) => void): () => void {
    this.listeners.add(listener);
    const changed = (key?: PhantomPublicKey | null) => {
      this.updateWallet(key ? address(key.toString()) : null);
    };
    const disconnected = () => this.updateWallet(null);
    this.provider?.on?.("accountChanged", changed);
    this.provider?.on?.("disconnect", disconnected);
    return () => {
      this.listeners.delete(listener);
      this.provider?.removeListener?.("accountChanged", changed);
      this.provider?.removeListener?.("disconnect", disconnected);
    };
  }

  private updateWallet(publicAddress: string | null): void {
    this.walletAddress = publicAddress;
    this.listeners.forEach((listener) => listener(publicAddress));
  }

  private requireWallet(): string {
    if (
      !this.provider?.isPhantom ||
      !this.walletAddress ||
      this.provider.isConnected === false ||
      this.provider.publicKey?.toString() !== this.walletAddress
    )
      throw new Error("Connect Phantom before using this action.");
    return this.walletAddress;
  }

  private async requireDevnet(): Promise<void> {
    if (
      (await this.rpc.call<string>("getGenesisHash", [])) !==
      DEVNET_GENESIS_HASH
    )
      throw new Error(
        "The connection is not Solana Devnet. No transaction was sent.",
      );
  }

  async inspectProgram(): Promise<ProgramReadiness> {
    await this.requireDevnet();
    const { value: program } = await this.rpc.call<{
      value: RpcAccount | null;
    }>("getAccountInfo", [
      this.programAddress,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    const unavailable = (reason: string): ProgramReadiness => ({
      programAddress: this.programAddress,
      deployed: false,
      reason,
    });
    if (!program)
      return unavailable("OpenFunds has not been deployed to Devnet yet.");
    if (!program.executable || program.owner !== UPGRADEABLE_LOADER)
      return unavailable("OpenFunds is not an executable loader-v3 program.");
    const data = accountData(program);
    if (
      data.length !== 36 ||
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
        0,
        true,
      ) !== 2
    )
      return unavailable("The OpenFunds program has an invalid loader layout.");
    const programDataAddress = getAddressDecoder().decode(data.subarray(4, 36));
    const expectedProgramData = (
      await getProgramDerivedAddress({
        programAddress: address(UPGRADEABLE_LOADER),
        seeds: [getAddressEncoder().encode(address(this.programAddress))],
      })
    )[0];
    if (programDataAddress !== expectedProgramData)
      return unavailable(
        "The program points to an unexpected ProgramData account.",
      );
    const { value: programData } = await this.rpc.call<{
      value: RpcAccount | null;
    }>("getAccountInfo", [
      programDataAddress,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (
      !programData ||
      programData.owner !== UPGRADEABLE_LOADER ||
      programData.executable
    )
      return unavailable(
        "The OpenFunds ProgramData account is missing or invalid.",
      );
    const code = accountData(programData);
    if (
      code.length < 49 ||
      new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(
        0,
        true,
      ) !== 3 ||
      code[12] > 1 ||
      code[45] !== 0x7f ||
      code[46] !== 0x45 ||
      code[47] !== 0x4c ||
      code[48] !== 0x46
    )
      return unavailable(
        "The OpenFunds ProgramData account contains no valid ELF program.",
      );
    return {
      programAddress: this.programAddress,
      deployed: true,
      reason: null,
    };
  }

  async readWalletBalance(): Promise<string> {
    const wallet = this.requireWallet();
    await this.requireDevnet();
    const result = await this.rpc.call<{ value: bigint | number }>(
      "getBalance",
      [wallet, { commitment: "confirmed" }],
    );
    return rpcInteger(result.value, "wallet balance").toString();
  }

  deriveCampaignAddresses(creatorAddress: string) {
    return deriveCampaignAddresses(creatorAddress);
  }

  async readCampaign(campaignAddress: string): Promise<CampaignChainState> {
    address(campaignAddress);
    await this.requireDevnet();
    const { value: firstCampaign } = await this.rpc.call<{
      value: RpcAccount | null;
    }>("getAccountInfo", [
      campaignAddress,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (!firstCampaign) throw new CampaignNotInitializedError();
    const firstData = checkedAccount(firstCampaign, "campaign", 48);
    const creatorAddress = getAddressDecoder().decode(
      firstData.subarray(8, 40),
    );
    const derived = await deriveCampaignAddresses(creatorAddress);
    if (campaignAddress !== derived.campaignAddress)
      throw new Error("Campaign address does not match its creator PDA.");
    const backer = this.connectedAddress;
    const contributionAddress = backer
      ? await deriveContributionAddress(campaignAddress, backer)
      : null;
    const keys = [campaignAddress, derived.vaultAddress];
    if (contributionAddress) keys.push(contributionAddress);
    const { value: accounts } = await this.rpc.call<{
      value: (RpcAccount | null)[];
    }>("getMultipleAccounts", [
      keys,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (!accounts[0]) throw new CampaignNotInitializedError();
    const campaignData = checkedAccount(accounts[0], "campaign", 48);
    if (
      getAddressDecoder().decode(campaignData.subarray(8, 40)) !==
      creatorAddress
    )
      throw new Error("Campaign creator changed between Devnet reads.");
    checkedAccount(accounts[1], "vault", 8);
    let contribution = 0n;
    if (contributionAddress && accounts[2]) {
      const contributionData = checkedAccount(accounts[2], "contribution", 80);
      if (
        getAddressDecoder().decode(contributionData.subarray(8, 40)) !==
          campaignAddress ||
        getAddressDecoder().decode(contributionData.subarray(40, 72)) !== backer
      )
        throw new Error(
          "Contribution identities do not match this campaign and wallet.",
        );
      contribution = u64At(contributionData, 72);
    }
    return {
      campaignAddress,
      creatorAddress,
      vaultAddress: derived.vaultAddress,
      contributionAddress,
      totalContributedLamports: u64At(campaignData, 40).toString(),
      vaultBalanceLamports: rpcInteger(
        accounts[1]!.lamports,
        "vault balance",
      ).toString(),
      contributionLamports: contribution.toString(),
    };
  }

  async initializeCampaign(): Promise<{
    campaignAddress: string;
    signature: string;
  }> {
    return this.mutate(async (wallet) => {
      const readiness = await this.inspectProgram();
      if (!readiness.deployed) throw new Error(readiness.reason!);
      const { campaignAddress, vaultAddress } =
        await deriveCampaignAddresses(wallet);
      const existing = await this.rpc.call<{ value: RpcAccount | null }>(
        "getAccountInfo",
        [campaignAddress, { encoding: "base64", commitment: "confirmed" }],
      );
      if (existing.value)
        throw new Error(
          "This wallet already has a campaign. Duplicate initialization is not allowed.",
        );
      const signature = await this.send(
        instruction(wallet, [campaignAddress, vaultAddress]),
        wallet,
      );
      return { campaignAddress, signature };
    });
  }

  async contribute(
    campaignAddress: string,
    amountLamports: string,
  ): Promise<{ signature: string }> {
    const amount = parseContributionLamports(amountLamports);
    return this.mutate(async (wallet) => {
      const readiness = await this.inspectProgram();
      if (!readiness.deployed) throw new Error(readiness.reason!);
      const current = await this.readCampaign(campaignAddress);
      if (
        BigInt(current.totalContributedLamports) + amount > U64_MAX ||
        BigInt(current.contributionLamports) + amount > U64_MAX
      )
        throw new Error("Contribution would overflow an on-chain u64 total.");
      const contributionAddress = await deriveContributionAddress(
        campaignAddress,
        wallet,
      );
      return {
        signature: await this.send(
          instruction(
            wallet,
            [campaignAddress, current.vaultAddress, contributionAddress],
            amount,
          ),
          wallet,
        ),
      };
    });
  }

  private async mutate<T>(action: (wallet: string) => Promise<T>): Promise<T> {
    if (this.sending)
      throw new Error("A Phantom transaction is already in progress.");
    const wallet = this.requireWallet();
    this.sending = true;
    try {
      return await action(wallet);
    } finally {
      this.sending = false;
    }
  }

  private async send(ix: Instruction, wallet: string): Promise<string> {
    if (this.requireWallet() !== wallet)
      throw new Error(
        "Phantom account changed. Review the new wallet and try again.",
      );
    const { value: lifetime } = await this.rpc.call<{
      value: { blockhash: string; lastValidBlockHeight: bigint | number };
    }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const lastValidBlockHeight = rpcInteger(
      lifetime.lastValidBlockHeight,
      "block height",
    );
    const message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayer(address(wallet), m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash(lifetime.blockhash), lastValidBlockHeight },
          m,
        ),
      (m) => appendTransactionMessageInstruction(ix, m),
    );
    const serializedMessage = getBase58Decoder().decode(
      getCompiledTransactionMessageEncoder().encode(
        compileTransactionMessage(message),
      ),
    );
    if (this.requireWallet() !== wallet)
      throw new Error(
        "Phantom account changed. Review the new wallet and try again.",
      );
    const result = await this.provider!.request({
      method: "signAndSendTransaction",
      params: {
        message: serializedMessage,
        options: { preflightCommitment: "confirmed", skipPreflight: false },
      },
    });
    const signed = result as { signature?: unknown } | null;
    if (
      !signed ||
      typeof signed.signature !== "string" ||
      getBase58Encoder().encode(signed.signature).length !== 64
    )
      throw new Error("Phantom returned an invalid transaction signature.");
    await this.confirm(signed.signature, lastValidBlockHeight);
    return signed.signature;
  }

  private async confirm(
    signature: string,
    lastValidBlockHeight: bigint,
  ): Promise<void> {
    const deadline = Date.now() + this.confirmationTimeoutMs;
    do {
      try {
        const { value: statuses } = await this.rpc.call<{
          value: ({
            err: unknown;
            confirmationStatus: "processed" | "confirmed" | "finalized" | null;
          } | null)[];
        }>("getSignatureStatuses", [
          [signature],
          { searchTransactionHistory: true },
        ]);
        const status = statuses[0];
        if (status?.err)
          throw new TransactionConfirmationError(
            `Devnet rejected the transaction: ${JSON.stringify(
              status.err,
              (_, value) =>
                typeof value === "bigint" ? value.toString() : value,
            )}`,
            signature,
            "failed",
          );
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        )
          return;
        const height = await this.rpc.call<bigint | number>("getBlockHeight", [
          { commitment: "confirmed" },
        ]);
        if (rpcInteger(height, "block height") > lastValidBlockHeight)
          throw new TransactionConfirmationError(
            "Transaction was not confirmed before its blockhash expired. Check Explorer before retrying.",
            signature,
            "pending",
          );
      } catch (error) {
        if (error instanceof TransactionConfirmationError) throw error;
        throw new TransactionConfirmationError(
          "Transaction was submitted, but Devnet confirmation could not be read. Check Explorer before retrying.",
          signature,
          "pending",
        );
      }
      if (Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 750));
    } while (Date.now() < deadline);
    throw new TransactionConfirmationError(
      "Transaction confirmation timed out. Check Explorer before retrying.",
      signature,
      "pending",
    );
  }
}
