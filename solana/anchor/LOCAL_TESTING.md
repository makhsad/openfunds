# Unified OpenFunds local program

This source extends the deployed legacy program without changing its program ID or the original instruction/account prefixes. Building and local testing do not deploy or upgrade Devnet.

## Build and local test

Use the existing Anchor 1.2.0 / Agave 3.1.10 toolchain and installed dependencies. Anchor 1.2.0 defaults to SBF v3, which the current Agave 3.1.10 validator does not execute. Build explicitly for SBF v0. This changes the output architecture, not the installed toolchain version.

```sh
cd ~/projects/openfunds-full/solana/anchor
anchor build --no-idl --ignore-keys --arch v0 -- --offline --skip-tools-install
anchor idl build -o target/idl/openfunds.json -- --offline
../node_modules/.bin/tsx --test tests/openfunds.test.ts
```

`--ignore-keys` avoids the CLI program-keypair check. The SBF-only flags are passed to the first command; IDL compilation runs separately because its underlying `cargo test` does not accept them. A generated public IDL snapshot is kept in `idl/openfunds.json`; regenerate it after ABI changes.

The integration test creates its own temporary validator ledger, preloads `target/deploy/openfunds.so` at the declared program ID, creates disposable in-memory signers and requests local airdrops. It uses RPC 18899, websocket 18900 and faucet 18910. It terminates only its own validator and deletes only its own temporary ledger. Existing wallet or program keypair files are not read by this test. Failure diagnostics copy the temporary validator log to `/tmp/openfunds-v2-validator.log` before cleanup.

## Public V2 state

- `PlatformV2`: `platform_v2` PDA, version 2, 9 bytes. Explicit initialization is a normal signer-approved transaction; read paths never initialize it automatically.
- `CampaignV2`: `campaign_v2 / creator / campaign_id little-endian u64`, 789 bytes. Stores creator, identifier, goal, historically contributed and refunded amounts, message count, timestamps, status, title, description and image URL.
- `VaultV2`: `vault_v2 / campaign`, 8 bytes plus deposited lamports.
- `ContributionV2`: `contribution_v2 / campaign / backer`, 88 bytes. Keeps raised and refunded amounts separately.
- `MessageV2`: `message_v2 / campaign / message_index little-endian u64`, 332 bytes. Stores exact signer identity, project, sequence, timestamp and immutable UTF-8 body.

Metadata bounds use UTF-8 bytes: title 80, description 400, image URL 200, chat body 240. Title and description must contain text. Image URLs must be empty or start with `https://`. Funding goals and contributions must be positive. All accounting additions and subtractions are checked.

Project statuses are 0 open, 1 refunds pending, 2 fully refunded. Only the recorded creator can close a project. Closing stops new funding. Each refund transfers exactly one backer's outstanding recorded contribution to that same backer; either the creator or that backer may authorize it. A second refund fails. Multi-backer refund transactions may be continued separately after interruption. No background transaction is signed by the application.

Creator and existing backers can post messages. Signer authorization, canonical contribution identity and monotonically increasing message index are validated on chain. Closing makes the discussion read-only. Messages and monetary history are retained after closure.

Existing legacy projects also have authenticated shared chat through `post_message_legacy`. Its `LegacyDiscussion` counter uses `legacy_discussion / campaign` (48 bytes, campaign and message count) and the same immutable MessageV2 record format. Legacy messages use the original Contribution account for authorization and stop accepting new posts after closure.

## Legacy compatibility and refunds

Original Campaign (48 bytes), Vault (8 bytes), Contribution (80 bytes), discriminators, PDA seeds and initialize/contribute account order remain intact. A creator-approved `close_campaign_legacy` appends a byte to Campaign (49 bytes, byte 48 = 1). Existing 48-byte account prefixes stay identical. The original contribute handler checks that byte and rejects closed campaigns even when an old client supplies no new auxiliary accounts.

`LegacyClosure` uses `legacy_close / campaign` (89 bytes): campaign, creator, cumulative refunded amount, status and closure time. `LegacyRefundReceipt` uses `legacy_refund / campaign / backer` (80 bytes): campaign, backer and refunded amount. Original Contribution and Campaign raised totals remain historical totals. The receipt prevents duplicate refunds and the canonical original Contribution binds the exact recipient.

Vault storage rent stays in the vault. Previously paid network fees and account rent are not part of the recorded contribution refund. Unrecorded direct transfers to a vault are not represented as contributions and are not included in per-backer refunds. There is no creator withdrawal, voting, milestone payout, account deletion or mainnet deployment instruction.

## Validation

The local integration suite checks original initialization/contribution safety plus multiple independent V2 projects, metadata bounds, shared authenticated messages, arithmetic overflow rejection, canonical PDA rejection, creator closure, recorded-recipient refunds, double-refund protection, exact balances with explicit transaction fees, rent preservation, and legacy closure/refunds with the old contribution ABI. Rejected instructions preserve project/vault/contribution state.

Publishing frontend files to Vercel does not upgrade the Devnet program. A separately approved Devnet program upgrade and explicit capability-marker initialization are required before the deployed site can use these new instructions.
