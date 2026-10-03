"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PhantomCampaignGateway,
  createDevnetRpcTransport,
  getPhantomProvider,
} from "@/lib/solana/phantom-gateway";
import { ProjectGateway } from "@/lib/solana/project-gateway";
import { ProjectLedger } from "@/lib/solana/project-ledger";
import {
  WALLET_STORAGE_KEY,
  readRememberedWallets,
  rememberWallet,
  type RememberedWallet,
} from "@/lib/solana/wallet-registry";

interface PlatformContextValue {
  text(ru: string, en: string): string;
  walletAddress: string | null;
  walletBalance: string | null;
  hasPhantom: boolean | null;
  walletBusy: boolean;
  walletError: string | null;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  refreshWallet(): Promise<void>;
  knownWallets: RememberedWallet[];
  renameWallet(publicAddress: string, label: string): void;
  forgetWallet(publicAddress: string): void;
  projectGateway: ProjectGateway | null;
  ledger: ProjectLedger | null;
  operationBusy: boolean;
  runOperation<T>(action: () => Promise<T>): Promise<T>;
  refreshKey: number;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);
const DISCONNECTED_KEY = "openfunds-wallet-disconnected-v1";

function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional in private browsers. */
  }
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [hasPhantom, setHasPhantom] = useState<boolean | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [knownWallets, setKnownWallets] = useState<RememberedWallet[]>([]);
  const [projectGateway, setProjectGateway] = useState<ProjectGateway | null>(
    null,
  );
  const [ledger, setLedger] = useState<ProjectLedger | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const walletRef = useRef<PhantomCampaignGateway | null>(null);
  const balanceEpoch = useRef(0);
  const operationLock = useRef(false);
  const connectionLock = useRef(false);

  const text = useCallback((_ru: string, en: string) => en, []);

  const refreshWallet = useCallback(async () => {
    const gateway = walletRef.current;
    const readingWallet = gateway?.connectedAddress;
    const epoch = ++balanceEpoch.current;
    if (!gateway || !readingWallet) {
      setWalletBalance(null);
      return;
    }
    try {
      const value = await gateway.readWalletBalance();
      if (
        epoch === balanceEpoch.current &&
        gateway.connectedAddress === readingWallet
      ) {
        setWalletBalance(value);
        setWalletError(null);
      }
    } catch {
      if (
        epoch === balanceEpoch.current &&
        gateway.connectedAddress === readingWallet
      ) {
        setWalletBalance(null);
        setWalletError("balance-read-failed");
      }
    }
  }, []);

  useEffect(() => {
    // Browser-only remembered wallets load after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKnownWallets(readRememberedWallets(storageGet(WALLET_STORAGE_KEY)));
    const provider = getPhantomProvider();
    const rpc = createDevnetRpcTransport();
    const gateway = new PhantomCampaignGateway({ provider, rpc });
    walletRef.current = gateway;
    setHasPhantom(Boolean(provider));
    setProjectGateway(new ProjectGateway({ walletGateway: gateway, rpc }));
    setLedger(new ProjectLedger(rpc));
    let mounted = true;
    const capturedEpoch = balanceEpoch;
    const changed = (publicAddress: string | null) => {
      if (!mounted) return;
      ++balanceEpoch.current;
      setWalletAddress(publicAddress);
      setWalletBalance(null);
      setWalletError(null);
      setRefreshKey((key) => key + 1);
      if (publicAddress) {
        setKnownWallets((wallets) => {
          const next = rememberWallet(wallets, publicAddress);
          storageSet(WALLET_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        void refreshWallet();
      }
    };
    const unsubscribe = gateway.onWalletChange(changed);
    changed(gateway.connectedAddress);
    if (
      provider &&
      !gateway.connectedAddress &&
      storageGet(DISCONNECTED_KEY) !== "1"
    ) {
      void gateway.reconnectTrusted().catch(() => {
        /* An untrusted wallet waits for an explicit connection. */
      });
    }
    return () => {
      mounted = false;
      ++capturedEpoch.current;
      unsubscribe();
      if (walletRef.current === gateway) walletRef.current = null;
    };
  }, [refreshWallet]);

  const connect = useCallback(async () => {
    if (connectionLock.current || operationLock.current)
      throw new Error(
        text(
          "Дождитесь завершения операции.",
          "Wait for the operation to finish.",
        ),
      );
    connectionLock.current = true;
    setWalletBusy(true);
    setWalletError(null);
    try {
      if (!walletRef.current)
        throw new Error(
          text(
            "Подключение ещё загружается.",
            "The wallet connection is loading.",
          ),
        );
      const connectedAddress = await walletRef.current.connect();
      storageSet(DISCONNECTED_KEY, "0");
      return connectedAddress;
    } catch (cause) {
      const cancelled =
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === 4001;
      setWalletError(
        cancelled
          ? text(
              "Подключение отменено. Можно попробовать снова.",
              "Connection cancelled. You can try again.",
            )
          : text(
              "Не удалось подключить Phantom. Откройте его и попробуйте снова.",
              "Could not connect Phantom. Open the wallet and try again.",
            ),
      );
      throw cause;
    } finally {
      connectionLock.current = false;
      setWalletBusy(false);
    }
  }, [text]);

  const disconnect = useCallback(async () => {
    if (connectionLock.current || operationLock.current) return;
    connectionLock.current = true;
    setWalletBusy(true);
    try {
      await walletRef.current?.disconnect();
      storageSet(DISCONNECTED_KEY, "1");
    } catch {
      setWalletError(
        text(
          "Не удалось отключить кошелёк. Повторите действие.",
          "Could not disconnect the wallet. Try again.",
        ),
      );
    } finally {
      connectionLock.current = false;
      setWalletBusy(false);
    }
  }, [text]);

  const renameWallet = useCallback(
    (publicAddress: string, label: string) =>
      setKnownWallets((wallets) => {
        const next = wallets.map((wallet) =>
          wallet.address === publicAddress
            ? { ...wallet, label: label.trim().slice(0, 60) }
            : wallet,
        );
        storageSet(WALLET_STORAGE_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );
  const forgetWallet = useCallback(
    (publicAddress: string) =>
      setKnownWallets((wallets) => {
        const next = wallets.filter(
          (wallet) => wallet.address !== publicAddress,
        );
        storageSet(WALLET_STORAGE_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );

  const runOperation = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      if (operationLock.current)
        throw new Error(
          text(
            "Дождитесь завершения текущей операции.",
            "Wait for the current transaction to finish.",
          ),
        );
      if (!walletRef.current?.connectedAddress)
        throw new Error(
          text("Сначала подключите Phantom.", "Connect Phantom first."),
        );
      operationLock.current = true;
      setOperationBusy(true);
      try {
        const result = await action();
        setRefreshKey((key) => key + 1);
        void refreshWallet();
        return result;
      } finally {
        operationLock.current = false;
        setOperationBusy(false);
      }
    },
    [refreshWallet, text],
  );

  return (
    <PlatformContext.Provider
      value={{
        text,
        walletAddress,
        walletBalance,
        hasPhantom,
        walletBusy,
        walletError:
          walletError === "balance-read-failed"
            ? text(
                "Не удалось обновить баланс Devnet. Попробуйте ещё раз.",
                "Could not refresh the Devnet balance. Try again.",
              )
            : walletError,
        connect,
        disconnect,
        refreshWallet,
        knownWallets,
        renameWallet,
        forgetWallet,
        projectGateway,
        ledger,
        operationBusy,
        runOperation,
        refreshKey,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) throw new Error("PlatformProvider is required.");
  return value;
}

/** Keep interface text inside a stable React-owned element. */
export function Text({ ru, en }: { ru: string; en: string }) {
  const { text } = usePlatform();
  return <span translate="no">{text(ru, en)}</span>;
}
