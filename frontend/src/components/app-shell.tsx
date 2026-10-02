"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, FlaskConical, Globe2 } from "lucide-react";
import { Brand } from "@/components/ui";
import { usePlatform } from "@/features/platform/platform-provider";
import { WalletControl } from "@/features/platform/wallet-control";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { text, locale, setLocale } = usePlatform();
  return (
    <div className="of-app" translate="no">
      <a className="skip-link" href="#main-content">
        {text("Перейти к содержимому", "Skip to content")}
      </a>
      <div className="of-demo-banner" role="region" aria-label="Solana Devnet">
        <span className="of-container">
          <FlaskConical size={14} aria-hidden="true" />
          <strong>
            {text("Демонстрация · Solana Devnet", "Demo · Solana Devnet")}
          </strong>
          <span>
            {text(
              "Тестовые SOL. Подтверждайте операции в Phantom.",
              "Test SOL. Confirm transactions in Phantom.",
            )}
          </span>
        </span>
      </div>
      <header className="of-header">
        <div className="of-container of-navbar">
          <Link
            className="of-brand-link"
            href="/"
            aria-label={text("Главная OpenFunds", "OpenFunds home")}
          >
            <Brand />
          </Link>
          <nav aria-label={text("Основная навигация", "Main navigation")}>
            {[
              ["/projects", text("Проекты", "Projects")],
              ["/create", text("Создать проект", "Create project")],
              ["/dashboard", text("Мой кабинет", "Dashboard")],
              ["/#how-it-works", text("Как это работает", "How it works")],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="of-header-actions">
            <label className="of-language-select">
              <Globe2 size={15} aria-hidden="true" />
              <select
                aria-label={text("Язык сайта", "Site language")}
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value === "en" ? "en" : "ru")
                }
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <WalletControl />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="of-footer">
        <div className="of-container of-footer-main">
          <div>
            <Link
              href="/"
              aria-label={text("Главная OpenFunds", "OpenFunds home")}
            >
              <Brand />
            </Link>
            <p>
              {text(
                "Хорошие идеи заслуживают поддержки.",
                "Good ideas deserve support.",
              )}
            </p>
          </div>
          <nav
            aria-label={text("Навигация внизу страницы", "Footer navigation")}
          >
            <Link href="/projects">
              {text("Найти проект", "Explore projects")}
              <ArrowUpRight size={13} />
            </Link>
            <Link href="/create">
              {text("Создать проект", "Start a project")}
            </Link>
            <Link href="/dashboard">
              {text("Мои взносы и проекты", "My support and projects")}
            </Link>
          </nav>
          <div className="of-footer-note">
            <strong>
              {text(
                "Один сайт. Общие проекты и прозрачные взносы.",
                "One site. Shared projects and transparent contributions.",
              )}
            </strong>
            <p>
              {text(
                "Средства хранятся в хранилище проекта. При закрытии — возврат спонсорам.",
                "Funds stay in the project vault. Closing enables sponsor refunds.",
              )}
            </p>
          </div>
        </div>
        <div className="of-container of-footer-bottom">
          <span>OpenFunds · Solana Devnet</span>
          <span>{text("Только тестовые SOL", "Test SOL only")}</span>
        </div>
      </footer>
    </div>
  );
}
