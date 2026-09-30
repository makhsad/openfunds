import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asLamports,
  formatSol,
  parseSol,
  percentOf,
  voteResults,
} from "../src/lib/amounts";
import { createMockCampaign } from "../src/services/mock-data";
import {
  createMockClient,
  OperationCancelledError,
} from "../src/services/mock-client";

test("SOL parsing and formatting preserve all nine decimals and values above Number.MAX_SAFE_INTEGER", () => {
  for (const [sol, lamports] of [
    ["0.1", "100000000"],
    ["0.000000001", "1"],
    ["100000000.123456789", "100000000123456789"],
  ]) {
    assert.equal(parseSol(sol), lamports);
    assert.equal(formatSol(lamports), sol);
  }
  assert.equal(parseSol(" 0.010000000 "), "10000000");
  assert.equal(formatSol("0"), "0");
});

test("invalid SOL and lamport input is rejected without rounding", () => {
  for (const input of [
    "",
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1e-3",
    "0,1",
    "0.0000000001",
    ".1",
    "1.",
  ])
    assert.throws(() => parseSol(input));
  for (const input of ["-1", "1.1", "NaN", ""])
    assert.throws(() => asLamports(input));
});

test("both demo fixtures reconcile funding, milestone budgets, and history", () => {
  for (const scenario of ["funding", "voting"] as const) {
    const campaign = createMockCampaign(scenario);
    assert.equal(
      asLamports(campaign.raised),
      asLamports(campaign.locked) + asLamports(campaign.released),
    );
    assert.equal(
      campaign.milestones.reduce(
        (sum, item) => sum + asLamports(item.amount),
        0n,
      ),
      asLamports(campaign.goal),
    );
    assert.equal(
      campaign.transactions
        .filter((item) => item.type === "contribution")
        .reduce((sum, item) => sum + asLamports(item.amount!), 0n),
      asLamports(campaign.raised),
    );
    assert.equal(
      campaign.milestones
        .filter((item) => item.status === "released")
        .reduce((sum, item) => sum + asLamports(item.amount), 0n),
      asLamports(campaign.released),
    );
  }
});

test("voting denominator includes uncast weight and threshold is an exact integer comparison", () => {
  const vote = createMockCampaign("voting").voting!;
  assert.deepEqual(voteResults(vote), {
    approve: 45,
    reject: 15,
    notVoted: 40,
    thresholdReached: false,
  });
  assert.equal(
    voteResults({ ...vote, approveWeight: "59999999", rejectWeight: "0" })
      .thresholdReached,
    false,
  );
  assert.equal(
    voteResults({ ...vote, approveWeight: "60000000", rejectWeight: "0" })
      .thresholdReached,
    true,
  );
  assert.equal(percentOf("100000000123456789", "200000000246913578"), 50);
  assert.equal(percentOf("0", "0"), 0);
  assert.equal(
    voteResults({
      ...vote,
      totalWeight: "0",
      approveWeight: "0",
      rejectWeight: "0",
    }).thresholdReached,
    false,
  );
});

test("disconnected support and vote cannot change campaign state", async () => {
  const funding = createMockClient("funding", 0);
  const before = await funding.getSnapshot();
  await assert.rejects(funding.support("10000000"), /Connect/);
  assert.deepEqual(await funding.getSnapshot(), before);
  await assert.rejects(
    createMockClient("voting", 0).vote("approve"),
    /Connect/,
  );
});

test("support is locked throughout voting", async () => {
  const client = createMockClient("voting", 0);
  const before = await client.connectWallet();
  await assert.rejects(client.support("10000000"), /closed/);
  assert.deepEqual(await client.getSnapshot(), before);
});

test("successful support updates balance, vault, progress, history and unique backers atomically", async () => {
  const client = createMockClient("funding", 0);
  await client.connectWallet();
  await client.support("10000000");
  const after = await client.support("1");
  assert.equal(after.campaign.raised, "50000001");
  assert.equal(after.campaign.locked, "50000001");
  assert.equal(after.campaign.released, "0");
  assert.equal(after.wallet?.balance, "109999999");
  assert.equal(after.campaign.transactions[0].amount, "1");
  assert.equal(after.campaign.backers, 3);
  client.disconnectWallet();
  assert.equal((await client.connectWallet()).wallet?.balance, "109999999");
});

test("zero, invalid, over-balance and over-goal contributions are rejected atomically", async () => {
  const client = createMockClient("funding", 0);
  const before = await client.connectWallet();
  for (const amount of ["0", "-1", "1.5", "120000001", "60000001"]) {
    await assert.rejects(client.support(amount));
    assert.deepEqual(await client.getSnapshot(), before);
  }
  assert.equal((await client.support("60000000")).campaign.raised, "100000000");
  await assert.rejects(client.support("1"), /remaining/);
});

test("approve adds fixed weight once and does not release funds automatically", async () => {
  const client = createMockClient("voting", 0);
  await client.connectWallet();
  const after = await client.vote("approve");
  assert.deepEqual(voteResults(after.campaign.voting!), {
    approve: 65,
    reject: 15,
    notVoted: 20,
    thresholdReached: true,
  });
  assert.equal(after.campaign.voting!.totalWeight, "100000000");
  assert.equal(after.campaign.locked, "80000000");
  assert.equal(after.campaign.transactions[0].amount, null);
  await assert.rejects(client.vote("reject"), /already/);
  client.disconnectWallet();
  await client.connectWallet();
  await assert.rejects(client.vote("approve"), /already/);
});

test("reject changes only reject weight and funding cannot be voted on", async () => {
  const client = createMockClient("voting", 0);
  await client.connectWallet();
  const after = await client.vote("reject");
  assert.deepEqual(voteResults(after.campaign.voting!), {
    approve: 45,
    reject: 35,
    notVoted: 20,
    thresholdReached: false,
  });
  const funding = createMockClient("funding", 0);
  await funding.connectWallet();
  await assert.rejects(funding.vote("approve"), /no active/);
});

test("simulated errors and cancellations leave votes, balance, history unchanged and can be retried", async () => {
  for (const scenario of ["funding", "voting"] as const) {
    const client = createMockClient(scenario, 0);
    const before = await client.connectWallet();
    const act = () =>
      scenario === "funding"
        ? client.support("10000000")
        : client.vote("approve");
    for (const outcome of ["error", "cancel"] as const) {
      client.setOutcome(outcome);
      await assert.rejects(act());
      assert.deepEqual(await client.getSnapshot(), before);
    }
    client.setOutcome("success");
    assert.notDeepEqual(await act(), before);
  }
});

test("connection error and cancellation keep the wallet disconnected", async () => {
  const client = createMockClient("voting", 0);
  for (const outcome of ["error", "cancel"] as const) {
    client.setOutcome(outcome);
    await assert.rejects(client.connectWallet());
    assert.equal((await client.getSnapshot()).wallet, null);
  }
});

test("manual cancellation and concurrent requests cannot double-spend", async () => {
  const client = createMockClient("funding", 10);
  const before = await client.connectWallet();
  const controller = new AbortController();
  const pending = client.support("10000000", controller.signal);
  await assert.rejects(client.support("10000000"), /already pending/);
  controller.abort();
  await assert.rejects(pending, OperationCancelledError);
  assert.deepEqual(await client.getSnapshot(), before);
});

test("snapshots cannot mutate the service state", async () => {
  const client = createMockClient("voting", 0);
  const first = await client.getSnapshot();
  first.campaign.raised = "1";
  first.campaign.milestones[0].amount = "1";
  assert.equal((await client.getSnapshot()).campaign.raised, "100000000");
  assert.equal(
    (await client.getSnapshot()).campaign.milestones[0].amount,
    "20000000",
  );
});
