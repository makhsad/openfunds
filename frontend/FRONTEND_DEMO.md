# OpenFunds local product demo

The existing frontend has been extended with Home, Explore, Create, Dashboard,
project detail and metadata editing. The original campaign demo remains at `/demo`.

## Run

From `frontend/`, use Node 20.9 or newer:

```sh
npm ci
npm run build
npm run start
```

Open `http://127.0.0.1:3000`. The demo identity selector is visible in every new
page. Browser storage keeps projects and activity across navigation and reload.
The footer's Demo controls reset the seed data and simulate failed/cancelled
operations. Clearing browser storage also resets the demo.

## Try the product flow

1. Select Creator, open Create Project and enter the project story, media, plan,
   goal and one to five milestone budgets. Review and publish.
2. Publish a Project Update in the project's Discussion tab.
3. Switch to Backer A. Contribute, then post a message. Switch to Backer B and
   contribute independently.
4. Switch to Creator. Start the first milestone and submit a completion report.
5. Switch between the backers and vote. Weights are fixed when review begins;
   later contributions do not change this snapshot. Each backer votes once.
6. After all eligible backers vote, approval requires 60% of the snapshot total.
   The creator can explicitly release approved funds in the demo. A rejected
   report can be revised and resubmitted with a new snapshot.
7. Create a second project and verify its balances, Discussion and votes are
   independent. Dashboard links open the appropriate project/tab.

All amounts are integer lamport strings. Metadata is editable by its creator;
goal, milestone count/order and budgets are frozen after the first contribution.
Image uploads use local data URLs, limited to 400 KB per image and three gallery
images (roughly 2 MB combined per project). Browser storage capacity can still limit large image collections. A
failed save is reported and does not publish a partial mutation.

## Honest Solana boundary

`CampaignRepository` separates the UI from persistence and business rules.
`createDemoProjectRepository` implements local demo operations only.
`src/lib/solana/campaign-boundary.ts` describes the gateway a real signed RPC
adapter would need and explicitly rejects unavailable blockchain access.

The Rust source in this particular worktree exposes `initialize_campaign()`
and `contribute(u64)`. Its campaign seeds are `[campaign, creator]`, so this
branch's program still permits one campaign per creator. It does not implement
milestones, voting, release or project metadata. Work on another branch is not
merged. The frontend currently performs no Solana transactions, generates no
signatures and moves no real SOL. Demo identities are not wallets.

Real integration needs an explicitly configured RPC network, a connected wallet,
the matching deployed program and IDL, and chain-aware repository reconciliation.
Milestone voting/release and multiple campaigns need compatible audited program
instructions before they can replace local behavior. Media hosting, shared backend
storage, authentication, moderation and production recovery are also still absent.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run build
npm run test:e2e
```

The Playwright config covers desktop and mobile. Set `PLAYWRIGHT_CHANNEL=chrome`
to use an existing Chrome installation. Downloaded Linux Chromium additionally
needs its OS shared libraries; a missing browser/library is an environment issue.
