# OpenFunds

**Solana crowdfunding with shared project pages, transparent contributions, public discussions, and refunds.**

OpenFunds connects project creators and backers through a web application backed by an Anchor program. The current prototype runs on **Solana Devnet** and uses test SOL. Project data is shared across devices through Solana.

- [Live demo](https://openfunds-eight.vercel.app)
- [Source code](https://github.com/makhsad/openfunds/tree/feature/full-openfunds)
- [Program on Solana Explorer](https://explorer.solana.com/address/Hcy7KiWQE1VfWE8LieGUSq8yAeL1AZEMqjKhDjomc7Fe?cluster=devnet)

## What works

- Connect Phantom, switch active accounts, and label remembered public wallet addresses.
- Create multiple independent projects with a title, description, funding goal, and optional image URL.
- Contribute test SOL to a program-controlled vault. Repeat contributions accumulate in the same per-backer record.
- Browse projects, creator and backer profiles, and a dashboard of created and supported projects.
- View project balances, recorded contributions, refunds, transaction fees, and Explorer receipts.
- Publish public on-chain messages as the creator or a backer with a recorded contribution.
- Close fundraising and refund outstanding recorded contributions to the original backers.
- Use the built-in English or Russian interface.

Existing campaigns from the earlier program version remain accessible alongside new projects.

## How funds move

A contribution transfers SOL from the backer's wallet to the project's vault and updates both the campaign total and the backer's contribution record. Funds remain under program control.

After the creator closes fundraising, new contributions and messages stop. The creator can refund backers individually, or a backer can claim their own outstanding contribution. Each operation requires a wallet signature. Interrupted refund batches can continue with the remaining contributions.

Refunds return the recorded contribution amount. Network fees and account storage costs are separate. The vault retains its required storage reserve, and the original contribution history and messages remain available after closure.

Use the project's contribution button when testing. A direct transfer to the creator's personal wallet or an unrecorded transfer to the vault is not a registered project contribution.

## Try the demo with two accounts

1. Use a creator account and a separate backer account in Phantom. Select **Solana Devnet** and fund both with test SOL for transactions and account storage.
2. The creator connects their wallet, opens **Create project**, publishes a project, and shares its URL.
3. The backer opens that URL, connects their account, and contributes **0.01 SOL** twice.
4. Both participants verify **0.02 SOL** in recorded contributions, inspect the transaction history, and exchange a message in the project chat.
5. The creator closes fundraising and confirms the refund. The backer verifies receipt of the recorded **0.02 SOL**.

Two people can use separate devices. One person can test both roles by switching accounts in Phantom. The site follows the active Phantom account; remembering an address does not grant signing access to it.

The deployed Devnet program is already upgraded and activated. Ordinary demo users do not need to deploy the program or initialize it again.

## Repository structure

```text
frontend/                  Next.js application, RPC API, and frontend tests
solana/                    Solana utilities and test dependencies
solana/anchor/programs/    Rust Anchor program
solana/anchor/tests/       Local validator integration tests
solana/anchor/idl/         Public program IDL
```

The web application uses Next.js, React, TypeScript, and Solana SDKs. The program uses Rust and Anchor. Project state, contribution records, messages, and refund accounting are stored on chain; the standard demo does not require an external database.

## Run the frontend locally

Requirements: Node.js **20.9 or later**, npm, and Phantom for signed transactions. Node.js 24 was used for validation.

```bash
git clone https://github.com/makhsad/openfunds.git
cd openfunds
git switch feature/full-openfunds
cd frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser with Phantom. The local frontend uses the deployed **Devnet** program. It does not automatically connect to the isolated validator used by the program tests.

For a production build:

```bash
npm run build
npm run start
```

The standard frontend configuration does not require private keys, wallet seeds, or new environment variables.

## Frontend checks

Run these commands from `frontend/`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser tests use Playwright and a test wallet provider. They require a Playwright browser or an installed compatible Chrome. To use installed Chrome in a Bash shell:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The E2E runner starts the production server, so build the frontend first. Real Phantom testing is a separate manual step.

## Build and test the Anchor program

The validated toolchain is Anchor CLI **1.2.0**, Solana/Agave **3.1.10**, and `cargo-build-sbf` **3.1.10**. Solana utilities require Node.js **22.15 or later**. Rust, SBF tools, and the Cargo dependencies must already be available for the offline build below.

From the repository root:

```bash
cd solana
npm ci
cd anchor
anchor build --no-idl --ignore-keys --arch v0 -- --offline --skip-tools-install
anchor idl build -o target/idl/openfunds.json -- --offline
../node_modules/.bin/tsx --test tests/openfunds.test.ts
```

Use **SBF v0** with this validator configuration. The default Anchor SBF v3 build previously produced `Program is not deployed / Unsupported program id` at execution time.

The integration suite starts its own isolated local validator, loads the compiled program, uses disposable in-memory signers, and cleans up its own temporary ledger. Existing wallet files are not needed. Building or running these tests does not deploy to Devnet.

See [LOCAL_TESTING.md](solana/anchor/LOCAL_TESTING.md) for account layouts, compatibility, and test details.

## Verification

The unified release passed 19 local validator integration tests and 97 frontend unit tests. The latest results of all 60 desktop/mobile browser scenarios passed, including targeted reruns of two corrected confirmation checks.

A separate real Devnet scenario verified project creation, two contributions of 10,000,000 lamports, reuse of the contribution PDA, a public message, closure, and an exact 20,000,000-lamport refund. All scenario transactions were finalized. Existing funded legacy campaign data and balances remained unchanged during the upgrade.

Validation covers multiple projects, contribution isolation, canonical PDA checks, zero-amount rejection, checked arithmetic, authorization, closed-project restrictions, and double-refund protection.

## Hosting

The frontend is hosted on Vercel. Set the project's **Root Directory** to `frontend` and use `npm run build`. The current implementation branch is `feature/full-openfunds`.

Publishing the frontend and upgrading the Solana program are separate operations. The current Devnet program is already active. Future program upgrades require the upgrade authority; application users do not need that authority to create projects or contribute.

Program ID:

```text
Hcy7KiWQE1VfWE8LieGUSq8yAeL1AZEMqjKhDjomc7Fe
```

Never commit wallet keypairs, seed phrases, or deployment signer files.

## Current scope

OpenFunds currently implements project creation, funding, public discussion, closure, and refunds on Devnet. Milestone voting, milestone-based payouts to creators, Mainnet deployment, and editing published project metadata are future work.

This repository contains the core OpenFunds prototype. Older demo components remain in the frontend codebase; the active application routes use shared Devnet data.
