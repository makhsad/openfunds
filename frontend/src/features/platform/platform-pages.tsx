"use client";
/* eslint-disable @next/next/no-img-element */

import {
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  HeartHandshake,
  ImagePlus,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { formatSol, parseSol, percentOf } from "@/lib/amounts";
import type {
  ProjectSummary,
  ProjectBacker,
  ProjectMessage,
  ProjectActivity,
} from "@/lib/solana/project-ledger";
import { deriveProjectAddresses } from "@/lib/solana/project-ledger";
import {
  TransactionConfirmationError,
  TransactionStageError,
} from "@/lib/solana/phantom-gateway";
import { usePlatform } from "./platform-provider";
import "./platform-ui.css";

type Capability = { version: number; available: boolean };
const categories = [
  {
    value: "general",
    ru: "Все направления",
    en: "All categories",
    image: "/images/project-community.svg",
  },
  {
    value: "technology",
    ru: "Технологии",
    en: "Technology",
    image: "/images/project-opensource.svg",
  },
  {
    value: "education",
    ru: "Образование",
    en: "Education",
    image: "/images/project-education.svg",
  },
  {
    value: "environment",
    ru: "Экология",
    en: "Environment",
    image: "/images/project-environment.svg",
  },
  {
    value: "community",
    ru: "Сообщество",
    en: "Community",
    image: "/images/project-community.svg",
  },
] as const;

function short(value: string) {
  return value.slice(0, 6) + "…" + value.slice(-5);
}
function fail(
  cause: unknown,
  text: (ru: string, en: string) => string,
): string {
  if (cause instanceof TransactionConfirmationError) {
    return cause.state === "pending"
      ? text(
          "Транзакция отправлена, но подтверждение ещё не получено. Не отправляйте её повторно.",
          "The transaction was submitted but has not been confirmed yet. Do not submit it again.",
        )
      : text(
          "Сеть отклонила транзакцию. Взносы проекта не изменились; сетевая комиссия может быть списана.",
          "The network rejected the transaction. Project contributions did not change; a network fee may still have been charged.",
        );
  }
  if (cause instanceof TransactionStageError) {
    if (cause.cancelled)
      return text(
        "Подтверждение отменено в Phantom. Операция не отправлена.",
        "Confirmation was cancelled in Phantom. The operation was not submitted.",
      );
    if (cause.cause && cause.cause !== cause) return fail(cause.cause, text);
  }
  if (isSolanaError(cause, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    return cause.context.statusCode === 429
      ? text(
          "Solana Devnet сейчас занята. Обновите данные немного позже.",
          "Solana Devnet is busy. Refresh the data in a moment.",
        )
      : text(
          "Не удалось получить данные Devnet. Проверьте соединение и обновите страницу.",
          "Devnet data could not be loaded. Check your connection and refresh.",
        );
  }
  if (
    cause instanceof Error &&
    /timeout|timed out|fetch failed|failed to fetch|networkerror|load failed/i.test(
      cause.message + " " + cause.name,
    )
  )
    return text(
      "Сеть отвечает слишком долго. Проверьте соединение и обновите данные.",
      "The network is taking too long to respond. Check your connection and refresh the data.",
    );
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === 4001
  )
    return text(
      "Подтверждение отменено в Phantom. Операция не отправлена.",
      "Confirmation was cancelled in Phantom. The operation was not submitted.",
    );
  if (cause instanceof Error && cause.message.length <= 400)
    return cause.message;
  return text(
    "Не удалось завершить запрос Devnet. Обновите данные и попробуйте снова.",
    "The Devnet request could not be completed. Refresh the data and try again.",
  );
}
function explorer(value: string, transaction = false) {
  return (
    "https://explorer.solana.com/" +
    (transaction ? "tx/" : "address/") +
    encodeURIComponent(value) +
    "?cluster=devnet"
  );
}
function amount(value: string) {
  return formatSol(value) + " SOL";
}
function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}
function currentFunds(project: ProjectSummary) {
  return (
    BigInt(project.totalContributedLamports) -
    BigInt(project.totalRefundedLamports)
  ).toString();
}
function projectTitle(
  project: ProjectSummary,
  text: (ru: string, en: string) => string,
) {
  return !project.legacy && project.title
    ? project.title
    : text("Проект автора ", "Project by ") + short(project.creatorAddress);
}

function cover(project: ProjectSummary) {
  if (project.imageUrl.startsWith("https://")) return project.imageUrl;
  return (
    categories.find((item) => item.value === project.category)?.image ??
    "/images/project-community.svg"
  );
}

function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
}) {
  return (
    <div
      className={"pf-notice " + kind}
      role={kind === "error" ? "alert" : "status"}
    >
      <span>{children}</span>
    </div>
  );
}

function PublicAddress({
  value,
  full = false,
}: {
  value: string;
  full?: boolean;
}) {
  return (
    <a
      className="pf-address"
      href={explorer(value)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{full ? value : short(value)}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

function TransactionLink({ value }: { value: string }) {
  const { text } = usePlatform();
  return (
    <a
      className="pf-address"
      href={explorer(value, true)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{text("Посмотреть транзакцию", "View transaction")}</span>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function CreatorAddress({ value }: { value: string }) {
  const { text } = usePlatform();
  return (
    <span className="pf-creator-address">
      <Link className="pf-address" href={"/profile/" + value}>
        <span>{short(value)}</span>
      </Link>
      <a
        className="pf-address"
        href={explorer(value)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={text(
          "Адрес в Solana Explorer",
          "Address in Solana Explorer",
        )}
      >
        <ExternalLink size={13} aria-hidden="true" />
      </a>
    </span>
  );
}

function Status({ project }: { project: ProjectSummary }) {
  const { text } = usePlatform();
  const label = project.closed
    ? BigInt(project.totalRefundedLamports) ===
      BigInt(project.totalContributedLamports)
      ? text("Закрыт · средства возвращены", "Closed · funds returned")
      : text("Закрыт · идут возвраты", "Closed · refunds pending")
    : text("Сбор открыт", "Funding open");
  return (
    <span className={"pf-badge " + (project.closed ? "closed" : "open")}>
      <span>{label}</span>
    </span>
  );
}

function NetworkNote() {
  const { text } = usePlatform();
  return (
    <div className="pf-network-note">
      <ShieldCheck size={17} aria-hidden="true" />
      <span>
        {text(
          "Демонстрация в Solana Devnet. Используйте только тестовые SOL.",
          "Solana Devnet demonstration. Use test SOL only.",
        )}
      </span>
    </div>
  );
}

function WalletPrompt() {
  const { text, connect, walletBusy, hasPhantom, walletError } = usePlatform();
  return (
    <div className="pf-wallet-prompt">
      <Wallet size={25} aria-hidden="true" />
      <h2>
        <span>{text("Подключите свой кошелёк", "Connect your wallet")}</span>
      </h2>
      <p>
        <span>
          {text(
            "Выберите Solana Devnet в Phantom. Вы сможете создавать проекты, поддерживать их и общаться с участниками.",
            "Select Solana Devnet in Phantom. You can create projects, support others and join project discussions.",
          )}
        </span>
      </p>
      <button
        className="of-button"
        onClick={() => {
          void connect().catch(() => {});
        }}
        disabled={walletBusy || hasPhantom === false}
      >
        <span>
          {walletBusy
            ? text("Подключаем…", "Connecting…")
            : text("Подключить Phantom", "Connect Phantom")}
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      {hasPhantom === false && (
        <a
          href="https://phantom.com/download"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{text("Установить Phantom", "Install Phantom")}</span>
        </a>
      )}
      {walletError && <Notice kind="error">{walletError}</Notice>}
    </div>
  );
}

function UpgradeNote() {
  const { text } = usePlatform();
  return (
    <Notice>
      <span>
        {text(
          "Новая версия программы ещё не активирована в этой сети. Существующие проекты и их средства доступны для просмотра; создание проектов с описанием, чат и возврат требуют обновления программы.",
          "The new program version is not active on this network yet. Existing projects and funds remain visible; project descriptions, chat and refunds require the program upgrade.",
        )}
      </span>
    </Notice>
  );
}

function useCatalog() {
  const { ledger, refreshKey, text } = usePlatform();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const readingRef = useRef(false);
  const invalidate = useCallback(() => {
    epoch.current += 1;
  }, []);
  const refresh = useCallback(async () => {
    if (!ledger) return;
    const reading = ++epoch.current;
    readingRef.current = true;
    const [list, caps] = await Promise.allSettled([
      ledger.listProjects(),
      ledger.readCapabilities(),
    ]);
    readingRef.current = false;
    if (reading !== epoch.current) return;
    setError(null);
    if (list.status === "fulfilled") setProjects(list.value);
    else setError(fail(list.reason, text));
    if (caps.status === "fulfilled") setCapability(caps.value);
    setLoading(false);
    setRevision((value) => value + 1);
  }, [ledger, text]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [refresh, refreshKey, invalidate]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !readingRef.current)
        void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { projects, capability, loading, error, refresh, revision };
}

function ProjectCard({
  project,
  support,
  personal = true,
}: {
  project: ProjectSummary;
  support?: ProjectBacker;
  personal?: boolean;
}) {
  const { text } = usePlatform();
  const funds = currentFunds(project);
  const hasGoal = BigInt(project.goalLamports) > 0n;
  const progress = hasGoal ? percentOf(funds, project.goalLamports) : 0;
  return (
    <article className="pf-project-card">
      <Link
        className="pf-card-cover"
        href={"/projects/" + project.campaignAddress}
        aria-hidden="true"
        tabIndex={-1}
      >
        <img
          src={cover(project)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        <Status project={project} />
      </Link>
      <div className="pf-card-body">
        <h2>
          <Link href={"/projects/" + project.campaignAddress}>
            {projectTitle(project, text)}
          </Link>
        </h2>
        <p className="pf-card-description">
          {project.description ||
            text(
              "Кампания создана в предыдущей версии. Её взносы и история доступны здесь.",
              "A campaign created with the earlier program. Its contributions and history are available here.",
            )}
        </p>
        <p className="pf-card-author">
          <span>{text("Автор", "Creator")}</span>
          <CreatorAddress value={project.creatorAddress} />
        </p>
        <div className="pf-card-amount">
          <strong>{amount(funds)}</strong>
          <span>
            {hasGoal
              ? text("из ", "of ") + amount(project.goalLamports)
              : text("В хранилище проекта", "In the project vault")}
          </span>
        </div>
        {hasGoal && (
          <div
            className="pf-progress"
            role="progressbar"
            aria-label={text("Прогресс сбора", "Funding progress")}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: progress + "%" }} />
          </div>
        )}
        {BigInt(project.totalRefundedLamports) > 0n && (
          <p className="pf-card-refunded">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>
              {text("Возвращено: ", "Refunded: ") +
                amount(project.totalRefundedLamports)}
            </span>
          </p>
        )}
        {support && (
          <dl className="pf-card-personal">
            <div>
              <dt>
                {personal
                  ? text("Ваш взнос", "Your contribution")
                  : text("Взнос участника", "Participant contribution")}
              </dt>
              <dd>{amount(support.totalContributedLamports)}</dd>
            </div>
            <div>
              <dt>
                {personal
                  ? text("Вам возвращено", "Refunded to you")
                  : text("Возвращено участнику", "Refunded to participant")}
              </dt>
              <dd>{amount(support.totalRefundedLamports)}</dd>
            </div>
            <div>
              <dt>
                {personal
                  ? text("Ваши средства в проекте", "Your funds in the project")
                  : text(
                      "Средства участника в проекте",
                      "Participant funds in the project",
                    )}
              </dt>
              <dd>{amount(support.refundableLamports)}</dd>
            </div>
          </dl>
        )}
        <Link
          className="of-button secondary pf-card-action"
          href={"/projects/" + project.campaignAddress}
        >
          <span>{text("Открыть проект", "Open project")}</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function ProjectGrid({
  projects,
  loading,
  empty,
  support,
  personal = true,
}: {
  projects: ProjectSummary[];
  loading: boolean;
  empty?: string;
  support?: Record<string, ProjectBacker>;
  personal?: boolean;
}) {
  const { text } = usePlatform();
  if (loading && projects.length === 0)
    return (
      <div className="pf-grid" aria-busy="true">
        {[1, 2, 3].map((item) => (
          <div className="pf-skeleton" key={item}>
            <span>{text("Загружаем проекты…", "Loading projects…")}</span>
          </div>
        ))}
      </div>
    );
  if (projects.length === 0)
    return (
      <div className="pf-empty">
        <Sparkles size={30} aria-hidden="true" />
        <h2>
          <span>{empty || text("Пока нет проектов", "No projects yet")}</span>
        </h2>
        <p>
          <span>
            {text(
              "Создайте проект и поделитесь ссылкой со своими спонсорами.",
              "Create a project and share its link with your sponsors.",
            )}
          </span>
        </p>
        <Link className="of-button" href="/create">
          <span>{text("Создать проект", "Create project")}</span>
        </Link>
      </div>
    );
  return (
    <div className="pf-grid">
      {projects.map((project) => (
        <ProjectCard
          project={project}
          support={support?.[project.campaignAddress]}
          personal={personal}
          key={project.campaignAddress}
        />
      ))}
    </div>
  );
}

export function PlatformHome() {
  const { text } = usePlatform();
  const catalog = useCatalog();
  return (
    <>
      <section className="of-hero pf-hero">
        <div className="of-container of-hero-grid">
          <div className="of-hero-copy">
            <span className="of-eyebrow">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                {text(
                  "ИДЕИ, КОТОРЫЕ МЫ СОЗДАЁМ ВМЕСТЕ",
                  "IDEAS WE BUILD TOGETHER",
                )}
              </span>
            </span>
            <h1>
              <span>{text("Большие идеи.", "Big ideas.")}</span>
              <br />
              <span>{text("Общая поддержка.", "Shared support.")}</span>
            </h1>
            <p className="of-hero-lede">
              <span>
                {text(
                  "От проекта до первого спонсора — всё в одном месте.",
                  "From your idea to your first sponsor — all in one place.",
                )}
              </span>
            </p>
            <p className="of-hero-description">
              <span>
                {text(
                  "Создайте проект. Соберите тестовые SOL. Общайтесь с участниками и следите за каждым взносом.",
                  "Create a project. Raise test SOL. Talk with your community and follow every contribution.",
                )}
              </span>
            </p>
            <div className="of-hero-actions">
              <Link className="of-button" href="/projects">
                <span>{text("Найти проект", "Explore projects")}</span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link className="of-button secondary" href="/create">
                <span>{text("Создать проект", "Create project")}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <NetworkNote />
          </div>
          <div className="of-hero-visual">
            <div className="of-visual-grid" />
            <div className="of-hero-logo-card">
              <img src="/images/openfunds-logo.png" alt="OpenFunds" />
              <span className="of-visual-label">
                {text(
                  "ПОНЯТНЫЕ ВЗНОСЫ. ОБЩИЕ ДАННЫЕ.",
                  "VISIBLE CONTRIBUTIONS. SHARED DATA.",
                )}
              </span>
              <div className="of-visual-progress">
                <span />
                <span />
                <span />
              </div>
              <div className="of-visual-milestone">
                <span>
                  <ShieldCheck size={18} aria-hidden="true" />
                  {text("Средства в хранилище", "Funds in the vault")}
                </span>
                <strong>
                  {text("Подтверждено в Devnet", "Confirmed on Devnet")}
                </strong>
              </div>
            </div>
            <div className="of-float-card of-float-top">
              <Users size={20} aria-hidden="true" />
              <div>
                <strong>
                  {text("Поддержка людей", "People-powered support")}
                </strong>
                <span>{text("С любого устройства", "Across devices")}</span>
              </div>
            </div>
            <div className="of-float-card of-float-bottom">
              <HeartHandshake size={23} aria-hidden="true" />
              <div>
                <strong>
                  {text("Понятный путь средств", "A clear path for funds")}
                </strong>
                <span>
                  {text(
                    "Взнос → хранилище → возврат",
                    "Contribution → vault → refund",
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="of-container of-section">
        <div className="of-section-heading">
          <div>
            <p className="of-eyebrow">
              {text("СОЗДАНО УЧАСТНИКАМИ", "CREATED BY THE COMMUNITY")}
            </p>
            <h2>
              <span>
                {text(
                  "Проекты, которым можно помочь",
                  "Projects you can support",
                )}
              </span>
            </h2>
          </div>
          <Link className="of-text-link" href="/projects">
            <span>{text("Все проекты", "All projects")}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        {catalog.error && (
          <Notice kind="error">
            {catalog.error}
            <button
              className="pf-inline-button"
              onClick={() => void catalog.refresh()}
            >
              {text("Повторить", "Retry")}
            </button>
          </Notice>
        )}
        <ProjectGrid
          projects={catalog.projects
            .filter((project) => !project.closed)
            .slice(0, 3)}
          loading={catalog.loading}
        />
      </section>
      <section className="pf-how" id="how-it-works">
        <div className="of-container">
          <div className="of-centered-heading">
            <p className="of-eyebrow">
              {text("КАК ЭТО РАБОТАЕТ", "HOW IT WORKS")}
            </p>
            <h2>
              <span>
                {text(
                  "Сначала идея. Затем — поддержка.",
                  "An idea first. Support next.",
                )}
              </span>
            </h2>
          </div>
          <div className="pf-steps">
            {[
              {
                icon: Sparkles,
                title: text("Создайте проект", "Create your project"),
                body: text(
                  "Подключите кошелёк, расскажите об идее и подтвердите создание.",
                  "Connect your wallet, describe your idea and confirm creation.",
                ),
              },
              {
                icon: Users,
                title: text("Пригласите спонсоров", "Invite your sponsors"),
                body: text(
                  "Поделитесь ссылкой. Каждый участник видит один проект и общие данные.",
                  "Share the link. Every participant sees the same project and shared data.",
                ),
              },
              {
                icon: ShieldCheck,
                title: text("Следите за средствами", "Follow the funds"),
                body: text(
                  "Взносы поступают в хранилище проекта. При закрытии доступны возвраты спонсорам.",
                  "Contributions reach the project vault. Closing enables refunds to sponsors.",
                ),
              },
            ].map((step) => (
              <article className="pf-step" key={step.title}>
                <step.icon size={25} aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function PlatformCatalog() {
  const { text } = usePlatform();
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("open");
  const filtered = catalog.projects.filter(
    (project) =>
      (status === "all" ||
        (status === "open" ? !project.closed : project.closed)) &&
      (project.title + " " + project.description + " " + project.creatorAddress)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">OPENFUNDS · DEVNET</p>
          <h1>
            <span>{text("Проекты сообщества", "Community projects")}</span>
          </h1>
          <p>
            <span>
              {text(
                "Реальные кампании, тестовые средства и общая история на всех устройствах.",
                "Real campaigns, test funds and shared history across devices.",
              )}
            </span>
          </p>
        </div>
        <Link className="of-button" href="/create">
          <Sparkles size={17} aria-hidden="true" />
          <span>{text("Создать проект", "Create project")}</span>
        </Link>
      </div>
      <NetworkNote />
      <div className="pf-toolbar">
        <label className="pf-search">
          <Search size={18} aria-hidden="true" />
          <span className="pf-sr-only">
            {text("Поиск проектов", "Search projects")}
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text(
              "Название, описание или адрес автора",
              "Title, description or creator address",
            )}
          />
        </label>
        <label className="pf-select">
          <span className="pf-sr-only">
            {text("Статус проекта", "Project status")}
          </span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="open">{text("Открытые", "Open projects")}</option>
            <option value="closed">
              {text("Закрытые", "Closed projects")}
            </option>
            <option value="all">{text("Все проекты", "All projects")}</option>
          </select>
        </label>
        <button
          className="of-button secondary"
          onClick={() => void catalog.refresh()}
          disabled={catalog.loading}
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>{text("Обновить", "Refresh")}</span>
        </button>
      </div>
      {catalog.error && <Notice kind="error">{catalog.error}</Notice>}
      <ProjectGrid
        projects={filtered}
        loading={catalog.loading}
        empty={
          query
            ? text(
                "По вашему запросу ничего не найдено",
                "No projects match your search",
              )
            : undefined
        }
      />
    </section>
  );
}

export function PlatformCreate() {
  const {
    text,
    walletAddress,
    walletBusy,
    projectGateway,
    ledger,
    operationBusy,
    runOperation,
    refreshWallet,
  } = usePlatform();
  const router = useRouter();
  const [capability, setCapability] = useState<Capability | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [goal, setGoal] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submittedReceipt, setSubmittedReceipt] = useState<string | null>(null);
  const [createdAddress, setCreatedAddress] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  useEffect(() => {
    let active = true;
    if (ledger)
      void ledger
        .readCapabilities()
        .then((value) => {
          if (active) setCapability(value);
        })
        .catch((cause) => {
          if (active) setError(fail(cause, text));
        });
    return () => {
      active = false;
    };
  }, [ledger, text]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (
      !projectGateway ||
      !walletAddress ||
      !capability?.available ||
      awaitingConfirmation
    )
      return;
    try {
      const values = {
        title: title.trim(),
        description: description.trim(),
        imageUrl: imageUrl.trim(),
      };
      if (!values.title || utf8Length(values.title) > 80)
        throw new Error(
          text(
            "Название: от 1 до 80 байт UTF-8. Сократите текст.",
            "Title must be 1–80 UTF-8 bytes. Please shorten it.",
          ),
        );
      if (!values.description || utf8Length(values.description) > 400)
        throw new Error(
          text(
            "Описание: от 1 до 400 байт UTF-8. Сократите текст.",
            "Description must be 1–400 UTF-8 bytes. Please shorten it.",
          ),
        );
      if (
        values.imageUrl &&
        (!values.imageUrl.startsWith("https://") ||
          utf8Length(values.imageUrl) > 200)
      )
        throw new Error(
          text(
            "Укажите HTTPS-ссылку на изображение, не длиннее 200 байт.",
            "Use an HTTPS image URL of at most 200 bytes.",
          ),
        );
      if (values.imageUrl) {
        const parsed = new URL(values.imageUrl);
        if (parsed.username || parsed.password)
          throw new Error(
            text(
              "Ссылка на изображение не должна содержать пароль.",
              "The image URL must not contain credentials.",
            ),
          );
      }
      const goalLamports = parseSol(goal);
      const random = crypto.getRandomValues(new Uint32Array(2));
      const campaignId = (
        (BigInt(random[0]) << 32n) + BigInt(random[1]) || 1n
      ).toString();
      setPending(true);
      const addresses = await deriveProjectAddresses(walletAddress, campaignId);
      setCreatedAddress(addresses.campaignAddress);
      setSubmittedReceipt(null);
      const result = await runOperation(() =>
        projectGateway.initializeProject({
          ...values,
          campaignId,
          goalLamports,
        }),
      );
      await refreshWallet();
      router.push("/projects/" + result.campaignAddress);
    } catch (cause) {
      if (cause instanceof TransactionConfirmationError) {
        setSubmittedReceipt(cause.signature);
        setAwaitingConfirmation(cause.state === "pending");
      }
      setError(fail(cause, text));
    } finally {
      setPending(false);
    }
  }
  async function checkCreation() {
    if (!projectGateway || !submittedReceipt) return;
    setPending(true);
    try {
      const state =
        await projectGateway.readTransactionStatus(submittedReceipt);
      if (state === "confirmed") {
        setAwaitingConfirmation(false);
        setError(null);
        await refreshWallet();
        if (createdAddress) router.push("/projects/" + createdAddress);
      } else if (state === "failed") {
        setAwaitingConfirmation(false);
        setError(
          text(
            "Сеть отклонила создание. Проект не опубликован.",
            "The network rejected creation. The project was not published.",
          ),
        );
      } else
        setError(
          text(
            "Транзакция отправлена, но подтверждение ещё не получено. Не отправляйте её повторно.",
            "The transaction was submitted but has not been confirmed yet. Do not submit it again.",
          ),
        );
    } catch (cause) {
      setError(fail(cause, text));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">
            {text("ОТ ИДЕИ К ПОДДЕРЖКЕ", "FROM IDEA TO SUPPORT")}
          </p>
          <h1>
            <span>{text("Создать проект", "Create a project")}</span>
          </h1>
          <p>
            <span>
              {text(
                "После подтверждения проект появится в общем каталоге.",
                "After confirmation, your project appears in the shared catalogue.",
              )}
            </span>
          </p>
        </div>
      </div>
      <NetworkNote />
      {!walletAddress ? (
        <WalletPrompt />
      ) : (
        <div className="pf-create-grid">
          <form
            className="pf-panel pf-editor"
            onSubmit={(event) => void create(event)}
          >
            <h2>
              <span>
                {text("Расскажите о своей идее", "Tell us about your idea")}
              </span>
            </h2>
            <p className="pf-muted">
              <span>{text("Автор проекта", "Project creator")}</span>{" "}
              <PublicAddress value={walletAddress} />
            </p>
            {capability && !capability.available && <UpgradeNote />}
            {error && (
              <Notice kind={awaitingConfirmation ? "info" : "error"}>
                <span>{error}</span>
                {submittedReceipt && (
                  <TransactionLink value={submittedReceipt} />
                )}
                {awaitingConfirmation && (
                  <button
                    type="button"
                    className="pf-inline-button"
                    disabled={pending}
                    onClick={() => void checkCreation()}
                  >
                    <span>
                      {text("Проверить подтверждение", "Check confirmation")}
                    </span>
                  </button>
                )}
              </Notice>
            )}
            <label className="pf-field">
              <span>{text("Название проекта", "Project title")}</span>
              <input
                required
                aria-label={text("Название проекта", "Project title")}
                aria-describedby="project-title-bytes"
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={text(
                  "Например: обучение для каждого",
                  "For example: learning for everyone",
                )}
              />
              <small id="project-title-bytes">
                {utf8Length(title)} / 80 {text("байт", "bytes")}
              </small>
            </label>
            <label className="pf-field">
              <span>{text("Описание", "Description")}</span>
              <textarea
                required
                aria-label={text("Описание", "Description")}
                aria-describedby="project-description-bytes"
                value={description}
                maxLength={400}
                rows={5}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={text(
                  "Что вы создаёте и кому это поможет?",
                  "What are you building and who will it help?",
                )}
              />
              <small id="project-description-bytes">
                {utf8Length(description)} / 400 {text("байт", "bytes")}
              </small>
            </label>
            <label className="pf-field">
              <span>
                {text(
                  "Изображение — ссылка HTTPS (необязательно)",
                  "Image — HTTPS URL (optional)",
                )}
              </span>
              <input
                type="url"
                value={imageUrl}
                maxLength={200}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://…"
              />
              <small>
                {text(
                  "Без ссылки используем обложку OpenFunds. Само изображение хранится по указанной ссылке.",
                  "Without a URL, an OpenFunds cover is used. The image itself remains hosted at that URL.",
                )}
              </small>
            </label>
            <label className="pf-field">
              <span>
                {text("Цель сбора, тестовые SOL", "Funding goal, test SOL")}
              </span>
              <input
                required
                inputMode="decimal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            <Notice>
              <span>
                {text(
                  "Название и описание будут публично сохранены в Solana. Phantom покажет комиссию и расходы на хранение. Публикация подтверждается вашим кошельком.",
                  "The title and description are stored publicly on Solana. Phantom shows transaction fees and account storage costs. Publication is confirmed by your wallet.",
                )}
              </span>
            </Notice>
            <button
              className="of-button pf-full-button"
              type="submit"
              disabled={
                !capability?.available ||
                operationBusy ||
                walletBusy ||
                pending ||
                awaitingConfirmation
              }
            >
              <span>
                {pending
                  ? text("Подтвердите в Phantom…", "Confirm in Phantom…")
                  : text("Опубликовать проект", "Publish project")}
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          <aside className="pf-panel pf-create-preview">
            <div className="pf-preview-label">
              <ImagePlus size={18} aria-hidden="true" />
              <span>{text("Предпросмотр", "Preview")}</span>
            </div>
            <img
              src={
                imageUrl.startsWith("https://")
                  ? imageUrl
                  : "/images/project-community.svg"
              }
              referrerPolicy="no-referrer"
              alt=""
            />
            <h2>
              {title || text("Ваш будущий проект", "Your future project")}
            </h2>
            <p>
              {description ||
                text(
                  "Здесь будет описание вашей идеи.",
                  "Your idea's description appears here.",
                )}
            </p>
            <div className="pf-card-amount">
              <strong>0 SOL</strong>
              <span>
                {text(
                  "Новая кампания начинается без взносов",
                  "A new campaign starts without contributions",
                )}
              </span>
            </div>
            <div className="pf-flow">
              <span>{text("Спонсор", "Sponsor")}</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>{text("Хранилище проекта", "Project vault")}</span>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

export function PlatformDashboard() {
  const { walletAddress } = usePlatform();
  return <DashboardContent key={walletAddress ?? "disconnected"} />;
}

function DashboardContent() {
  const platform = usePlatform();
  const { text, walletAddress, walletBalance, ledger } = platform;
  const catalog = useCatalog();
  const [supported, setSupported] = useState<string[]>([]);
  const [supportRecords, setSupportRecords] = useState<
    Record<string, ProjectBacker>
  >({});
  const [supportAmounts, setSupportAmounts] = useState<Record<string, string>>(
    {},
  );
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [tab, setTab] = useState("own");
  useEffect(() => {
    let active = true;
    if (!ledger || !walletAddress || catalog.loading)
      return () => {
        active = false;
      };
    void ledger
      .listMyContributions(walletAddress)
      .then((rows) => {
        if (!active) return;
        setSupportError(null);
        const amounts: Record<string, string> = {};
        const records: Record<string, ProjectBacker> = {};
        rows.forEach((row) => {
          if (row && BigInt(row.totalContributedLamports) > 0n)
            amounts[row.campaignAddress] = (
              BigInt(row.totalContributedLamports) -
              BigInt(row.totalRefundedLamports)
            ).toString();
        });
        rows.forEach((row) => {
          if (row && BigInt(row.totalContributedLamports) > 0n)
            records[row.campaignAddress] = row;
        });
        setSupportRecords(records);
        setSupported(Object.keys(amounts));
        setSupportAmounts(amounts);
      })
      .catch((cause) => {
        if (active) setSupportError(fail(cause, text));
      })
      .finally(() => {
        if (active) setSupportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledger, walletAddress, text, catalog.revision, catalog.loading]);
  const own = catalog.projects.filter(
    (project) => project.creatorAddress === walletAddress,
  );
  const joined = catalog.projects.filter((project) =>
    supported.includes(project.campaignAddress),
  );
  const total = Object.values(supportAmounts)
    .reduce((sum, value) => sum + BigInt(value), 0n)
    .toString();
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">
            {text("ВАШЕ УЧАСТИЕ", "YOUR PARTICIPATION")}
          </p>
          <h1>
            <span>{text("Мой кабинет", "My dashboard")}</span>
          </h1>
          <p>
            <span>
              {text(
                "Проекты и взносы выбранного кошелька.",
                "Projects and contributions for the selected wallet.",
              )}
            </span>
          </p>
        </div>
        <button
          className="of-button secondary"
          onClick={() => {
            void catalog.refresh();
            void platform.refreshWallet();
          }}
          disabled={catalog.loading}
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>{text("Обновить", "Refresh")}</span>
        </button>
      </div>
      <NetworkNote />
      {!walletAddress ? (
        <WalletPrompt />
      ) : (
        <>
          <div className="pf-stats">
            <div>
              <span>{text("Баланс кошелька", "Wallet balance")}</span>
              <strong>
                {walletBalance === null ? "—" : amount(walletBalance)}
              </strong>
              <PublicAddress value={walletAddress} />
            </div>
            <div>
              <span>{text("Мои проекты", "My projects")}</span>
              <strong>{catalog.loading ? "…" : own.length}</strong>
              <span>{text("Для этого аккаунта", "For this account")}</span>
            </div>
            <div>
              <span>
                {text("Мои средства в проектах", "My funds in projects")}
              </span>
              <strong>
                {supportLoading || supportError ? "—" : amount(total)}
              </strong>
              <span>
                {text(
                  "После подтверждённых возвратов",
                  "After confirmed refunds",
                )}
              </span>
            </div>
          </div>
          <div
            className="pf-tabs"
            role="tablist"
            aria-label={text("Раздел кабинета", "Dashboard section")}
          >
            <button
              role="tab"
              aria-selected={tab === "own"}
              onClick={() => setTab("own")}
            >
              <span>{text("Мои проекты", "My projects")}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "support"}
              onClick={() => setTab("support")}
            >
              <span>{text("Поддержанные проекты", "Supported projects")}</span>
            </button>
          </div>
          {catalog.error && <Notice kind="error">{catalog.error}</Notice>}
          {supportError && <Notice kind="error">{supportError}</Notice>}
          <ProjectGrid
            projects={tab === "own" ? own : joined}
            support={tab === "support" ? supportRecords : undefined}
            loading={catalog.loading || (tab === "support" && supportLoading)}
            empty={
              tab === "own"
                ? text("У вас пока нет проектов", "You have no projects yet")
                : text(
                    "Вы пока не поддержали проекты",
                    "You have not supported any projects yet",
                  )
            }
          />
        </>
      )}
    </section>
  );
}

type DetailData = {
  project: ProjectSummary;
  backers: ProjectBacker[];
  messages: ProjectMessage[];
  activity: ProjectActivity[];
  activityBefore: string | null;
  activityMore: boolean;
  capability: Capability;
  messagesError: string | null;
  activityError: string | null;
};

function useProject(campaignAddress: string) {
  const { ledger, refreshKey, text } = usePlatform();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const readingRef = useRef(false);
  const invalidate = useCallback(() => {
    epoch.current += 1;
  }, []);
  const refresh = useCallback(async () => {
    if (!ledger) return;
    const reading = ++epoch.current;
    readingRef.current = true;
    try {
      const [project, backers, capability] = await Promise.all([
        ledger.readProject(campaignAddress),
        ledger.listBackers(campaignAddress),
        ledger.readCapabilities(),
      ]);
      const [messages, activity] = await Promise.allSettled([
        ledger.listMessages(campaignAddress),
        ledger.listActivity(campaignAddress),
      ]);
      if (reading !== epoch.current) return;
      setError(null);
      setData({
        project,
        backers,
        capability,
        messages: messages.status === "fulfilled" ? messages.value : [],
        messagesError:
          messages.status === "rejected" ? fail(messages.reason, text) : null,
        activity: activity.status === "fulfilled" ? activity.value.items : [],
        activityBefore:
          activity.status === "fulfilled" ? activity.value.nextBefore : null,
        activityMore:
          activity.status === "fulfilled" ? activity.value.hasMore : false,
        activityError:
          activity.status === "rejected" ? fail(activity.reason, text) : null,
      });
    } catch (cause) {
      if (reading === epoch.current) setError(fail(cause, text));
    } finally {
      readingRef.current = false;
      if (reading === epoch.current) setLoading(false);
    }
  }, [ledger, campaignAddress, text]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [refresh, refreshKey, invalidate]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !readingRef.current)
        void refresh();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { data, loading, error, refresh, setData };
}

function DetailActivity({
  data,
  onMore,
}: {
  data: DetailData;
  onMore: () => Promise<void>;
}) {
  const { text, locale } = usePlatform();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels: Record<ProjectActivity["kind"], string> = {
    initialize: text("Проект создан", "Project created"),
    contribution: text("Взнос", "Contribution"),
    close: text("Сбор закрыт", "Funding closed"),
    refund: text("Возврат спонсору", "Sponsor refund"),
    message: text("Сообщение в чате", "Chat message"),
    unavailable: text("Операция", "Operation"),
  };
  return (
    <div className="pf-panel">
      <h2>
        <span>{text("История операций", "Transaction history")}</span>
      </h2>
      <p className="pf-muted">
        <span>
          {text(
            "Подтверждения читаются из Solana. История сохраняется после закрытия проекта.",
            "Confirmations are read from Solana. History remains after project closure.",
          )}
        </span>
      </p>
      {data.activityError && <Notice kind="error">{data.activityError}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {data.activity.length === 0 && !data.activityError && (
        <p className="pf-empty-line">
          <span>
            {text("История ещё не доступна.", "History is not available yet.")}
          </span>
        </p>
      )}
      <div className="pf-activity-list">
        {data.activity.map((item) => (
          <article className="pf-activity" key={item.signature}>
            <span
              className={
                "pf-activity-icon " +
                (item.status === "failed"
                  ? "failed"
                  : item.status === "unavailable"
                    ? "unavailable"
                    : "")
              }
            >
              {item.status === "failed" || item.status === "unavailable" ? (
                <Clock size={17} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={17} aria-hidden="true" />
              )}
            </span>
            <div>
              <strong>{labels[item.kind]}</strong>
              <span>
                {item.kind === "refund" && item.recipientAddress
                  ? text("Возврат на ", "Returned to ") +
                    short(item.recipientAddress)
                  : item.actorAddress
                    ? short(item.actorAddress)
                    : text("Адрес не подтверждён", "Address unavailable")}
              </span>
              <small>
                {item.blockTime
                  ? new Date(item.blockTime * 1000).toLocaleString(
                      locale === "ru" ? "ru-RU" : "en-US",
                    )
                  : text("Время недоступно", "Time unavailable")}
              </small>
              <TransactionLink value={item.signature} />
            </div>
            <div className="pf-activity-value">
              <strong>
                {item.amountLamports === null
                  ? "—"
                  : amount(item.amountLamports)}
              </strong>
              <span>
                {item.status === "failed"
                  ? text("Отклонено", "Failed")
                  : item.status === "unavailable"
                    ? text("Не проверено", "Unverified")
                    : text("Подтверждено", "Confirmed")}
              </span>
              {item.feeLamports !== null && (
                <small>
                  {text("Комиссия: ", "Fee: ") + amount(item.feeLamports)}
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
      {data.activityMore && (
        <button
          className="of-button secondary"
          disabled={loadingMore}
          onClick={() => {
            setLoadingMore(true);
            setError(null);
            void onMore()
              .catch((cause) => setError(fail(cause, text)))
              .finally(() => setLoadingMore(false));
          }}
        >
          <span>
            {loadingMore
              ? text("Загружаем…", "Loading…")
              : text("Показать ещё", "Show more")}
          </span>
        </button>
      )}
    </div>
  );
}

export function PlatformProject({
  campaignAddress,
}: {
  campaignAddress: string;
}) {
  const { walletAddress } = usePlatform();
  return (
    <ProjectContent
      key={campaignAddress + ":" + (walletAddress ?? "disconnected")}
      campaignAddress={campaignAddress}
    />
  );
}

function ProjectContent({ campaignAddress }: { campaignAddress: string }) {
  const platform = usePlatform();
  const {
    text,
    locale,
    walletAddress,
    walletBalance,
    ledger,
    projectGateway,
    operationBusy,
    runOperation,
    refreshWallet,
  } = platform;
  const detail = useProject(campaignAddress);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [tab, setTab] = useState("overview");
  const [contribution, setContribution] = useState("0.1");
  const [body, setBody] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [closeConfirmation, setCloseConfirmation] = useState(false);
  const [refundProgress, setRefundProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const data = detail.data;
  const project = data?.project;
  const isCreator = Boolean(
    walletAddress && project?.creatorAddress === walletAddress,
  );
  const ownSupport = data?.backers.find(
    (backer) => backer.backerAddress === walletAddress,
  );
  async function perform(
    name: string,
    action: () => Promise<{ signature: string }>,
    resultText: string,
  ) {
    if (awaitingConfirmation) return false;
    setError(null);
    setSuccess(null);
    setReceipt(null);
    setOperation(name);
    try {
      const result = await runOperation(action);
      setReceipt(result.signature);
      setSuccess(resultText);
      await Promise.all([detail.refresh(), refreshWallet()]);
      return true;
    } catch (cause) {
      if (cause instanceof TransactionConfirmationError) {
        setReceipt(cause.signature);
        setAwaitingConfirmation(cause.state === "pending");
        setPendingAction(name);
      }
      setError(fail(cause, text));
      return false;
    } finally {
      setOperation(null);
    }
  }
  async function contribute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectGateway || !walletAddress || !project || project.closed) return;
    let lamports: string;
    try {
      lamports = parseSol(contribution);
    } catch {
      setError(
        text(
          "Введите сумму больше 0 SOL, до 9 знаков после точки.",
          "Enter an amount greater than 0 SOL with up to 9 decimal places.",
        ),
      );
      return;
    }
    await perform(
      "contribute",
      () => projectGateway.contribute(campaignAddress, lamports),
      text(
        "Взнос подтверждён. Средства поступили в хранилище проекта.",
        "Contribution confirmed. Funds reached the project vault.",
      ),
    );
  }
  async function close() {
    if (!projectGateway || !isCreator || !data?.capability.available) return;
    const closed = await perform(
      "close",
      () => projectGateway.closeProject(campaignAddress),
      text(
        "Сбор закрыт. Теперь можно вернуть взносы спонсорам.",
        "Funding is closed. Sponsor contributions can now be refunded.",
      ),
    );
    if (closed) await refundAll();
    setCloseConfirmation(false);
  }
  async function refundAll(confirmedPending = false) {
    if (
      !projectGateway ||
      !ledger ||
      !isCreator ||
      !data?.capability.available ||
      (awaitingConfirmation && !confirmedPending)
    )
      return;
    setError(null);
    setSuccess(null);
    setReceipt(null);
    setOperation("refund");
    const expectedCreator = walletAddress;
    function assertBatchSession() {
      if (!mountedRef.current)
        throw new Error(
          text(
            "Возврат остановлен после выхода со страницы.",
            "Refund processing stopped after leaving the page.",
          ),
        );
      if (
        !expectedCreator ||
        projectGateway?.connectedAddress !== expectedCreator
      )
        throw new Error(
          text(
            "Аккаунт кошелька изменился. Подключите автора и продолжите возврат.",
            "The wallet account changed. Reconnect the creator to continue refunds.",
          ),
        );
    }
    try {
      await runOperation(async () => {
        assertBatchSession();
        const latestProject = await ledger.readProject(campaignAddress);
        if (!latestProject.closed)
          throw new Error(
            text(
              "Сначала закройте сбор проекта.",
              "Close project funding first.",
            ),
          );
        const refundable = (await ledger.listBackers(campaignAddress)).filter(
          (backer) => BigInt(backer.refundableLamports) > 0n,
        );
        setRefundProgress({ done: 0, total: refundable.length });
        for (let index = 0; index < refundable.length; index++) {
          assertBatchSession();
          const result = await projectGateway.refund(
            campaignAddress,
            refundable[index].backerAddress,
          );
          setReceipt(result.signature);
          setRefundProgress({ done: index + 1, total: refundable.length });
          await detail.refresh();
        }
        assertBatchSession();
        const completed = await ledger.readProject(campaignAddress);
        if (
          completed.status === "refunded" &&
          BigInt(completed.totalRefundedLamports) ===
            BigInt(completed.totalContributedLamports)
        ) {
          setSuccess(
            text(
              "Все оставшиеся взносы возвращены спонсорам.",
              "All outstanding contributions have been refunded to sponsors.",
            ),
          );
        } else {
          setError(
            text(
              "Возвраты ещё не завершены. Обновите данные и продолжите для оставшихся спонсоров.",
              "Refunds are not complete yet. Refresh data and continue for the remaining sponsors.",
            ),
          );
        }
      });
      await refreshWallet();
    } catch (cause) {
      if (cause instanceof TransactionConfirmationError) {
        setReceipt(cause.signature);
        setAwaitingConfirmation(cause.state === "pending");
        setPendingAction("refund");
      }
      setError(
        text(
          "Возврат остановлен. Подтверждённые возвраты сохранены; нажмите продолжить для оставшихся. ",
          "Refund processing stopped. Confirmed refunds are retained; continue for the remaining sponsors. ",
        ) + fail(cause, text),
      );
      await detail.refresh();
    } finally {
      setOperation(null);
    }
  }
  async function post(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !projectGateway ||
      !walletAddress ||
      !data?.capability.available ||
      project?.closed
    )
      return;
    const content = body.trim();
    if (!content || utf8Length(content) > 240) {
      setError(
        text(
          "Сообщение должно содержать от 1 до 240 байт UTF-8.",
          "A message must contain 1–240 UTF-8 bytes.",
        ),
      );
      return;
    }
    const sent = await perform(
      "message",
      () => projectGateway.postMessage(campaignAddress, content),
      text(
        "Сообщение опубликовано и доступно участникам.",
        "Your message is published and available to participants.",
      ),
    );
    if (sent) setBody("");
  }
  async function checkSubmission() {
    if (!projectGateway || !receipt) return;
    setOperation("check");
    try {
      const state = await projectGateway.readTransactionStatus(receipt);
      if (state === "confirmed") {
        setAwaitingConfirmation(false);
        setError(null);
        setSuccess(
          text(
            "Транзакция подтверждена сетью. Данные обновлены.",
            "The transaction is confirmed by the network. Data has been refreshed.",
          ),
        );
        await Promise.all([detail.refresh(), refreshWallet()]);
        if (pendingAction === "message") setBody("");
        if (pendingAction === "close") await refundAll(true);
        setPendingAction(null);
      } else if (state === "failed") {
        setAwaitingConfirmation(false);
        setPendingAction(null);
        setError(
          text(
            "Сеть отклонила операцию. Взносы проекта не изменились. Сетевая комиссия может быть списана.",
            "The network rejected the operation. Project contributions did not change. A network fee may still have been charged.",
          ),
        );
      } else
        setError(
          text(
            "Транзакция отправлена, но подтверждение ещё не получено. Не отправляйте её повторно.",
            "The transaction was submitted but has not been confirmed yet. Do not submit it again.",
          ),
        );
    } catch (cause) {
      setError(fail(cause, text));
    } finally {
      setOperation(null);
    }
  }
  async function moreActivity() {
    if (!ledger || !detail.data?.activityBefore) return;
    const page = await ledger.listActivity(campaignAddress, {
      before: detail.data.activityBefore,
    });
    detail.setData((previous) =>
      previous
        ? {
            ...previous,
            activity: [
              ...previous.activity,
              ...page.items.filter(
                (item) =>
                  !previous.activity.some(
                    (old) => old.signature === item.signature,
                  ),
              ),
            ],
            activityBefore: page.nextBefore,
            activityMore: page.hasMore,
          }
        : previous,
    );
  }
  if (!project || !data)
    return (
      <section className="of-container of-page pf-page">
        <Link className="of-text-link" href="/projects">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>{text("Все проекты", "All projects")}</span>
        </Link>
        {detail.error ? (
          <Notice kind="error">
            {detail.error}
            <button
              className="pf-inline-button"
              onClick={() => void detail.refresh()}
            >
              {text("Повторить", "Retry")}
            </button>
          </Notice>
        ) : (
          <div className="pf-loading" role="status">
            <RefreshCw size={23} aria-hidden="true" />
            <span>
              {text(
                "Загружаем проект из Devnet…",
                "Loading the project from Devnet…",
              )}
            </span>
          </div>
        )}
      </section>
    );
  const funds = currentFunds(project);
  const hasGoal = BigInt(project.goalLamports) > 0n;
  const progress = hasGoal ? percentOf(funds, project.goalLamports) : 0;
  const refundEligible = project.closed && data.capability.available;
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-detail-topbar">
        <Link className="of-text-link" href="/projects">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>{text("Все проекты", "All projects")}</span>
        </Link>
        <button
          className="of-button secondary"
          onClick={() => void detail.refresh()}
          disabled={detail.loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>{text("Обновить данные", "Refresh data")}</span>
        </button>
      </div>
      <NetworkNote />
      {detail.error && <Notice kind="error">{detail.error}</Notice>}
      {error && (
        <Notice kind={awaitingConfirmation ? "info" : "error"}>
          <span>{error}</span>
          {receipt && !success && <TransactionLink value={receipt} />}
          {awaitingConfirmation && (
            <button
              className="pf-inline-button"
              disabled={operation === "check"}
              onClick={() => void checkSubmission()}
            >
              <span>
                {text("Проверить подтверждение", "Check confirmation")}
              </span>
            </button>
          )}
        </Notice>
      )}
      {success && (
        <Notice kind="success">
          <span>{success}</span>
          {receipt && <TransactionLink value={receipt} />}
        </Notice>
      )}
      {operation && (
        <Notice>
          <span>
            {operation === "check"
              ? text(
                  "Проверяем подтверждение сети…",
                  "Checking network confirmation…",
                )
              : operation === "refund" && refundProgress
                ? text("Возвращено спонсорам: ", "Sponsors refunded: ") +
                  refundProgress.done +
                  " / " +
                  refundProgress.total
                : text(
                    "Подтвердите операцию в Phantom. Дождитесь подтверждения сети.",
                    "Confirm the operation in Phantom and wait for network confirmation.",
                  )}
          </span>
        </Notice>
      )}
      <div className="pf-detail-grid">
        <div className="pf-detail-main">
          <div className="pf-detail-cover">
            <img src={cover(project)} alt="" referrerPolicy="no-referrer" />
            <Status project={project} />
          </div>
          <div className="pf-detail-heading">
            <h1>{projectTitle(project, text)}</h1>
            <div className="pf-author-line">
              <span className="pf-avatar">
                {project.creatorAddress.slice(0, 2)}
              </span>
              <div>
                <span>{text("Автор проекта", "Project creator")}</span>
                <CreatorAddress value={project.creatorAddress} />
              </div>
              <button
                className="of-button secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      window.location.origin + "/projects/" + campaignAddress,
                    )
                    .then(() =>
                      setSuccess(
                        text(
                          "Ссылка скопирована. Отправьте её спонсорам.",
                          "Link copied. Share it with sponsors.",
                        ),
                      ),
                    )
                    .catch(() =>
                      setError(
                        text(
                          "Не удалось скопировать. Скопируйте адрес из строки браузера.",
                          "Could not copy the link. Copy it from the browser address bar.",
                        ),
                      ),
                    );
                }}
              >
                <span>{text("Поделиться", "Share")}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            className="pf-tabs"
            role="tablist"
            aria-label={text("Раздел проекта", "Project section")}
          >
            {[
              { id: "overview", label: text("О проекте", "Overview") },
              { id: "backers", label: text("Спонсоры", "Sponsors") },
              { id: "activity", label: text("Операции", "Activity") },
              { id: "chat", label: text("Чат", "Discussion") },
            ].map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                <span>{item.label}</span>
                {item.id === "chat" && (
                  <MessageCircle size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <div className="pf-panel">
              <h2>
                <span>{text("Об этом проекте", "About this project")}</span>
              </h2>
              <p className="pf-description">
                {project.description ||
                  text(
                    "Этот проект создан до появления общих описаний. Его взносы и история читаются непосредственно из Solana.",
                    "This project predates shared descriptions. Its contributions and history are read directly from Solana.",
                  )}
              </p>
              <h3>
                <span>{text("Как движутся средства", "How funds move")}</span>
              </h3>
              <div className="pf-money-flow">
                <div>
                  <Wallet size={22} aria-hidden="true" />
                  <strong>{text("Кошелёк спонсора", "Sponsor wallet")}</strong>
                  <span>
                    {text("Подтверждает взнос", "Confirms contribution")}
                  </span>
                </div>
                <ArrowRight size={20} aria-hidden="true" />
                <div>
                  <ShieldCheck size={22} aria-hidden="true" />
                  <strong>{text("Хранилище проекта", "Project vault")}</strong>
                  <span>
                    {text("Хранит внесённые SOL", "Holds contributed SOL")}
                  </span>
                </div>
                <ArrowRight size={20} aria-hidden="true" />
                <div>
                  <HeartHandshake size={22} aria-hidden="true" />
                  <strong>{text("Возврат спонсору", "Sponsor refund")}</strong>
                  <span>
                    {text("После закрытия сбора", "After funding closes")}
                  </span>
                </div>
              </div>
              <p className="pf-muted">
                <span>
                  {text(
                    "Взнос не поступает на личный кошелёк автора. Обычный перевод на его адрес не считается взносом проекта.",
                    "Contributions do not reach the creator's personal wallet. A direct transfer to that address is not a project contribution.",
                  )}
                </span>
              </p>
              <details className="pf-technical">
                <summary>
                  <span>
                    {text(
                      "Адреса и состояние хранилища",
                      "Addresses and vault state",
                    )}
                  </span>
                </summary>
                <dl>
                  <div>
                    <dt>{text("Проект", "Project")}</dt>
                    <dd>
                      <PublicAddress value={campaignAddress} full />
                    </dd>
                  </div>
                  <div>
                    <dt>{text("Хранилище", "Vault")}</dt>
                    <dd>
                      <PublicAddress value={project.vaultAddress} full />
                    </dd>
                  </div>
                  <div>
                    <dt>{text("Баланс хранилища", "Vault balance")}</dt>
                    <dd>{amount(project.vaultBalanceLamports)}</dd>
                  </div>
                </dl>
                <p>
                  <span>
                    {text(
                      "Баланс хранилища включает резерв хранения аккаунта. Собранная сумма выше показывает только взносы после возвратов.",
                      "The vault balance includes account storage rent. Raised funds above show contributions after refunds.",
                    )}
                  </span>
                </p>
              </details>
              {project.legacy && (
                <Notice>
                  <span>
                    {text(
                      "Кампания предыдущей версии без общего описания. Её средства сохранены. Чат и возвраты доступны после активации обновления.",
                      "An earlier-version campaign without a shared description. Funds remain intact. Chat and refunds are available after upgrade activation.",
                    )}
                  </span>
                </Notice>
              )}
            </div>
          )}
          {tab === "backers" && (
            <div className="pf-panel">
              <h2>
                <span>{text("Спонсоры проекта", "Project sponsors")}</span>
              </h2>
              {data.backers.length === 0 ? (
                <p className="pf-empty-line">
                  {text(
                    "Станьте первым спонсором проекта.",
                    "Be this project's first sponsor.",
                  )}
                </p>
              ) : (
                <div className="pf-backer-list">
                  {data.backers.map((backer) => (
                    <article
                      className="pf-backer"
                      key={backer.contributionAddress}
                    >
                      <span className="pf-avatar">
                        {backer.backerAddress.slice(0, 2)}
                      </span>
                      <div>
                        <CreatorAddress value={backer.backerAddress} />
                        <small>
                          {backer.backerAddress === project.creatorAddress
                            ? text("Автор проекта", "Project creator")
                            : text("Спонсор", "Sponsor")}
                        </small>
                      </div>
                      <div className="pf-backer-amount">
                        <strong>
                          {amount(backer.totalContributedLamports)}
                        </strong>
                        <small>
                          {BigInt(backer.totalRefundedLamports) > 0n
                            ? text("Возвращено: ", "Refunded: ") +
                              amount(backer.totalRefundedLamports)
                            : text(
                                "Взнос подтверждён",
                                "Contribution confirmed",
                              )}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === "activity" && (
            <DetailActivity data={data} onMore={moreActivity} />
          )}
          {tab === "chat" && (
            <div className="pf-panel">
              <h2>
                <span>{text("Обсуждение проекта", "Project discussion")}</span>
              </h2>
              <p className="pf-muted">
                <span>
                  {text(
                    "Общий чат автора и спонсоров. Сообщения публичны и сохраняются в Solana.",
                    "A shared discussion for creators and sponsors. Messages are public and stored on Solana.",
                  )}
                </span>
              </p>
              {!data.capability.available ? (
                <UpgradeNote />
              ) : (
                <>
                  {data.messagesError && (
                    <Notice kind="error">{data.messagesError}</Notice>
                  )}
                  <div className="pf-chat-list">
                    {data.messages.length === 0 ? (
                      <p className="pf-empty-line">
                        {text(
                          "Начните обсуждение проекта.",
                          "Start this project's discussion.",
                        )}
                      </p>
                    ) : (
                      data.messages.map((message) => (
                        <article
                          className={
                            "pf-chat-message " +
                            (message.authorAddress === walletAddress
                              ? "own"
                              : "")
                          }
                          key={message.messageAddress}
                        >
                          <div>
                            <PublicAddress value={message.authorAddress} />
                            <span className="pf-badge">
                              {message.authorAddress === project.creatorAddress
                                ? text("Автор", "Creator")
                                : text("Спонсор", "Sponsor")}
                            </span>
                          </div>
                          <p>{message.body}</p>
                          <small>
                            {new Date(
                              Number(message.createdAt) * 1000,
                            ).toLocaleString(
                              locale === "ru" ? "ru-RU" : "en-US",
                            )}
                          </small>
                        </article>
                      ))
                    )}
                  </div>
                  {!walletAddress ? (
                    <WalletPrompt />
                  ) : project.closed ? (
                    <Notice>
                      {text(
                        "Проект закрыт. Чат сохранён для просмотра; новые сообщения не публикуются.",
                        "The project is closed. The discussion remains readable; new messages cannot be posted.",
                      )}
                    </Notice>
                  ) : !isCreator && !ownSupport ? (
                    <Notice>
                      {text(
                        "Чат доступен автору и спонсорам этого проекта. Поддержите проект, чтобы присоединиться.",
                        "Discussion is available to this project's creator and sponsors. Contribute to join.",
                      )}
                    </Notice>
                  ) : (
                    <form
                      className="pf-chat-form"
                      onSubmit={(event) => void post(event)}
                    >
                      <label className="pf-field">
                        <span>{text("Ваше сообщение", "Your message")}</span>
                        <textarea
                          aria-label={text("Ваше сообщение", "Your message")}
                          aria-describedby="project-message-bytes"
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          maxLength={240}
                          rows={3}
                          placeholder={text(
                            "Задайте вопрос или поделитесь новостью",
                            "Ask a question or share an update",
                          )}
                        />
                        <small id="project-message-bytes">
                          {utf8Length(body)} / 240 {text("байт", "bytes")}
                        </small>
                      </label>
                      <p className="pf-muted">
                        <span>
                          {text(
                            "Публикация требует подтверждения Phantom и оплачивает комиссию и хранение сообщения тестовыми SOL.",
                            "Posting requires Phantom confirmation and pays transaction and message storage costs in test SOL.",
                          )}
                        </span>
                      </p>
                      <button
                        className="of-button"
                        disabled={
                          awaitingConfirmation || operationBusy || !body.trim()
                        }
                        type="submit"
                      >
                        <MessageCircle size={16} aria-hidden="true" />
                        <span>
                          {text("Опубликовать сообщение", "Post message")}
                        </span>
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <aside className="pf-detail-aside">
          <div className="pf-panel pf-funding">
            <Status project={project} />
            <span className="pf-metric-label">
              {text("Сейчас в проекте", "Currently in the project")}
            </span>
            <strong className="pf-raised">{amount(funds)}</strong>
            {hasGoal && (
              <>
                <p>{text("Цель: ", "Goal: ") + amount(project.goalLamports)}</p>
                <div
                  className="pf-progress"
                  role="progressbar"
                  aria-label={text("Прогресс сбора", "Funding progress")}
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: progress + "%" }} />
                </div>
              </>
            )}
            <dl className="pf-funding-stats">
              <div>
                <dt>{text("Внесено всего", "Total contributed")}</dt>
                <dd>{amount(project.totalContributedLamports)}</dd>
              </div>
              <div>
                <dt>{text("Возвращено", "Refunded")}</dt>
                <dd>{amount(project.totalRefundedLamports)}</dd>
              </div>
              <div>
                <dt>{text("Участники", "Participants")}</dt>
                <dd>{data.backers.length}</dd>
              </div>
            </dl>
            {!project.closed ? (
              !walletAddress ? (
                <WalletPrompt />
              ) : (
                <form onSubmit={(event) => void contribute(event)}>
                  <label className="pf-field">
                    <span>
                      {text(
                        "Ваш взнос, тестовые SOL",
                        "Your contribution, test SOL",
                      )}
                    </span>
                    <input
                      value={contribution}
                      onChange={(event) => setContribution(event.target.value)}
                      inputMode="decimal"
                      required
                      aria-describedby="contribution-fee-note"
                    />
                  </label>
                  <div className="pf-amount-presets">
                    {["0.01", "0.1", "0.5"].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={contribution === value}
                        onClick={() => setContribution(value)}
                      >
                        <span>{value} SOL</span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="of-button pf-full-button"
                    type="submit"
                    disabled={
                      awaitingConfirmation ||
                      operationBusy ||
                      !projectGateway ||
                      detail.loading
                    }
                  >
                    <HeartHandshake size={17} aria-hidden="true" />
                    <span>
                      {operation === "contribute"
                        ? text("Подтвердите в Phantom…", "Confirm in Phantom…")
                        : text("Поддержать проект", "Support project")}
                    </span>
                  </button>
                  <p className="pf-muted" id="contribution-fee-note">
                    <span>
                      {text(
                        "Вся сумма взноса поступает в хранилище. Phantom отдельно покажет комиссию и расходы на хранение.",
                        "The full contribution reaches the vault. Phantom separately shows fees and account storage costs.",
                      )}
                    </span>
                  </p>
                </form>
              )
            ) : (
              <Notice kind={BigInt(funds) === 0n ? "success" : "info"}>
                {BigInt(funds) === 0n
                  ? text(
                      "Сбор закрыт. Все взносы возвращены.",
                      "Funding closed. All contributions have been returned.",
                    )
                  : text(
                      "Сбор закрыт. Новые взносы не принимаются; доступны возвраты.",
                      "Funding closed. New contributions are disabled; refunds are available.",
                    )}
              </Notice>
            )}
            {walletAddress && (
              <div className="pf-own-support">
                <span>{text("Вы подключены как", "Connected as")}</span>
                <PublicAddress value={walletAddress} />
                <span>
                  {text("Баланс кошелька: ", "Wallet balance: ") +
                    (walletBalance === null ? "—" : amount(walletBalance))}
                </span>
                <strong>
                  {text("Ваш вклад: ", "Your contribution: ") +
                    amount(ownSupport?.totalContributedLamports ?? "0")}
                </strong>
                {ownSupport &&
                  BigInt(ownSupport.totalRefundedLamports) > 0n && (
                    <strong>
                      {text("Вам возвращено: ", "Refunded to you: ") +
                        amount(ownSupport.totalRefundedLamports)}
                    </strong>
                  )}
              </div>
            )}
            {refundEligible &&
              ownSupport &&
              BigInt(ownSupport.refundableLamports) > 0n && (
                <>
                  <button
                    className="of-button secondary pf-full-button"
                    disabled={awaitingConfirmation || operationBusy}
                    onClick={() => {
                      if (projectGateway && walletAddress)
                        void perform(
                          "refund",
                          () =>
                            projectGateway.refund(
                              campaignAddress,
                              walletAddress,
                            ),
                          text(
                            "Ваш взнос возвращён на ваш кошелёк.",
                            "Your contribution has been returned to your wallet.",
                          ),
                        );
                    }}
                  >
                    <span>
                      {text("Получить свой возврат", "Claim my refund")}
                    </span>
                  </button>
                  <p className="pf-muted">
                    <span>
                      {project.legacy
                        ? text(
                            "Возвращается весь взнос. При самостоятельном получении вы оплачиваете комиссию и хранение квитанции; Phantom покажет эти расходы отдельно.",
                            "The full contribution is returned. When claiming it yourself, you pay the transaction fee and receipt storage; Phantom shows these costs separately.",
                          )
                        : text(
                            "Возвращается весь взнос. При самостоятельном получении ваш кошелёк оплачивает сетевую комиссию.",
                            "The full contribution is returned. When claiming it yourself, your wallet pays the network fee.",
                          )}
                    </span>
                  </p>
                </>
              )}
          </div>
          {isCreator && (
            <div className="pf-panel pf-manage">
              <h2>
                <span>{text("Управление проектом", "Manage project")}</span>
              </h2>
              {!data.capability.available ? (
                <UpgradeNote />
              ) : !project.closed ? (
                <>
                  <p>
                    {text(
                      "Закрытие останавливает сбор и открывает возвраты. Средства возвращаются спонсорам; история проекта остаётся.",
                      "Closure stops funding and enables refunds. Funds return to sponsors; the project's history remains.",
                    )}
                  </p>
                  {!closeConfirmation ? (
                    <button
                      className="pf-danger-button"
                      disabled={awaitingConfirmation || operationBusy}
                      onClick={() => setCloseConfirmation(true)}
                    >
                      <span>
                        {text(
                          "Закрыть проект и вернуть средства",
                          "Close project and refund funds",
                        )}
                      </span>
                    </button>
                  ) : (
                    <div className="pf-close-confirmation">
                      <strong>
                        {text("Подтвердить закрытие?", "Confirm closure?")}
                      </strong>
                      <p>
                        {text(
                          "Это действие нельзя отменить. После закрытия начнутся возвраты. Phantom запросит подтверждение для каждого спонсора; уже уплаченные комиссии не возвращаются.",
                          "This action cannot be undone. Refunds start after closure. Phantom requests confirmation for each sponsor; previously paid transaction fees are not refunded.",
                        )}
                      </p>
                      <button
                        className="pf-danger-button"
                        disabled={awaitingConfirmation || operationBusy}
                        onClick={() => void close()}
                      >
                        <span>
                          {text("Да, закрыть сбор", "Yes, close funding")}
                        </span>
                      </button>
                      <button
                        className="of-button secondary"
                        disabled={awaitingConfirmation || operationBusy}
                        onClick={() => setCloseConfirmation(false)}
                      >
                        <span>{text("Отмена", "Cancel")}</span>
                      </button>
                    </div>
                  )}
                </>
              ) : BigInt(funds) > 0n ? (
                <>
                  <p>
                    {text("Осталось вернуть: ", "Outstanding refunds: ") +
                      amount(funds)}
                  </p>
                  <p className="pf-muted">
                    {text(
                      "Каждый возврат — отдельная транзакция Phantom. Если вы остановитесь, продолжить можно позже. Спонсор также может получить свой возврат самостоятельно.",
                      "Each refund is a separate Phantom transaction. You can stop and continue later. A sponsor can also claim their own refund.",
                    )}
                  </p>
                  <button
                    className="of-button pf-full-button"
                    disabled={awaitingConfirmation || operationBusy}
                    onClick={() => void refundAll()}
                  >
                    <HeartHandshake size={17} aria-hidden="true" />
                    <span>
                      {text(
                        "Вернуть оставшиеся взносы",
                        "Refund remaining contributions",
                      )}
                    </span>
                  </button>
                  {refundProgress && (
                    <p role="status">
                      {text("Обработано: ", "Processed: ") +
                        refundProgress.done +
                        " / " +
                        refundProgress.total}
                    </p>
                  )}
                </>
              ) : (
                <Notice kind="success">
                  {text(
                    "Возвраты завершены. Проект хранится в архиве.",
                    "Refunds are complete. The project remains in the archive.",
                  )}
                </Notice>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export function PlatformProfile() {
  const {
    text,
    walletAddress,
    walletBalance,
    disconnect,
    refreshWallet,
    walletBusy,
  } = usePlatform();
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">{text("ВАШ АККАУНТ", "YOUR ACCOUNT")}</p>
          <h1>
            <span>{text("Кошелёк и профиль", "Wallet and profile")}</span>
          </h1>
          <p>
            <span>
              {text(
                "Ваш публичный адрес связывает проекты, взносы и сообщения.",
                "Your public address links your projects, contributions and messages.",
              )}
            </span>
          </p>
        </div>
      </div>
      <NetworkNote />
      {!walletAddress ? (
        <WalletPrompt />
      ) : (
        <div className="pf-profile-grid">
          <div className="pf-panel">
            <span className="pf-profile-avatar">
              {walletAddress.slice(0, 2)}
            </span>
            <h2>{text("Активный аккаунт", "Active account")}</h2>
            <PublicAddress value={walletAddress} full />
            <p className="pf-raised">
              {walletBalance === null ? "—" : amount(walletBalance)}
            </p>
            <div className="pf-profile-actions">
              <button
                className="of-button secondary"
                disabled={walletBusy}
                onClick={() => void refreshWallet()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>{text("Обновить баланс", "Refresh balance")}</span>
              </button>
              <button
                className="of-button secondary"
                disabled={walletBusy}
                onClick={() => {
                  void disconnect().catch(() => {});
                }}
              >
                <span>{text("Отключить", "Disconnect")}</span>
              </button>
            </div>
          </div>
          <div className="pf-panel">
            <h2>
              {text(
                "Автор и спонсор — разные кошельки",
                "Creator and sponsor — different wallets",
              )}
            </h2>
            <p>
              {text(
                "Переключите аккаунт в Phantom. OpenFunds обновит активный адрес, баланс, проекты и взносы. Для двух участников откройте одну ссылку проекта на двух устройствах.",
                "Switch the account in Phantom. OpenFunds updates the active address, balance, projects and contributions. For two participants, open the same project link on both devices.",
              )}
            </p>
            <p>
              {text(
                "В меню кошелька можно сохранить публичные адреса своих аккаунтов. Для подписи всегда используется аккаунт, выбранный в Phantom.",
                "The wallet menu can remember your accounts' public addresses. Signing always uses the account selected in Phantom.",
              )}
            </p>
            <Link className="of-button" href="/dashboard">
              <span>{text("Перейти в кабинет", "Open dashboard")}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlatformPublicProfile({ address }: { address: string }) {
  return <PublicProfileContent key={address} address={address} />;
}

function PublicProfileContent({ address }: { address: string }) {
  const { text, walletAddress, walletBalance, ledger } = usePlatform();
  const catalog = useCatalog();
  const [supportRecords, setSupportRecords] = useState<
    Record<string, ProjectBacker>
  >({});
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportError, setSupportError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!ledger)
      return () => {
        active = false;
      };
    void ledger
      .listMyContributions(address)
      .then((rows) => {
        if (!active) return;
        const records: Record<string, ProjectBacker> = {};
        for (const row of rows) {
          if (BigInt(row.totalContributedLamports) > 0n)
            records[row.campaignAddress] = row;
        }
        setSupportRecords(records);
        setSupportError(null);
      })
      .catch((cause) => {
        if (active) setSupportError(fail(cause, text));
      })
      .finally(() => {
        if (active) setSupportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledger, address, catalog.revision, text]);
  const supported = catalog.projects.filter(
    (project) => supportRecords[project.campaignAddress],
  );
  const projects = catalog.projects.filter(
    (project) => project.creatorAddress === address,
  );
  return (
    <section className="of-container of-page pf-page">
      <div className="pf-page-heading">
        <div>
          <p className="of-eyebrow">OPENFUNDS · DEVNET</p>
          <h1>
            <span>{text("Профиль участника", "Participant profile")}</span>
          </h1>
          <p>
            <span>
              {text(
                "Проекты, взносы и возвраты этого участника доступны всем по его публичному адресу.",
                "This participant’s projects, contributions and refunds are visible through their public address.",
              )}
            </span>
          </p>
        </div>
        <Link className="of-button secondary" href="/projects">
          <span>{text("Все проекты", "All projects")}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <NetworkNote />
      <div className="pf-panel pf-public-profile">
        <span className="pf-profile-avatar">{address.slice(0, 2)}</span>
        <div>
          <h2>
            <span>{text("Участник OpenFunds", "OpenFunds participant")}</span>
          </h2>
          <PublicAddress value={address} full />
          <p className="pf-muted">
            <span>
              {address === walletAddress
                ? text(
                    "Это ваш активный аккаунт",
                    "This is your active account",
                  )
                : text("Публичный профиль Solana", "Public Solana profile")}
            </span>
          </p>
        </div>
        {address === walletAddress && walletBalance !== null && (
          <strong className="pf-raised">{amount(walletBalance)}</strong>
        )}
      </div>
      <div className="pf-page-heading pf-profile-project-heading">
        <h2>
          <span>
            {text("Проекты этого автора", "Projects by this creator")}
          </span>
        </h2>
        <button
          className="of-button secondary"
          onClick={() => void catalog.refresh()}
          disabled={catalog.loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>{text("Обновить", "Refresh")}</span>
        </button>
      </div>
      {catalog.error && <Notice kind="error">{catalog.error}</Notice>}
      <ProjectGrid
        projects={projects}
        loading={catalog.loading}
        empty={text(
          "У этого автора пока нет проектов",
          "This creator has no projects yet",
        )}
      />
      <div className="pf-page-heading pf-profile-project-heading">
        <h2>
          <span>{text("Поддержанные проекты", "Supported projects")}</span>
        </h2>
      </div>
      {supportError && <Notice kind="error">{supportError}</Notice>}
      <ProjectGrid
        projects={supported}
        support={supportRecords}
        personal={false}
        loading={catalog.loading || supportLoading}
        empty={text(
          "Участник пока не поддержал проекты",
          "This participant has not supported projects yet",
        )}
      />
    </section>
  );
}

export function PlatformEdit({ campaignAddress }: { campaignAddress: string }) {
  const { text } = usePlatform();
  return (
    <section className="of-container of-page pf-page">
      <h1>
        <span>
          {text("Данные опубликованного проекта", "Published project details")}
        </span>
      </h1>
      <Notice>
        <span>
          {text(
            "Название, описание и цель этой версии сохраняются при создании. Изменение опубликованных данных пока не поддерживается. Открыть проект и управлять сбором можно по ссылке ниже.",
            "This version stores the title, description and goal at creation. Editing published data is not supported yet. You can open the project and manage funding below.",
          )}
        </span>
      </Notice>
      <Link className="of-button" href={"/projects/" + campaignAddress}>
        <span>{text("Открыть проект", "Open project")}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
