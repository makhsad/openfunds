"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CampaignLedger } from "./campaign-ledger";
import {
  DevnetLedger,
  type DevnetActivity,
  type DevnetSupport,
} from "@/lib/solana/devnet-ledger";
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Spinner } from "@/components/ui";
import { formatSol, parseSol } from "@/lib/amounts";
import {
  OPENFUNDS_PROGRAM_ADDRESS,
  PhantomCampaignGateway,
  TransactionConfirmationError,
  TransactionStageError,
  getPhantomProvider,
  createDevnetRpcTransport,
  isCampaignMissing,
  type CampaignChainState,
} from "@/lib/solana/phantom-gateway";

type ProgramInspection = Awaited<
  ReturnType<PhantomCampaignGateway["inspectProgram"]>
>;
type Addresses = Awaited<
  ReturnType<PhantomCampaignGateway["deriveCampaignAddresses"]>
>;
type Receipt = {
  signature: string;
  action: "Create campaign" | "Contribute";
  wallet: string;
  state: "confirmed" | "pending" | "failed";
  campaignAddress: string;
};
type ContributionChanges = {
  vault: string;
  campaign: string;
  contribution: string;
  expected: string;
};

function explorerUrl(value: string, transaction = false) {
  return `https://explorer.solana.com/${transaction ? "tx" : "address"}/${encodeURIComponent(value)}?cluster=devnet`;
}

function AddressLink({ value }: { value: string }) {
  return (
    <a
      className="chain-address"
      href={explorerUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{value}</span>
      <ExternalLink size={13} aria-hidden="true" />
      <span className="sr-only">View address in Solana Explorer on Devnet</span>
    </a>
  );
}

function formatChange(value: string) {
  const amount = BigInt(value);
  return amount < 0n ? `-${formatSol((-amount).toString())}` : formatSol(value);
}

function errorMessage(cause: unknown) {
  if (cause instanceof TransactionStageError) {
    if (cause.stage === "preparation")
      return `Could not prepare the Devnet transaction. ${cause.message}`;
    if (cause.cancelled)
      return "Transaction approval was cancelled in Phantom.";
    return `Phantom could not complete this transaction. ${cause.message} Check Phantom activity before trying again.`;
  }
  return cause instanceof Error
    ? cause.message
    : "The operation could not finish. Try refreshing the chain state.";
}

export function SolanaTest({
  initialCreator = "",
  projectView = false,
  createView = false,
}: {
  initialCreator?: string;
  projectView?: boolean;
  createView?: boolean;
} = {}) {
  const gatewayRef = useRef<PhantomCampaignGateway | null>(null);
  const ledgerRef = useRef<DevnetLedger | null>(null);
  const mountedRef = useRef(false);
  const operationRef = useRef(false);
  const readEpochRef = useRef(0);
  const creatorRef = useRef("");
  const [hasPhantom, setHasPhantom] = useState<boolean | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [program, setProgram] = useState<ProgramInspection | null>(null);
  const [programCheckFailed, setProgramCheckFailed] = useState(false);
  const [creatorInput, setCreatorInput] = useState(initialCreator);
  const [selectedCreator, setSelectedCreator] = useState("");
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [campaign, setCampaign] = useState<CampaignChainState | null>(null);
  const [campaignMissing, setCampaignMissing] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [changes, setChanges] = useState<ContributionChanges | null>(null);
  const [backers, setBackers] = useState<DevnetSupport[] | null>(null);
  const [backersError, setBackersError] = useState<string | null>(null);
  const [activity, setActivity] = useState<DevnetActivity[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [hasMoreActivity, setHasMoreActivity] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [walletReadError, setWalletReadError] = useState<string | null>(null);

  const loadChain = useCallback(async (creatorAddress: string) => {
    const gateway = gatewayRef.current;
    if (!gateway) return null;
    const epoch = ++readEpochRef.current;
    const readingWallet = gateway.connectedAddress;
    const isCurrent = () =>
      mountedRef.current &&
      epoch === readEpochRef.current &&
      gateway.connectedAddress === readingWallet;
    setProgram(null);
    setProgramCheckFailed(false);
    let programChecked = false;
    setCampaign(null);
    setCampaignMissing(false);
    setAddresses(null);
    setChanges(null);
    setWalletBalance(null);
    setWalletReadError(null);
    setBackers(null);
    setBackersError(null);
    setActivity(null);
    setActivityError(null);
    setHistoryCursor(null);
    setHasMoreActivity(false);
    setLoadingActivity(false);
    try {
      const inspection = await gateway.inspectProgram();
      if (!isCurrent()) return null;
      setProgram(inspection);
      programChecked = true;
      if (readingWallet) {
        try {
          const balance = await gateway.readWalletBalance();
          if (!isCurrent()) return null;
          setWalletBalance(balance);
        } catch (cause) {
          if (isCurrent()) setWalletReadError(errorMessage(cause));
        }
      }
      if (!creatorAddress.trim()) {
        setSelectedCreator("");
        creatorRef.current = "";
        return null;
      }
      const derived = await gateway.deriveCampaignAddresses(
        creatorAddress.trim(),
      );
      if (!isCurrent()) return null;
      setSelectedCreator(creatorAddress.trim());
      creatorRef.current = creatorAddress.trim();
      setAddresses(derived);
      if (!inspection.deployed) return null;
      try {
        const state = await gateway.readCampaign(derived.campaignAddress);
        if (!isCurrent()) return null;
        setCampaign(state);
        const ledger = ledgerRef.current;
        if (ledger) {
          setLoadingActivity(true);
          const [backerResult, activityResult] = await Promise.allSettled([
            ledger.readBackers(state.campaignAddress),
            ledger.readActivity(state.campaignAddress),
          ]);
          if (!isCurrent()) return null;
          if (backerResult.status === "fulfilled")
            setBackers(backerResult.value);
          else setBackersError(errorMessage(backerResult.reason));
          if (activityResult.status === "fulfilled") {
            setActivity(activityResult.value.items);
            setHistoryCursor(activityResult.value.nextBefore);
            setHasMoreActivity(activityResult.value.hasMore);
          } else setActivityError(errorMessage(activityResult.reason));
          setLoadingActivity(false);
        }
        return state;
      } catch (cause) {
        if (!isCurrent()) return null;
        if (isCampaignMissing(cause)) {
          setCampaignMissing(true);
          return null;
        }
        throw cause;
      }
    } catch (cause) {
      if (isCurrent()) {
        if (!programChecked) setProgramCheckFailed(true);
        setError(errorMessage(cause));
      }
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const provider = getPhantomProvider();
    setHasPhantom(Boolean(provider));
    const rpc = createDevnetRpcTransport();
    const gateway = new PhantomCampaignGateway({
      provider: provider ?? undefined,
      rpc,
    });
    ledgerRef.current = new DevnetLedger(rpc);
    gatewayRef.current = gateway;
    const connectedAddress = gateway.connectedAddress;
    setWalletAddress(connectedAddress);
    const firstCreator = initialCreator || connectedAddress || "";
    setCreatorInput(firstCreator);
    const unsubscribe = gateway.onWalletChange((address) => {
      readEpochRef.current += 1;
      setWalletAddress(address);
      setWalletBalance(null);
      setCampaign(null);
      setCampaignMissing(false);
      setChanges(null);
      if (!operationRef.current) {
        setError(null);
        setNotice(
          address
            ? "Wallet changed. Reading its contribution to the selected campaign."
            : "Phantom disconnected.",
        );
        const creator = initialCreator || creatorRef.current || address || "";
        setCreatorInput(creator);
        void loadChain(creator);
      }
    });
    void loadChain(firstCreator);
    return () => {
      mountedRef.current = false;
      readEpochRef.current += 1;
      unsubscribe();
      gatewayRef.current = null;
      ledgerRef.current = null;
    };
  }, [loadChain, initialCreator]);

  async function perform(
    label: string,
    action: (gateway: PhantomCampaignGateway) => Promise<void>,
    receiptAction?: Receipt["action"],
  ) {
    const gateway = gatewayRef.current;
    if (!gateway || operationRef.current) return;
    const operationWallet = gateway.connectedAddress;
    const operationCampaign = addresses?.campaignAddress;
    operationRef.current = true;
    setBusy(label);
    setError(null);
    setNotice(null);
    setChanges(null);
    try {
      await action(gateway);
    } catch (cause) {
      if (mountedRef.current) {
        setError(errorMessage(cause));
        if (
          cause instanceof TransactionConfirmationError &&
          receiptAction &&
          operationWallet
        ) {
          const receiptCampaign =
            receiptAction === "Create campaign"
              ? (await gateway.deriveCampaignAddresses(operationWallet))
                  .campaignAddress
              : (operationCampaign ?? "");
          setReceipts((previous) => [
            {
              signature: cause.signature,
              action: receiptAction,
              wallet: operationWallet,
              state: cause.state,
              campaignAddress: receiptCampaign,
            },
            ...previous,
          ]);
          setCampaign(null);
          setWalletBalance(null);
          setNotice(null);
        }
      }
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  function connect() {
    void perform("Connecting to Phantom…", async (gateway) => {
      const connected = await gateway.connect();
      if (!mountedRef.current) return;
      setWalletAddress(connected);
      const creator = creatorRef.current || connected;
      setCreatorInput(creator);
      await loadChain(creator);
      if (mountedRef.current)
        setNotice(
          "Phantom connected. Balances and campaign totals below come from Solana Devnet.",
        );
    });
  }

  function disconnect() {
    void perform("Disconnecting…", async (gateway) => {
      await gateway.disconnect();
      if (!mountedRef.current) return;
      setWalletAddress(null);
      setWalletBalance(null);
      setCampaign(null);
      setChanges(null);
      setNotice(
        "Phantom disconnected. You can still view a campaign using its creator's public address.",
      );
      await loadChain(creatorRef.current);
    });
  }

  function refresh() {
    void perform("Reading Solana Devnet…", async () => {
      await loadChain(creatorRef.current);
    });
  }

  function viewCampaign(event: React.FormEvent) {
    event.preventDefault();
    void perform("Reading campaign…", async () => {
      if (!creatorInput.trim())
        throw new Error("Enter the creator's public Solana address.");
      await loadChain(creatorInput);
    });
  }

  function createCampaign() {
    void perform(
      "Confirm campaign creation in Phantom…",
      async (gateway) => {
        const signingWallet = gateway.connectedAddress;
        if (!signingWallet) throw new Error("Connect Phantom first.");
        const result = await gateway.initializeCampaign();
        if (!mountedRef.current) return;
        setReceipts((previous) => [
          {
            signature: result.signature,
            action: "Create campaign",
            wallet: signingWallet,
            state: "confirmed",
            campaignAddress: result.campaignAddress,
          },
          ...previous,
        ]);
        setNotice("Campaign creation confirmed on Solana Devnet.");
        if (gateway.connectedAddress !== signingWallet) {
          setError(
            "The transaction was confirmed, but the wallet changed. Refresh to view the currently selected account.",
          );
          return;
        }
        setCreatorInput(signingWallet);
        await loadChain(signingWallet);
      },
      "Create campaign",
    );
  }

  function contribute(event: React.FormEvent) {
    event.preventDefault();
    void perform(
      "Confirm your contribution in Phantom…",
      async (gateway) => {
        const signingWallet = gateway.connectedAddress;
        if (!signingWallet) throw new Error("Connect Phantom first.");
        if (!campaign || !addresses)
          throw new Error("Load an initialized campaign before contributing.");
        const lamports = parseSol(amount);
        if (BigInt(lamports) > 18_446_744_073_709_551_615n)
          throw new Error(
            "This amount exceeds the program's maximum contribution.",
          );
        const creator = selectedCreator;
        const campaignAddress = addresses.campaignAddress;
        const before = await gateway.readCampaign(campaignAddress);
        if (gateway.connectedAddress !== signingWallet)
          throw new Error(
            "The wallet changed before signing. Refresh the campaign and try again.",
          );
        const result = await gateway.contribute(campaignAddress, lamports);
        if (!mountedRef.current) return;
        setReceipts((previous) => [
          {
            signature: result.signature,
            action: "Contribute",
            wallet: signingWallet,
            state: "confirmed",
            campaignAddress,
          },
          ...previous,
        ]);
        setNotice(
          `Contribution of ${formatSol(lamports)} SOL confirmed on Solana Devnet.`,
        );
        if (gateway.connectedAddress !== signingWallet) {
          setError(
            "The contribution was confirmed, but the wallet changed. Refresh to view the currently selected account.",
          );
          return;
        }
        const after = await loadChain(creator);
        if (
          after &&
          gateway.connectedAddress === signingWallet &&
          mountedRef.current
        ) {
          setChanges({
            expected: lamports,
            vault: (
              BigInt(after.vaultBalanceLamports) -
              BigInt(before.vaultBalanceLamports)
            ).toString(),
            campaign: (
              BigInt(after.totalContributedLamports) -
              BigInt(before.totalContributedLamports)
            ).toString(),
            contribution: (
              BigInt(after.contributionLamports) -
              BigInt(before.contributionLamports)
            ).toString(),
          });
        }
      },
      "Contribute",
    );
  }

  async function loadOlderActivity() {
    const ledger = ledgerRef.current;
    const currentCampaign = campaign?.campaignAddress;
    if (
      !ledger ||
      !currentCampaign ||
      !historyCursor ||
      loadingActivity ||
      operationRef.current
    )
      return;
    const epoch = readEpochRef.current;
    setLoadingActivity(true);
    setActivityError(null);
    try {
      const page = await ledger.readActivity(currentCampaign, {
        before: historyCursor,
      });
      if (!mountedRef.current || epoch !== readEpochRef.current) return;
      setActivity((previous) => [
        ...new Map(
          [...(previous ?? []), ...page.items].map((item) => [
            item.signature,
            item,
          ]),
        ).values(),
      ]);
      setHistoryCursor(page.nextBefore);
      setHasMoreActivity(page.hasMore);
    } catch (cause) {
      if (mountedRef.current && epoch === readEpochRef.current)
        setActivityError(errorMessage(cause));
    } finally {
      if (mountedRef.current && epoch === readEpochRef.current)
        setLoadingActivity(false);
    }
  }

  const visibleReceipts = receipts.filter(
    (receipt) =>
      !addresses || receipt.campaignAddress === addresses.campaignAddress,
  );
  const yourCampaignExists = Boolean(
    campaign && selectedCreator === walletAddress,
  );
  const canSign = Boolean(walletAddress && program?.deployed && !busy);
  const changesMatch =
    changes &&
    changes.vault === changes.expected &&
    changes.campaign === changes.expected &&
    changes.contribution === changes.expected;

  return (
    <div className="of-container of-page chain-page">
      <header className="chain-heading">
        <div>
          <span className="of-eyebrow">
            <ShieldCheck size={14} aria-hidden="true" /> Solana Devnet
          </span>
          <h1 className="of-page-title">
            {projectView
              ? "Campaign funding"
              : createView
                ? "Create your Devnet campaign"
                : "Test your OpenFunds campaign"}
          </h1>
          <p>
            {projectView
              ? "View the creator, sponsor contributions and confirmed movements for this shared campaign."
              : "Connect Phantom, create a campaign and send a test contribution to its program-controlled vault."}
          </p>
        </div>
        <span className="chain-network">Test SOL only</span>
      </header>

      <div className="chain-note">
        Choose <strong>Solana Devnet</strong> in Phantom before signing. This
        page always uses Devnet. Funds enter this campaign&apos;s vault. Sending
        SOL directly to the creator&apos;s personal wallet does not record a
        campaign contribution. Withdrawals are not implemented.
      </div>

      {(busy || error || notice) && (
        <div
          className={`chain-feedback ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {busy && <Spinner />}
          <span>{error ?? busy ?? notice}</span>
        </div>
      )}

      <section
        className="chain-panel chain-program"
        aria-labelledby="program-heading"
      >
        <div className="chain-panel-heading">
          <div>
            <h2 id="program-heading">Program status</h2>
            <p>
              {program
                ? program.deployed
                  ? "OpenFunds is deployed and executable on Devnet."
                  : "OpenFunds is not ready for transactions on Devnet."
                : programCheckFailed
                  ? "The Devnet connection could not be checked. Refresh to try again."
                  : "Checking the OpenFunds program on Devnet…"}
            </p>
          </div>
          <span className={`chain-status ${program?.deployed ? "ready" : ""}`}>
            {program
              ? program.deployed
                ? "Deployed"
                : "Not deployed"
              : programCheckFailed
                ? "Unavailable"
                : "Checking"}
          </span>
        </div>
        <AddressLink value={OPENFUNDS_PROGRAM_ADDRESS} />
        {program && !program.deployed && (
          <div className="chain-blocked">
            <strong>
              The program must be deployed before you can create or fund a
              campaign.
            </strong>
            <p>
              {program.reason ||
                "The program account is absent from Solana Devnet."}{" "}
              Wallet connection and balance checks remain available. Deployment
              needs the project owner&apos;s approval.
            </p>
          </div>
        )}
        <button
          type="button"
          className="of-button secondary small"
          onClick={refresh}
          disabled={Boolean(busy)}
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh chain state
        </button>
      </section>

      <div className="chain-grid">
        <section className="chain-panel" aria-labelledby="wallet-heading">
          <div className="chain-step">
            <span>1</span>
            <h2 id="wallet-heading">Connect your wallet</h2>
          </div>
          <p>
            {projectView
              ? "Connect your sponsor or creator wallet. This page stays on the same campaign when you switch accounts."
              : "Use your creator account to create a campaign. Sponsors open the creator's shared campaign link to contribute."}
          </p>
          {walletAddress ? (
            <>
              <div className="chain-wallet">
                <Wallet size={19} aria-hidden="true" />
                <strong>Phantom connected</strong>
              </div>
              <AddressLink value={walletAddress} />
              <dl className="chain-wallet-balance">
                <dt>Your Devnet balance</dt>
                <dd>
                  {walletBalance === null
                    ? "Refresh to check"
                    : `${formatSol(walletBalance)} SOL`}
                </dd>
              </dl>
              {walletReadError && (
                <p className="chain-helper" role="alert">
                  Wallet balance could not be read. {walletReadError}
                </p>
              )}
              <p className="chain-helper">
                {walletAddress === selectedCreator
                  ? "You are the creator of this campaign."
                  : "You are viewing this campaign as a sponsor. Your own campaign is separate."}
              </p>
              <button
                className="of-button secondary"
                type="button"
                onClick={disconnect}
                disabled={Boolean(busy)}
              >
                Disconnect Phantom
              </button>
            </>
          ) : (
            <>
              <button
                className="of-button"
                type="button"
                onClick={connect}
                disabled={hasPhantom !== true || Boolean(busy)}
              >
                <Wallet size={16} aria-hidden="true" /> Connect Phantom
              </button>
              {hasPhantom === false && (
                <p className="chain-helper">
                  Phantom was not found.{" "}
                  <a
                    className="of-text-link"
                    href="https://phantom.com/download"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Install Phantom
                  </a>
                  , then reload this page.
                </p>
              )}
              {hasPhantom === null && (
                <p className="chain-helper">Checking for Phantom…</p>
              )}
            </>
          )}
          <a
            className="of-text-link chain-faucet"
            href="https://faucet.solana.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get test SOL from the official faucet{" "}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </section>

        {!projectView && (
          <section className="chain-panel" aria-labelledby="create-heading">
            <div className="chain-step">
              <span>2</span>
              <h2 id="create-heading">Create your campaign</h2>
            </div>
            <p>
              Campaign creation uses your connected Phantom wallet. The creator
              address below is only used to find a campaign. A new campaign
              starts with 0 SOL contributed and its own vault.
            </p>
            {walletAddress &&
              creatorInput.trim() &&
              creatorInput.trim() !== walletAddress && (
                <p className="chain-helper">
                  To create a campaign for the creator entered below, connect
                  that creator&apos;s account in Phantom first.
                </p>
              )}
            <button
              className="of-button"
              type="button"
              onClick={createCampaign}
              disabled={!canSign || yourCampaignExists}
            >
              {yourCampaignExists
                ? "Your campaign already exists"
                : "Create campaign on Devnet"}
            </button>
            <p className="chain-helper">
              This version supports one on-chain campaign per creator. Creating
              it again with the same account is rejected by the program.
            </p>
            <p className="chain-helper">
              Phantom shows the transaction for your approval. Your wallet pays
              network fees and account storage rent in test SOL.
            </p>
          </section>
        )}
        {projectView && (
          <section
            className="chain-panel"
            aria-labelledby="destination-heading"
          >
            <h2 id="destination-heading">Where the funds go</h2>
            <p>
              Each contribution moves from the sponsor&apos;s wallet into this
              campaign&apos;s program-controlled vault.
            </p>
            <p>
              Campaign funding is separate from the creator&apos;s personal
              wallet balance. Network fees and account storage are separate
              costs.
            </p>
            <Link className="of-text-link" href="/dashboard">
              View your startup and sponsorship dashboard
            </Link>
          </section>
        )}
      </div>

      <section className="chain-panel" aria-labelledby="campaign-heading">
        <div className="chain-step">
          <span>3</span>
          <h2 id="campaign-heading">
            {projectView ? "This campaign" : "Find the campaign"}
          </h2>
        </div>
        <p>
          Paste the creator&apos;s public Solana address. A backer uses this
          same creator address after connecting their own wallet.
        </p>
        <form onSubmit={viewCampaign} className="chain-find">
          <label className="of-field" htmlFor="chain-creator">
            Campaign creator&apos;s public address
            <input
              id="chain-creator"
              value={creatorInput}
              readOnly={projectView}
              onChange={(event) => setCreatorInput(event.target.value)}
              placeholder="Paste a public Solana address"
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              required
            />
          </label>
          <button
            className="of-button secondary"
            type="submit"
            disabled={Boolean(busy)}
          >
            Load campaign
          </button>
          {walletAddress && !projectView && (
            <button
              className="of-button secondary"
              type="button"
              onClick={() => {
                setCreatorInput(walletAddress);
                void perform("Reading your campaign…", async () => {
                  await loadChain(walletAddress);
                });
              }}
              disabled={Boolean(busy)}
            >
              Use my address
            </button>
          )}
        </form>

        {addresses && (
          <dl className="chain-addresses">
            <div>
              <dt>Creator</dt>
              <dd>
                <AddressLink value={selectedCreator} />
              </dd>
            </div>
            <div>
              <dt>Campaign PDA</dt>
              <dd>
                <AddressLink value={addresses.campaignAddress} />
              </dd>
            </div>
            <div>
              <dt>Vault PDA</dt>
              <dd>
                <AddressLink value={addresses.vaultAddress} />
              </dd>
            </div>
            {campaign?.contributionAddress && (
              <div>
                <dt>Your Contribution PDA</dt>
                <dd>
                  <AddressLink value={campaign.contributionAddress} />
                </dd>
              </div>
            )}
          </dl>
        )}
        {campaignMissing && (
          <div className="chain-blocked">
            <strong>No campaign found for this creator.</strong>
            <p>
              The creator must connect this account in Phantom and create the
              campaign first. A backer can then load it using this public
              address.
            </p>
          </div>
        )}
        {campaign && (
          <p className="chain-share">
            <Link
              className="of-button secondary small"
              href={`/projects/devnet/${campaign.creatorAddress}`}
            >
              Open shareable campaign page
            </Link>
            <span>
              Send this page&apos;s link to your sponsor. Both devices read the
              same Devnet accounts.
            </span>
          </p>
        )}
        {campaign && (
          <div className="chain-stat-grid">
            <div>
              <span>Campaign contributions</span>
              <strong>
                {formatSol(campaign.totalContributedLamports)} SOL
              </strong>
              <small>{campaign.totalContributedLamports} lamports</small>
            </div>
            <div>
              <span>Vault balance</span>
              <strong>{formatSol(campaign.vaultBalanceLamports)} SOL</strong>
              <small>Includes storage rent</small>
            </div>
            <div>
              <span>Your contribution</span>
              <strong>
                {walletAddress
                  ? `${formatSol(campaign.contributionLamports)} SOL`
                  : "Connect a wallet"}
              </strong>
              <small>
                {walletAddress
                  ? `${campaign.contributionLamports} lamports`
                  : "Read for the connected backer"}
              </small>
            </div>
          </div>
        )}
      </section>

      <section className="chain-panel" aria-labelledby="contribute-heading">
        <div className="chain-step">
          <span>4</span>
          <h2 id="contribute-heading">Contribute test SOL</h2>
        </div>
        <p>
          {projectView || createView
            ? "Choose how much test SOL to contribute. Confirm in Phantom; the contribution goes to this campaign's vault and appears in the shared activity below."
            : "Start with 0.01 SOL, equal to 10,000,000 lamports. Send it twice from the same backer to check that the same Contribution PDA accumulates both deposits."}
        </p>
        <form className="chain-contribute" onSubmit={contribute}>
          <label className="of-field" htmlFor="chain-amount">
            Contribution amount (SOL)
            <input
              id="chain-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={Boolean(busy)}
              aria-describedby="chain-amount-help"
              required
            />
          </label>
          <button
            className="of-button"
            type="submit"
            disabled={!canSign || !campaign}
          >
            Contribute on Devnet
          </button>
        </form>
        <p className="chain-helper" id="chain-amount-help">
          Enter a positive amount with up to 9 decimal places. Load a campaign
          above before contributing. The first contribution also creates the
          backer&apos;s account; storage rent and fees are separate from the
          amount sent to the vault.
        </p>
        {changes && (
          <div
            className={`chain-verification ${changesMatch ? "verified" : ""}`}
            role="status"
          >
            <strong>
              {changesMatch
                ? "The confirmed contribution updated all three amounts."
                : "Transaction confirmed. Review the observed balance changes."}
            </strong>
            <dl>
              <div>
                <dt>Vault increase</dt>
                <dd>{formatChange(changes.vault)} SOL</dd>
              </div>
              <div>
                <dt>Campaign total increase</dt>
                <dd>{formatChange(changes.campaign)} SOL</dd>
              </div>
              <div>
                <dt>Your contribution increase</dt>
                <dd>{formatChange(changes.contribution)} SOL</dd>
              </div>
            </dl>
            <p>
              These values compare chain state immediately before and after this
              transaction. Other backers can also change campaign and vault
              totals.
            </p>
          </div>
        )}
        {!projectView && !createView && (
          <div className="chain-note chain-checklist">
            <strong>For a fresh campaign and a fresh backer:</strong>
            <ol>
              <li>After creation: Campaign contributions = 0 SOL.</li>
              <li>
                After the first 0.01 SOL deposit: campaign and backer totals =
                0.01 SOL.
              </li>
              <li>
                After the second: both totals = 0.02 SOL; the Contribution PDA
                stays the same.
              </li>
              <li>
                Each deposit increases the vault by exactly 0.01 SOL, in
                addition to its initial storage rent.
              </li>
            </ol>
          </div>
        )}
      </section>

      {campaign && (
        <CampaignLedger
          creator={selectedCreator}
          backers={backers}
          backersError={backersError}
          activity={activity}
          activityError={activityError}
          loading={loadingActivity}
          hasMore={hasMoreActivity}
          onMore={() => void loadOlderActivity()}
        />
      )}

      <section className="chain-panel" aria-labelledby="transactions-heading">
        <h2 id="transactions-heading">Recent wallet submissions</h2>
        <p>
          Receipts from this browser session are shown here while you use the
          wallet. The shared Campaign activity above is read from Devnet and
          remains visible after reload.
        </p>
        {visibleReceipts.length === 0 ? (
          <p className="chain-empty">
            No transaction receipt has been received in this session yet.
          </p>
        ) : (
          <ul className="chain-transactions">
            {visibleReceipts.map((receipt) => (
              <li key={receipt.signature}>
                <div className="chain-receipt-title">
                  <strong>{receipt.action}</strong>
                  <span
                    className={`chain-status ${receipt.state === "confirmed" ? "ready" : ""}`}
                  >
                    {receipt.state === "confirmed" && (
                      <CheckCircle2 size={13} aria-hidden="true" />
                    )}
                    {receipt.state === "confirmed"
                      ? "Confirmed"
                      : receipt.state === "pending"
                        ? "Awaiting confirmation"
                        : "Failed"}
                  </span>
                </div>
                <a
                  className="chain-address"
                  href={explorerUrl(receipt.signature, true)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{receipt.signature}</span>
                  <ExternalLink size={13} aria-hidden="true" />
                  <span className="sr-only">
                    View transaction in Solana Explorer on Devnet
                  </span>
                </a>
                <small>Signed by {receipt.wallet}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="chain-scope">
        This campaign uses real Devnet accounts and test SOL. Project
        descriptions, multiple campaigns per creator, milestone voting and fund
        release are not implemented in the deployed program.
      </p>

      <style jsx>{`
        .chain-page {
          padding-top: 42px;
          padding-bottom: 48px;
        }
        .chain-heading {
          display: flex;
          gap: 24px;
          align-items: start;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        .chain-heading h1 {
          margin: 12px 0;
          max-width: 780px;
        }
        .chain-heading p,
        .chain-panel p {
          color: var(--of-muted);
        }
        .chain-heading p {
          max-width: 730px;
        }
        .chain-network {
          border: 1px solid #a0dbd1;
          border-radius: 99px;
          background: #edfaf6;
          color: #00665b;
          padding: 8px 14px;
          font-weight: 700;
          font-size: 12px;
          white-space: nowrap;
        }
        .chain-note {
          background: #edf5ff;
          border: 1px solid #c7dff9;
          padding: 17px 20px;
          border-radius: 12px;
          color: #24486f;
        }
        .chain-share {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          align-items: center;
        }
        .chain-share span {
          font-size: 12px;
        }
        .chain-feedback {
          display: flex;
          gap: 10px;
          align-items: center;
          border: 1px solid #b9dacc;
          background: #f0faf4;
          color: #175330;
          padding: 15px 18px;
          border-radius: 12px;
          margin: 18px 0;
          overflow-wrap: anywhere;
        }
        .chain-feedback.error {
          background: #fff3f1;
          border-color: #efc0b7;
          color: #8d2e1d;
        }
        .chain-panel {
          border: 1px solid var(--of-line);
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 5px 22px #183a5710;
          padding: 26px;
          margin-top: 22px;
          min-width: 0;
        }
        .chain-panel h2 {
          font-size: 21px;
          letter-spacing: -0.5px;
        }
        .chain-panel > p {
          margin: 10px 0 20px;
        }
        .chain-panel-heading {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 16px;
          margin-bottom: 17px;
        }
        .chain-panel-heading p {
          margin-top: 6px;
        }
        .chain-panel :global(.chain-address) {
          display: inline-flex;
          max-width: 100%;
          gap: 8px;
          align-items: center;
          color: #075cad;
          font-family: ui-monospace, monospace;
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .chain-panel :global(.chain-address span:first-child) {
          min-width: 0;
        }
        .chain-panel :global(.chain-address svg) {
          flex: none;
        }
        .chain-panel :global(.chain-address:hover) {
          text-decoration: underline;
        }
        .chain-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 99px;
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 700;
          color: #784409;
          background: #fff4de;
          white-space: nowrap;
        }
        .chain-status.ready {
          color: #006352;
          background: #dbf7ed;
        }
        .chain-blocked {
          margin: 16px 0;
          padding: 16px;
          border: 1px solid #ead3a7;
          border-radius: 10px;
          background: #fff9ed;
          color: #694a1a;
        }
        .chain-blocked p {
          color: #695738;
          font-size: 12px;
          margin-top: 7px;
        }
        .chain-program > .of-button {
          margin-top: 18px;
        }
        .chain-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 22px;
        }
        .chain-step {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .chain-step > span {
          display: grid;
          place-items: center;
          width: 32px;
          height: 32px;
          flex: none;
          border-radius: 50%;
          color: #fff;
          background: var(--of-blue);
          font-weight: 700;
        }
        .chain-wallet {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #00736d;
          margin: 16px 0 10px;
        }
        .chain-wallet-balance {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 12px;
          margin: 18px 0;
          padding: 15px;
          background: #f3f8fe;
          border-radius: 10px;
        }
        .chain-wallet-balance dt {
          color: var(--of-muted);
          font-size: 12px;
        }
        .chain-wallet-balance dd {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
        }
        .chain-panel p.chain-helper {
          font-size: 12px;
          margin: 13px 0 0;
        }
        .chain-faucet {
          margin-top: 21px;
        }
        .chain-find,
        .chain-contribute {
          display: flex;
          align-items: end;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 20px;
        }
        .chain-find .of-field {
          flex: 1;
          min-width: min(260px, 100%);
        }
        .chain-contribute .of-field {
          width: 210px;
          max-width: 100%;
        }
        .chain-find .of-field input {
          width: 100%;
        }
        .chain-addresses {
          display: grid;
          gap: 13px;
          padding: 18px;
          margin: 20px 0 0;
          border: 1px solid var(--of-line);
          background: #fafcff;
          border-radius: 12px;
        }
        .chain-addresses > div {
          display: grid;
          grid-template-columns: 155px minmax(0, 1fr);
          gap: 12px;
        }
        .chain-addresses dt {
          color: #4d6076;
          font-size: 12px;
          font-weight: 700;
        }
        .chain-addresses dd {
          margin: 0;
          min-width: 0;
        }
        .chain-stat-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 22px;
        }
        .chain-stat-grid > div {
          padding: 19px;
          border: 1px solid #d5e8ed;
          border-radius: 12px;
          background: #f1faf9;
        }
        .chain-stat-grid span,
        .chain-stat-grid small {
          display: block;
          color: #456878;
          font-size: 11px;
        }
        .chain-stat-grid strong {
          display: block;
          font-size: 23px;
          margin: 8px 0;
          overflow-wrap: anywhere;
        }
        .chain-stat-grid small {
          overflow-wrap: anywhere;
        }
        .chain-verification {
          margin-top: 20px;
          padding: 18px;
          border-radius: 12px;
          border: 1px solid #d7e1ec;
          background: #f6f9fd;
        }
        .chain-verification.verified {
          border-color: #b4dbcc;
          background: #f0fbf5;
        }
        .chain-verification dl {
          display: grid;
          gap: 7px;
        }
        .chain-verification dl > div {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }
        .chain-verification dd {
          margin: 0;
          font-weight: 700;
        }
        .chain-verification p {
          font-size: 11px;
          margin-top: 12px;
        }
        .chain-checklist {
          margin-top: 22px;
          font-size: 12px;
        }
        .chain-checklist ol {
          margin: 10px 0 0;
          padding-left: 20px;
          display: grid;
          gap: 6px;
        }
        .chain-empty {
          padding: 20px;
          background: #f7faff;
          border-radius: 10px;
          text-align: center;
        }
        .chain-transactions {
          list-style: none;
          padding: 0;
          margin: 20px 0 0;
          display: grid;
          gap: 12px;
        }
        .chain-transactions li {
          border: 1px solid var(--of-line);
          border-radius: 12px;
          padding: 16px;
          min-width: 0;
        }
        .chain-receipt-title {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .chain-transactions small {
          display: block;
          margin-top: 8px;
          color: #587086;
          font-size: 10px;
          overflow-wrap: anywhere;
        }
        .chain-scope {
          color: var(--of-muted);
          font-size: 12px;
          margin-top: 20px !important;
        }
        @media (max-width: 768px) {
          .chain-heading {
            flex-direction: column;
            gap: 12px;
          }
          .chain-grid {
            grid-template-columns: 1fr;
            gap: 0;
          }
          .chain-stat-grid {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .chain-stat-grid > div {
            padding: 15px 18px;
          }
          .chain-stat-grid strong {
            font-size: 21px;
          }
          .chain-panel {
            padding: 20px;
          }
          .chain-panel-heading {
            flex-direction: column;
            gap: 12px;
          }
          .chain-addresses > div {
            grid-template-columns: 1fr;
            gap: 4px;
          }
          .chain-find {
            align-items: stretch;
          }
          .chain-find .of-field {
            flex-basis: 100%;
          }
          .chain-contribute .of-field {
            width: 100%;
          }
          .chain-contribute .of-button {
            width: 100%;
          }
          .chain-receipt-title {
            align-items: start;
          }
        }
        @media (max-width: 390px) {
          .chain-page {
            padding-top: 28px;
          }
          .chain-panel {
            padding: 16px;
          }
          .chain-find .of-button {
            width: 100%;
          }
          .chain-verification dl > div {
            flex-direction: column;
            gap: 2px;
          }
        }
      `}</style>
    </div>
  );
}
