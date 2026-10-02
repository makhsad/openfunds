"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TransactionConfirmationError,
  TransactionStageError,
} from "@/lib/solana/phantom-gateway";
import { OPENFUNDS_PROGRAM_ADDRESS } from "@/lib/solana/phantom-gateway";
import { usePlatform } from "./platform-provider";
import "./platform-ui.css";

type Receipt = { signature: string; state: "pending" | "confirmed" | "failed" };
const PENDING_KEY = "openfunds-platform-setup-pending-v2";

function rememberPending(signature: string | null) {
  try {
    if (signature) sessionStorage.setItem(PENDING_KEY, signature);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* Recovery remains available in this page when browser storage is disabled. */
  }
}

/** An operator must explicitly approve setup after the separately approved program upgrade. */
export function PlatformSetup() {
  const {
    text,
    walletAddress,
    walletBusy,
    projectGateway,
    ledger,
    operationBusy,
    runOperation,
    refreshKey,
  } = usePlatform();
  const [capability, setCapability] = useState<boolean | null>(null);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const epoch = useRef(0);

  const refresh = useCallback(async () => {
    if (!ledger) return;
    const request = ++epoch.current;
    setReading(true);
    try {
      const current = await ledger.readCapabilities();
      if (request === epoch.current) {
        setCapability(current.available);
        setError(null);
      }
    } catch {
      if (request === epoch.current)
        setError(
          text(
            "Не удалось проверить активацию в Devnet. Обновите состояние. Эта проверка не отправляет транзакции.",
            "Could not check Devnet activation. Refresh the state. This check sends no transactions.",
          ),
        );
    } finally {
      if (request === epoch.current) setReading(false);
    }
  }, [ledger, text]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const signature = sessionStorage.getItem(PENDING_KEY);
        if (signature && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
          setReceipt({ signature, state: "pending" });
      } catch {
        /* A private browser can still use explicit confirmation checks. */
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      epoch.current += 1;
    };
  }, [refresh, refreshKey]);

  async function activate() {
    if (
      !projectGateway ||
      !walletAddress ||
      capability !== false ||
      receipt?.state === "pending" ||
      receipt?.state === "confirmed"
    )
      return;
    setError(null);
    try {
      const result = await runOperation(() =>
        projectGateway.initializePlatform(),
      );
      setReceipt({ signature: result.signature, state: "confirmed" });
      rememberPending(null);
      await refresh();
    } catch (cause) {
      if (cause instanceof TransactionConfirmationError) {
        setReceipt({ signature: cause.signature, state: cause.state });
        rememberPending(cause.state === "pending" ? cause.signature : null);
        setError(
          cause.state === "pending"
            ? text(
                "Транзакция отправлена, но подтверждение пока не получено. Проверьте её состояние перед повторной попыткой.",
                "The transaction was submitted, but confirmation is not available yet. Check its status before retrying.",
              )
            : text(
                "Сеть отклонила транзакцию активации. Проверьте операцию и состояние программы.",
                "The network rejected activation. Check the transaction and program state.",
              ),
        );
      } else {
        setError(
          cause instanceof TransactionStageError && cause.cancelled
            ? text(
                "Подтверждение в Phantom отменено. Активация не завершена.",
                "Phantom confirmation was cancelled. Activation was not completed.",
              )
            : text(
                "Не удалось активировать платформу. Убедитесь, что владелец уже обновил программу Devnet, выбран нужный аккаунт Phantom и хватает тестовых SOL.",
                "Could not activate the platform. Confirm the owner upgraded the Devnet program, the correct Phantom account is active, and test SOL cover the transaction.",
              ),
        );
      }
    }
  }

  async function checkReceipt() {
    if (!ledger || !receipt || checking) return;
    const signature = receipt.signature;
    setChecking(true);
    setError(null);
    try {
      const state = await ledger.readTransactionStatus(signature);
      setReceipt({ signature, state });
      if (state !== "pending") rememberPending(null);
      if (state === "pending")
        setError(
          text(
            "Подтверждение ещё не получено. Повторная отправка заблокирована; можно проверить снова.",
            "Confirmation is still pending. Resubmission is blocked; you can check again.",
          ),
        );
      else if (state === "failed")
        setError(
          text(
            "Транзакция отклонена. Проверьте обновление программы перед новой попыткой.",
            "The transaction failed. Verify the program upgrade before another attempt.",
          ),
        );
      if (state === "confirmed") await refresh();
    } catch {
      setError(
        text(
          "Не удалось прочитать подтверждение. Ссылка на операцию сохранена; новая транзакция не отправлялась.",
          "Could not read confirmation. The transaction link is retained; no new transaction was sent.",
        ),
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">Solana Devnet</p>
          <h1>{text("Активация платформы", "Platform activation")}</h1>
          <p>
            {text(
              "Служебная страница для первого запуска новой версии OpenFunds.",
              "Operator page for the first activation of the new OpenFunds version.",
            )}
          </p>
        </div>
      </div>
      <div className="pf-panel">
        <p>
          {text(
            "Сначала владелец должен отдельно обновить программу в Solana Devnet. Публикация сайта на Vercel этого не делает. Эта страница не размещает и не обновляет программу.",
            "The owner must separately upgrade the Solana Devnet program first. Publishing to Vercel does not perform that upgrade. This page does not deploy or upgrade the program.",
          )}
        </p>
        <p>
          <strong>
            {text("Публичный адрес программы: ", "Public program address: ")}
          </strong>
          <a
            className="pf-address"
            href={
              "https://explorer.solana.com/address/" +
              OPENFUNDS_PROGRAM_ADDRESS +
              "?cluster=devnet"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{OPENFUNDS_PROGRAM_ADDRESS}</span>
          </a>
        </p>
        <p className="pf-muted">
          {text(
            "Активация создаёт общую запись версии 2 и оплачивается тестовыми SOL. Она не переводит деньги спонсоров и не закрывает проекты. Проверка состояния выполняется без подписи.",
            "Activation creates the shared version 2 record and costs test SOL. It does not move sponsor funds or close projects. State checks do not require signing.",
          )}
        </p>
        {capability === true ? (
          <div className="pf-notice success" role="status">
            <span>
              {text(
                "Платформа активирована. Создание проектов, чат и возвраты доступны.",
                "The platform is activated. Project creation, chat and refunds are available.",
              )}
            </span>
          </div>
        ) : (
          <div className="pf-notice" role="status">
            <span>
              {capability === null
                ? text("Проверяем активацию…", "Checking activation…")
                : text(
                    "Запись активации пока отсутствует. Кнопку ниже используйте после подтверждённого обновления программы.",
                    "The activation record is absent. Use the button below after the program upgrade is confirmed.",
                  )}
            </span>
          </div>
        )}
        {error && (
          <p className="pf-notice error" role="alert">
            <span>{error}</span>
          </p>
        )}
        {receipt && (
          <div className="pf-notice" role="status">
            <span>
              {receipt.state === "confirmed"
                ? text("Транзакция подтверждена. ", "Transaction confirmed. ")
                : receipt.state === "failed"
                  ? text("Транзакция отклонена. ", "Transaction failed. ")
                  : text(
                      "Транзакция ожидает проверки. ",
                      "Transaction awaiting verification. ",
                    )}
              <a
                className="of-text-link"
                href={
                  "https://explorer.solana.com/tx/" +
                  receipt.signature +
                  "?cluster=devnet"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {text(
                  "Открыть операцию в Explorer",
                  "Open transaction in Explorer",
                )}
              </a>
            </span>
          </div>
        )}
        <div className="wallet-dialog-actions">
          <button
            className="of-button secondary"
            type="button"
            disabled={reading || operationBusy || checking}
            onClick={() => void refresh()}
          >
            {text("Обновить состояние", "Refresh state")}
          </button>
          {receipt?.state === "pending" && (
            <button
              className="of-button secondary"
              type="button"
              disabled={checking || operationBusy}
              onClick={() => void checkReceipt()}
            >
              {text("Проверить подтверждение", "Check confirmation")}
            </button>
          )}
          {capability === false && (
            <>
              {!walletAddress && (
                <p className="pf-muted">
                  {text(
                    "Подключите Phantom кнопкой «Подключить кошелёк» вверху страницы.",
                    "Connect Phantom using the Connect wallet button at the top of the page.",
                  )}
                </p>
              )}
              <button
                className="of-button"
                type="button"
                disabled={
                  !walletAddress ||
                  operationBusy ||
                  walletBusy ||
                  reading ||
                  checking ||
                  receipt?.state === "pending" ||
                  receipt?.state === "confirmed"
                }
                onClick={() => void activate()}
              >
                {operationBusy
                  ? text(
                      "Дождитесь Phantom и сети…",
                      "Wait for Phantom and the network…",
                    )
                  : text(
                      "Активировать после обновления программы",
                      "Activate after the program upgrade",
                    )}
              </button>
            </>
          )}
          <Link className="of-text-link" href="/projects">
            {text("Открыть проекты →", "Open projects →")}
          </Link>
        </div>
        <p className="pf-muted">
          {text(
            "При открытии страницы транзакции не отправляются. Нажатие проверки не подписывает и не повторяет операцию.",
            "Opening this page sends no transactions. Checking status never signs or resubmits a transaction.",
          )}
        </p>
      </div>
    </section>
  );
}
