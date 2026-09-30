# OpenFunds frontend

OpenFunds предназначен для финансирования разных проектов. На странице показана одна демонстрационная кампания **Community Project** от **Build3rDAO**. Интерфейс на английском; вся интерактивность работает на mock data. Главный блок «Fund ideas. Build together.» и иллюстрация показывают общий процесс: идея → поддержка сообщества → голосование → завершённый этап. SVG/CSS-оформление сохраняет белый фон, тёмно-синий текст, синие и бирюзовые акценты.

## Запуск

Нужен Node.js 20.9 или новее; разработка и проверки выполнены на Node.js 24.21.0.

```sh
cd frontend
npm ci
npm run dev
```

Страница: [http://127.0.0.1:3000](http://127.0.0.1:3000).

Для локального запуска production-сборки:

```sh
npm run build
npm run start
```

Никакие `.env`, API-ключи, расширения кошелька или RPC не нужны. Страница не использует внешние шрифты и изображения. Next.js настроен по [официальной инструкции](https://nextjs.org/docs/app/getting-started/installation), Tailwind CSS — через [PostCSS](https://tailwindcss.com/docs/installation/framework-guides/nextjs). Точные установленные версии закреплены в `package-lock.json`.

## Что можно проверить на странице

**Voting** — начальный сценарий:

| Показатель              | SOL  |
| ----------------------- | ---- |
| Goal                    | 0.1  |
| Raised                  | 0.1  |
| Locked                  | 0.08 |
| Released                | 0.02 |
| Prototype · released    | 0.02 |
| MVP · voting            | 0.03 |
| Public Release · locked | 0.05 |

Взносы закрыты. `Connect Wallet` подключает один демонстрационный кошелёк с балансом 0.12 SOL. Общий зафиксированный вес голосования — 0.1 SOL. Начальные результаты: Approve 45%, Reject 15%, Not voted 40%; вес demo-кошелька — 0.02 SOL (20%). Approve меняет результаты на 65 / 15 / 20, Reject — на 45 / 35 / 20. Повторный голос запрещён, в том числе после переподключения кошелька. Порог проверяется целыми числами и равен 60% всего snapshot, а не только проголосовавших.

Достижение порога **не переводит средства автоматически**: UI явно показывает, что release остаётся отдельной будущей операцией. Балансы остаются согласованными с этапами.

**Funding** — отдельный сценарий для формы поддержки:

- Goal 0.1, Raised и Locked 0.04, Released 0 SOL. Все этапы ещё закрыты.
- Нажмите `Connect Wallet` или `Connect to support`.
- Выберите 0.01 / 0.05 / 0.1 SOL или введите сумму вручную. 0.1 SOL в этом сценарии превышает остаток цели и демонстрирует ошибку валидации.
- Вклад увеличивает Raised и Locked, уменьшает баланс и добавляет запись в историю. Повторный вклад того же кошелька не увеличивает число уникальных backers.
- После достижения 0.1 SOL форма закрывается. Для самостоятельности сценария голосование автоматически не открывается; его можно посмотреть через переключатель Voting.
- Разрешены положительные десятичные суммы до 9 знаков после точки, включая 1 lamport. Экспоненты, запятая, отрицательные суммы и лишние десятичные знаки отклоняются.

В **Demo controls**:

- `Operation outcome`: Success, Error или Cancellation для подключения, поддержки и голоса. Выбор действует до следующего изменения.
- Во время ожидания доступна ручная кнопка `Cancel`; остальные изменяющие состояние действия блокируются.
- `History preview`: Populated, Empty или Loading. Превью не меняет баланс или настоящие записи mock-сервиса.
- `Reset demo` сбрасывает сценарий и показывает начальную загрузку.

При ошибке или отмене состояние не меняется. Обновление страницы, сброс и переключение сценария очищают изменения и отключают demo-кошелёк. Простое отключение/подключение внутри одного сценария сохраняет баланс и голос. Данные не сохраняются в localStorage.

## Структура и подключение Solana

```text
src/
  app/                         # Страница, metadata, общие стили
  components/                  # Navbar, ProjectHero, ProjectStats,
                               # FundingProgress, SupportProject, MilestoneList,
                               # VotingCard, FundFlow, TransactionHistory
  hooks/use-crowdfunding.ts     # Загрузка и жизненный цикл операций
  types/crowdfunding.ts         # Типы данных и CrowdfundingClient
  lib/amounts.ts               # SOL ↔ lamports, целочисленные проценты
  services/mock-data.ts        # Две независимые согласованные fixtures
  services/mock-client.ts      # Асинхронный сервис в памяти
tests/
  crowdfunding.test.ts        # Расчёты, инварианты, атомарность и ограничения
  e2e/campaign.spec.ts         # Браузерные сценарии и axe accessibility
```

Точка замены — интерфейс **`CrowdfundingClient`** в `src/types/crowdfunding.ts`:

```ts
getSnapshot(signal?: AbortSignal): Promise<CrowdfundingSnapshot>
connectWallet(signal?: AbortSignal): Promise<CrowdfundingSnapshot>
disconnectWallet(): CrowdfundingSnapshot
support(amount: Lamports, signal?: AbortSignal): Promise<CrowdfundingSnapshot>
vote(choice: VoteChoice, signal?: AbortSignal): Promise<CrowdfundingSnapshot>
```

Разработчик Solana может реализовать этот интерфейс в новом адаптере и заменить фабрику в `use-crowdfunding.ts`. Метод `setOutcome` относится только к mock-клиенту; при интеграции реальные операции отделяются от Demo controls. Тип `DemoWallet` содержит отображаемый идентификатор и баланс; его можно переименовать в общий wallet snapshot при подключении адаптера.

`SupportProject` получает `onSupport(amount)` — сумму **строкой в lamports**. `VotingCard` получает `onVote(choice)` — `approve` или `reject`. Обработчики возвращают результат асинхронного действия, компоненты не знают об RPC или подписях. Отмена сейчас гарантированно останавливает симуляцию до изменения данных; при реальной интеграции уже отправленная транзакция потребует отдельного состояния ожидания подтверждения и не может считаться отменённой только из-за `AbortSignal`.

Снимок, ограничения и результаты должны приходить из будущего Solana-адаптера: цель, vault balances, milestone statuses, фиксированный общий вес, голос текущего кошелька, история и подтверждения. Проверки в форме нужны для удобства; права, закрытие взносов, однократный голос и release разработчик Solana проверяет на стороне своего протокола. Интерфейс истории сейчас намеренно содержит только подтверждённые **демонстрационные** записи; ожидание, ошибка и отмена показаны отдельным уведомлением операции. Фальшивых адресов, signatures и ссылок Explorer нет.

Все денежные поля — десятичные строки в lamports. В расчётах используется `BigInt`; преобразование в `Number` выполняется только для ограниченного диапазона процентов, чтобы нарисовать полосы прогресса. Форматирование SOL не теряет дробные разряды. Соотношение `Raised = Locked + Released` соблюдается в обоих сценариях.

## Проверки

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

E2E запускает production-сервер автоматически; сначала выполните build. Если Chromium Playwright не установлен, можно использовать установленный Google Chrome. В PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

Два viewport: desktop 1440 × 1000 и mobile 390 × 664 (эмуляция iPhone в Chromium). Тесты проверяют взносы, Approve/Reject, закрытие форм, повторный голос, баланс после reconnect, ошибки/отмену, пустую/загружаемую историю, якорную навигацию с клавиатуры и отсутствие горизонтального выхода страницы за экран. Axe проверяет доступность Voting и Funding. Скриншоты и трассы сохраняются в исключённом из Git `test-results/`.

## Границы

Не реализованы Anchor, RPC, настоящие транзакции, приватные ключи, регистрация, другие кампании и Mainnet. `backend/` и `solana/` не затронуты. Commit, push и deploy не выполнялись.
