"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, LogOut, Plus, RefreshCw, Wallet, X } from "lucide-react";
import { formatSol } from "@/lib/amounts";
import { usePlatform } from "./platform-provider";
import "./wallet-control.css";

const shortAddress = (value: string) =>
  value.slice(0, 5) + "…" + value.slice(-5);

export function WalletControl() {
  const {
    text,
    walletAddress,
    walletBalance,
    walletBusy,
    walletError,
    hasPhantom,
    connect,
    disconnect,
    refreshWallet,
    knownWallets,
    renameWallet,
    forgetWallet,
    operationBusy,
  } = usePlatform();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const disabled = walletBusy || operationBusy;

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!open && dialogRef.current?.open) dialogRef.current.close();
  }, [open]);

  async function beginSwitch(publicAddress?: string) {
    if (disabled) return;
    setTarget(publicAddress ?? null);
    setSwitching(true);
    await disconnect();
  }
  async function connectSelected() {
    try {
      const connectedAddress = await connect();
      if (!target || target === connectedAddress) {
        setSwitching(false);
        setTarget(null);
      }
    } catch {
      /* Provider exposes the error in this dialog. */
    }
  }
  async function copyAddress() {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="of-button wallet-trigger"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={text("Кошельки", "Wallets")}
      >
        <Wallet size={17} aria-hidden="true" />
        <span>
          {walletAddress
            ? shortAddress(walletAddress)
            : text("Подключить кошелёк", "Connect wallet")}
        </span>
        {walletAddress && (
          <span className="wallet-connected-dot" aria-hidden="true" />
        )}
      </button>
      <dialog
        ref={dialogRef}
        className="wallet-dialog"
        aria-labelledby="wallet-dialog-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="wallet-dialog-header">
          <div>
            <p className="eyebrow">Solana Devnet</p>
            <h2 id="wallet-dialog-title">
              {text("Мои кошельки", "My wallets")}
            </h2>
          </div>
          <button
            type="button"
            className="wallet-icon-button"
            onClick={() => setOpen(false)}
            aria-label={text("Закрыть окно кошельков", "Close wallets")}
          >
            <X size={21} />
          </button>
        </div>
        <p className="wallet-dialog-intro">
          {text(
            "Используйте аккаунты автора и спонсоров. Активный аккаунт выбирается в Phantom, сайт сразу обновляет его данные.",
            "Use creator and sponsor accounts. Choose the active account in Phantom; the site updates its data immediately.",
          )}
        </p>
        {walletAddress ? (
          <section
            className="wallet-active"
            aria-label={text("Активный кошелёк", "Active wallet")}
          >
            <div className="wallet-active-heading">
              <Check size={16} />
              <strong>{text("Подключён сейчас", "Connected now")}</strong>
              <button
                type="button"
                className="wallet-icon-button"
                aria-label={text("Обновить баланс", "Refresh balance")}
                onClick={() => void refreshWallet()}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <code>{walletAddress}</code>
            <div className="wallet-balance">
              <span>{text("Баланс тестовых SOL", "Test SOL balance")}</span>
              <strong>
                {walletBalance === null ? "—" : formatSol(walletBalance)} SOL
              </strong>
            </div>
            <button
              type="button"
              className="wallet-text-button"
              onClick={() => void copyAddress()}
            >
              <Copy size={14} />
              <span>
                {copied
                  ? text("Адрес скопирован", "Address copied")
                  : text("Скопировать адрес", "Copy address")}
              </span>
            </button>
            <Link
              href={"/profile/" + walletAddress}
              onClick={() => setOpen(false)}
            >
              {text("Открыть мой профиль →", "Open my profile →")}
            </Link>
          </section>
        ) : (
          <div className="wallet-empty">
            {text("Кошелёк пока не подключён.", "No wallet is connected yet.")}
          </div>
        )}
        {knownWallets.length > 0 && (
          <section className="wallet-saved">
            <h3>{text("Сохранённые аккаунты", "Remembered accounts")}</h3>
            <p>
              {text(
                "Это сохранённые публичные адреса. Для подписи операций выберите нужный аккаунт в Phantom.",
                "These are remembered public addresses. Select the matching Phantom account to sign transactions.",
              )}
            </p>
            <ul>
              {knownWallets.map((wallet, index) => (
                <li key={wallet.address}>
                  <div>
                    <input
                      aria-label={
                        text("Название кошелька ", "Wallet label ") +
                        (index + 1)
                      }
                      placeholder={text("Кошелёк ", "Wallet ") + (index + 1)}
                      defaultValue={wallet.label}
                      maxLength={60}
                      onBlur={(event) =>
                        renameWallet(wallet.address, event.target.value)
                      }
                    />
                    <code>{shortAddress(wallet.address)}</code>
                  </div>
                  {wallet.address === walletAddress ? (
                    <span className="wallet-active-badge">
                      {text("Активен", "Active")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="wallet-text-button"
                      disabled={disabled}
                      onClick={() => void beginSwitch(wallet.address)}
                    >
                      {text("Переключить", "Switch")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="wallet-icon-button"
                    aria-label={
                      text(
                        "Убрать сохранённый адрес ",
                        "Forget remembered address ",
                      ) + shortAddress(wallet.address)
                    }
                    onClick={() => forgetWallet(wallet.address)}
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {((switching &&
          (!walletAddress || (target && target !== walletAddress))) ||
          !walletAddress) &&
          hasPhantom && (
            <div className="wallet-switch-guide" role="status">
              <strong>
                {text(
                  "Подключить выбранный аккаунт",
                  "Connect the selected account",
                )}
              </strong>
              <ol>
                <li>
                  {text(
                    "Откройте Phantom и выберите нужный аккаунт вверху окна.",
                    "Open Phantom and choose the account at the top of its window.",
                  )}
                </li>
                <li>
                  {text(
                    "Выберите Solana Devnet в настройках Phantom.",
                    "Choose Solana Devnet in Phantom settings.",
                  )}
                </li>
                <li>
                  {text(
                    "Нажмите кнопку ниже и разрешите подключение.",
                    "Use the button below and approve the connection.",
                  )}
                </li>
              </ol>
              {target && (
                <p>
                  {text("Ожидаемый адрес: ", "Expected address: ")}
                  <code>{target}</code>
                </p>
              )}
              {target && walletAddress && target !== walletAddress && (
                <p className="wallet-error">
                  {text(
                    "В Phantom выбран другой аккаунт. Переключите его перед подписью.",
                    "A different Phantom account is active. Switch it before signing.",
                  )}
                </p>
              )}
              <button
                type="button"
                className="of-button"
                disabled={disabled}
                onClick={() => void connectSelected()}
              >
                {text("Подключить аккаунт Phantom", "Connect Phantom account")}
              </button>
            </div>
          )}
        {hasPhantom === false && (
          <div className="wallet-switch-guide">
            <p>
              {text(
                "Откройте сайт в браузере с расширением Phantom или внутри браузера приложения Phantom.",
                "Open this site in a browser with the Phantom extension or inside the Phantom app browser.",
              )}
            </p>
            <a
              className="of-button"
              href="https://phantom.com/download"
              target="_blank"
              rel="noopener noreferrer"
            >
              {text("Установить Phantom", "Install Phantom")}
            </a>
          </div>
        )}
        {walletError && (
          <p className="wallet-error" role="alert">
            {walletError}
          </p>
        )}
        {walletAddress && (
          <div className="wallet-dialog-actions">
            <button
              type="button"
              className="of-button secondary"
              disabled={disabled}
              onClick={() => void beginSwitch()}
            >
              <Plus size={16} />
              {text("Другой кошелёк", "Another wallet")}
            </button>
            <button
              type="button"
              className="wallet-text-button"
              disabled={disabled}
              onClick={() => void disconnect()}
            >
              <LogOut size={15} />
              {text("Отключить", "Disconnect")}
            </button>
          </div>
        )}
        <p className="wallet-footnote">
          {text(
            "Тестовые SOL не имеют денежной ценности. Все операции подтверждаются в Phantom.",
            "Test SOL have no monetary value. Confirm every transaction in Phantom.",
          )}
        </p>
      </dialog>
    </>
  );
}
