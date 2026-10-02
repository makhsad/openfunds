"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";
import {
  ArrowUpRight,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Spinner } from "@/components/ui";
import { formatSol } from "@/lib/amounts";
import {
  DevnetLedger,
  type DevnetCampaign,
  type DevnetSupport,
} from "@/lib/solana/devnet-ledger";
import {
  PhantomCampaignGateway,
  createDevnetRpcTransport,
  getPhantomProvider,
  type ProgramReadiness,
} from "@/lib/solana/phantom-gateway";
import "./devnet-overview.css";

function shortAddress(value: string) {
  return value.slice(0, 6) + "…" + value.slice(-6);
}

function explorerUrl(value: string) {
  return (
    "https://explorer.solana.com/address/" +
    encodeURIComponent(value) +
    "?cluster=devnet"
  );
}

function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The Devnet data could not be read. Try refreshing.";
}

function readMessage(cause: unknown) {
  if (isSolanaError(cause, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    return cause.context.statusCode === 429
      ? "Solana Devnet is busy. Refresh in a moment to try again."
      : "Solana Devnet data is temporarily unavailable. Refresh to try again.";
  }
  if (
    cause instanceof Error &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  )
    return "Reading Solana Devnet took too long. Refresh to try again.";
  if (
    cause instanceof TypeError &&
    /^(failed to fetch|fetch failed|load failed|networkerror when attempting to fetch resource\.?)$/i.test(
      cause.message,
    )
  )
    return "Could not reach Solana Devnet. Check your connection and refresh.";
  return message(cause);
}

function PublicAddress({ value, label }: { value: string; label: string }) {
  return (
    <a
      className="devnet-public-address"
      href={explorerUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label + " in Solana Explorer on Devnet"}
    >
      <span>{value}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

function CampaignCard({
  campaign,
  support,
}: {
  campaign: DevnetCampaign;
  support?: DevnetSupport;
}) {
  const funded = BigInt(campaign.totalContributedLamports) > 0n;
  return (
    <article
      className="devnet-campaign-card"
      aria-label={"Campaign by " + campaign.creatorAddress}
    >
      <div className="devnet-card-top">
        <span className="devnet-card-icon">
          <ShieldCheck size={24} aria-hidden="true" />
        </span>
        <span className={"devnet-status " + (funded ? "funded" : "")}>
          {funded ? "Contributions received" : "Awaiting support"}
        </span>
      </div>
      <h2>
        <Link href={"/projects/devnet/" + campaign.creatorAddress}>
          Campaign by {shortAddress(campaign.creatorAddress)}
        </Link>
      </h2>
      <p className="devnet-card-subtitle">Live account on Solana Devnet</p>
      <dl className="devnet-card-amounts">
        <div>
          <dt>Total contributions</dt>
          <dd>
            {formatSol(campaign.totalContributedLamports)} <span>SOL</span>
          </dd>
        </div>
        {support && (
          <div className="devnet-your-support">
            <dt>Your contribution</dt>
            <dd>
              {formatSol(support.totalContributedLamports)} <span>SOL</span>
            </dd>
          </div>
        )}
      </dl>
      <div className="devnet-card-vault">
        <span>Vault balance</span>
        <strong>{formatSol(campaign.vaultBalanceLamports)} SOL</strong>
        <small>Includes account storage rent. Held by the program.</small>
      </div>
      <div className="devnet-card-address">
        <span>Creator</span>
        <PublicAddress
          value={campaign.creatorAddress}
          label="Creator address"
        />
      </div>
      <Link
        className="of-button secondary devnet-card-action"
        href={"/projects/devnet/" + campaign.creatorAddress}
      >
        View campaign and contribute{" "}
        <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </article>
  );
}

export function DevnetOverview({
  mode,
  compact = false,
}: {
  mode: "catalog" | "dashboard";
  compact?: boolean;
}) {
  const resourcesRef = useRef<{
    gateway: PhantomCampaignGateway;
    ledger: DevnetLedger;
  } | null>(null);
  const mountedRef = useRef(false);
  const readEpochRef = useRef(0);
  const [campaigns, setCampaigns] = useState<DevnetCampaign[] | null>(null);
  const [support, setSupport] = useState<DevnetSupport[] | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [hasPhantom, setHasPhantom] = useState<boolean | null>(null);
  const [program, setProgram] = useState<ProgramReadiness | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    const resources = resourcesRef.current;
    if (!resources) return;
    const { gateway, ledger } = resources;
    const epoch = ++readEpochRef.current;
    const readingWallet = gateway.connectedAddress;
    const isCurrent = () =>
      mountedRef.current &&
      resourcesRef.current === resources &&
      readEpochRef.current === epoch &&
      gateway.connectedAddress === readingWallet;
    setLoading(true);
    setCatalogError(null);
    setWalletError(null);
    setProgramError(null);
    const [catalogResult, programResult, balanceResult, supportResult] =
      await Promise.allSettled([
        ledger.listCampaigns(),
        compact ? Promise.resolve(null) : gateway.inspectProgram(),
        readingWallet && mode === "dashboard"
          ? gateway.readWalletBalance()
          : Promise.resolve(null),
        readingWallet && mode === "dashboard"
          ? ledger.readSupport(readingWallet)
          : Promise.resolve(null),
      ]);
    if (!isCurrent()) return;
    if (catalogResult.status === "fulfilled") {
      setCampaigns(catalogResult.value);
      setUpdatedAt(new Date());
    } else setCatalogError(readMessage(catalogResult.reason));
    if (programResult.status === "fulfilled") setProgram(programResult.value);
    else {
      setProgram(null);
      setProgramError(readMessage(programResult.reason));
    }
    const walletReadErrors: string[] = [];
    if (balanceResult.status === "fulfilled")
      setWalletBalance(balanceResult.value);
    else {
      setWalletBalance(null);
      walletReadErrors.push(
        "Wallet balance: " + readMessage(balanceResult.reason),
      );
    }
    if (supportResult.status === "fulfilled") setSupport(supportResult.value);
    else {
      setSupport(null);
      walletReadErrors.push(
        "Contributions: " + readMessage(supportResult.reason),
      );
    }
    if (walletReadErrors.length) setWalletError(walletReadErrors.join(" "));
    setLoading(false);
  }, [mode, compact]);

  useEffect(() => {
    mountedRef.current = true;
    const provider = getPhantomProvider();
    const rpc = createDevnetRpcTransport();
    const gateway = new PhantomCampaignGateway({ provider, rpc });
    const resources = { gateway, ledger: new DevnetLedger(rpc) };
    resourcesRef.current = resources;
    const unsubscribe = gateway.onWalletChange((nextAddress) => {
      if (!mountedRef.current) return;
      ++readEpochRef.current;
      setWalletAddress(nextAddress);
      setWalletBalance(null);
      setSupport(null);
      setWalletError(null);
      void refresh();
    });
    void Promise.resolve().then(() => {
      if (!mountedRef.current || resourcesRef.current !== resources) return;
      setHasPhantom(Boolean(provider));
      setWalletAddress(gateway.connectedAddress);
      void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
      resourcesRef.current = null;
    };
  }, [refresh]);

  async function connect() {
    const gateway = resourcesRef.current?.gateway;
    if (!gateway || connecting) return;
    setConnecting(true);
    setWalletError(null);
    try {
      await gateway.connect();
    } catch (cause) {
      if (mountedRef.current) setWalletError(message(cause));
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }

  async function disconnect() {
    const gateway = resourcesRef.current?.gateway;
    if (!gateway || connecting) return;
    setConnecting(true);
    try {
      await gateway.disconnect();
    } catch (cause) {
      if (mountedRef.current) setWalletError(message(cause));
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }

  const visibleCampaigns = useMemo(
    () =>
      (campaigns ?? []).filter((campaign) =>
        (campaign.creatorAddress + " " + campaign.campaignAddress)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [campaigns, query],
  );
  const ownCampaign = campaigns?.find(
    (campaign) => campaign.creatorAddress === walletAddress,
  );
  const byCampaign = new Map(
    (campaigns ?? []).map((campaign) => [campaign.campaignAddress, campaign]),
  );
  const totalSupported = (support ?? [])
    .reduce((sum, item) => sum + BigInt(item.totalContributedLamports), 0n)
    .toString();

  return (
    <div
      className={
        compact
          ? "devnet-overview compact"
          : "of-container of-page devnet-overview"
      }
    >
      {!compact && (
        <>
          <header className="of-page-heading">
            <div>
              <p className="of-eyebrow">
                <ShieldCheck size={14} aria-hidden="true" /> SOLANA DEVNET
              </p>
              <h1 className="of-page-title">
                {mode === "dashboard"
                  ? "My Devnet dashboard"
                  : "Explore Devnet campaigns"}
              </h1>
              <p className="of-subtitle">
                {mode === "dashboard"
                  ? "Your created campaign and contributions, read from the shared blockchain."
                  : "Real campaign accounts and test SOL contributions, visible across devices."}
              </p>
            </div>
            <Link className="of-button" href="/solana">
              Create a campaign <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </header>
          <div className="devnet-notice">
            <strong>Devnet test SOL only.</strong> Contributions enter each
            campaign’s program-controlled vault, not the creator’s personal
            wallet. Withdrawals are not implemented. This program supports one
            campaign per creator.
          </div>
        </>
      )}

      <div className="devnet-refresh-bar">
        <p role="status">
          {loading ? (
            <>
              <Spinner /> Reading Solana Devnet…
            </>
          ) : updatedAt ? (
            <>
              Read from Devnet at {updatedAt.toLocaleTimeString()}. Refresh to
              see new activity.
            </>
          ) : (
            "Devnet data has not loaded."
          )}
        </p>
        <button
          className="of-button secondary"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} aria-hidden="true" /> Refresh Devnet data
        </button>
      </div>
      {catalogError && (
        <div className="devnet-feedback error" role="alert">
          <strong>Could not refresh campaigns.</strong> {catalogError}{" "}
          {campaigns !== null &&
            "Previously loaded campaign values are still shown."}
        </div>
      )}
      {!compact && programError && (
        <div className="devnet-feedback error" role="alert">
          Program status could not be verified. {programError}
        </div>
      )}
      {!compact && program && !program.deployed && (
        <div className="devnet-feedback" role="status">
          Campaign transactions are unavailable. {program.reason}
        </div>
      )}

      {mode === "dashboard" ? (
        <>
          <section
            className="devnet-wallet-panel"
            aria-labelledby="devnet-wallet-heading"
          >
            <div>
              <h2 id="devnet-wallet-heading">
                <Wallet size={19} aria-hidden="true" /> Your Phantom wallet
              </h2>
              <p>
                Connect the creator or sponsor account. Switching accounts
                refreshes the dashboard automatically.
              </p>
            </div>
            {walletAddress ? (
              <>
                <PublicAddress value={walletAddress} label="Connected wallet" />
                <div className="devnet-wallet-balance">
                  <span>Personal Devnet wallet balance</span>
                  <strong>
                    {walletBalance === null
                      ? "Not loaded"
                      : formatSol(walletBalance) + " SOL"}
                  </strong>
                </div>
                <button
                  className="of-button secondary"
                  disabled={connecting}
                  onClick={() => void disconnect()}
                >
                  Disconnect Phantom
                </button>
              </>
            ) : (
              <>
                <button
                  className="of-button"
                  disabled={connecting || hasPhantom !== true}
                  onClick={() => void connect()}
                >
                  {connecting ? "Connecting…" : "Connect Phantom"}
                </button>
                {hasPhantom === false && (
                  <p>
                    Open this page in a browser with the Phantom extension
                    installed. Public campaigns are available without
                    connecting.
                  </p>
                )}
              </>
            )}
            {walletError && (
              <div className="devnet-feedback error" role="alert">
                {walletError}
              </div>
            )}
          </section>

          {!walletAddress ? (
            <div className="of-empty compact">
              <Wallet size={30} aria-hidden="true" />
              <h2>Connect to see your activity</h2>
              <p>
                The dashboard uses your public wallet address to find created
                and supported campaigns on Devnet.
              </p>
              <Link className="of-button secondary" href="/projects">
                Explore public campaigns
              </Link>
            </div>
          ) : (
            <>
              <section
                className="devnet-dashboard-section"
                aria-labelledby="my-devnet-campaign-heading"
              >
                <div className="devnet-section-heading">
                  <h2 id="my-devnet-campaign-heading">My campaign</h2>
                  <span>Funds received by your campaign vault</span>
                </div>
                {campaigns === null ? (
                  <p>
                    {catalogError
                      ? "Your campaign could not be checked."
                      : "Loading your campaign…"}
                  </p>
                ) : ownCampaign ? (
                  <div className="devnet-campaign-grid dashboard">
                    <CampaignCard campaign={ownCampaign} />
                  </div>
                ) : (
                  <div className="of-empty compact">
                    <h3>No campaign found for this wallet</h3>
                    <p>
                      Connect your creator account and create its campaign on
                      Devnet.
                    </p>
                    <Link className="of-button" href="/solana">
                      Create my campaign
                    </Link>
                  </div>
                )}
              </section>
              <section
                className="devnet-dashboard-section"
                aria-labelledby="supported-devnet-campaigns-heading"
              >
                <div className="devnet-section-heading">
                  <h2 id="supported-devnet-campaigns-heading">
                    Campaigns I support
                  </h2>
                  <span>
                    {support === null
                      ? "Contribution accounts have not loaded."
                      : "Your recorded contributions: " +
                        formatSol(totalSupported) +
                        " SOL"}
                  </span>
                </div>
                {support === null ? (
                  <p>
                    {walletError
                      ? "Your contributions could not be loaded. Refresh to retry."
                      : "Loading your contributions…"}
                  </p>
                ) : support.length === 0 ? (
                  <div className="of-empty compact">
                    <h3>No OpenFunds contributions found</h3>
                    <p>
                      A direct transfer to someone’s personal wallet does not
                      create an OpenFunds contribution. Contribute through a
                      campaign page to fund its vault.
                    </p>
                    <Link className="of-button secondary" href="/projects">
                      Find a campaign
                    </Link>
                  </div>
                ) : (
                  <div className="devnet-campaign-grid">
                    {support.map((item) => {
                      const campaign = byCampaign.get(item.campaignAddress);
                      return campaign ? (
                        <CampaignCard
                          key={item.contributionAddress}
                          campaign={campaign}
                          support={item}
                        />
                      ) : (
                        <article
                          className="devnet-campaign-card"
                          key={item.contributionAddress}
                        >
                          <h3>Recorded contribution</h3>
                          <p>{formatSol(item.totalContributedLamports)} SOL</p>
                          <PublicAddress
                            value={item.campaignAddress}
                            label="Supported campaign"
                          />
                          <p>
                            {catalogError
                              ? "Campaign details could not be refreshed."
                              : "This campaign is not in the currently loaded catalog."}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      ) : (
        <>
          {!compact && (
            <label className="devnet-catalog-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">
                Search Devnet campaigns by creator or campaign address
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by creator or campaign address…"
              />
            </label>
          )}
          {campaigns === null ? (
            !loading && (
              <div className="of-empty compact">
                <h2>Campaign data is unavailable</h2>
                <p>Refresh to retry reading the public Devnet accounts.</p>
              </div>
            )
          ) : visibleCampaigns.length ? (
            <>
              <p className="devnet-result-count">
                {visibleCampaigns.length}{" "}
                {visibleCampaigns.length === 1 ? "campaign" : "campaigns"} ·
                Amounts come from on-chain accounts.
              </p>
              <div className="devnet-campaign-grid">
                {visibleCampaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.campaignAddress}
                    campaign={campaign}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="of-empty compact">
              <h2>
                {query.trim()
                  ? "No matching campaign"
                  : "No Devnet campaigns found"}
              </h2>
              <p>
                {query.trim()
                  ? "Try the full public creator address."
                  : "Create a campaign with Phantom to make it visible here on every device."}
              </p>
              {!query.trim() && (
                <Link className="of-button" href="/solana">
                  Create a campaign
                </Link>
              )}
            </div>
          )}
        </>
      )}
      {!compact && (
        <p className="devnet-demo-link">
          Looking for the simulated design preview?{" "}
          <Link
            href={
              mode === "dashboard"
                ? "/dashboard?mode=demo"
                : "/projects?mode=demo"
            }
          >
            Open the local demo
          </Link>
          . Its balances are separate from Devnet.
        </p>
      )}
    </div>
  );
}
