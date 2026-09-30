import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSendDiscussion,
  discussionScopeKey,
  validateDiscussionSend,
} from "../src/lib/discussion";
import {
  createMockDiscussionMessages,
  demoDiscussionContexts,
} from "../src/services/mock-discussion-data";
import {
  simulateDiscussionSend,
  type MockDiscussionRequest,
} from "../src/services/mock-discussion";

const request: MockDiscussionRequest = {
  projectId: "community-project",
  campaignId: "demo-campaign-1",
  role: "backer",
  canPost: true,
  type: "message",
  text: "Hello",
  authorName: "Demo backer",
  outcome: "success",
};

test("discussion permissions require both an allowed role and canPost", () => {
  for (const role of [
    "visitor",
    "connected_non_backer",
    "backer",
    "creator",
  ] as const) {
    for (const type of ["message", "update"] as const) {
      assert.equal(canSendDiscussion(role, false, type), false);
      assert.equal(
        canSendDiscussion(role, true, type),
        role === "creator" || (role === "backer" && type === "message"),
      );
    }
  }
});

test("blank drafts are rejected and valid text is trimmed without interpreting markup", () => {
  for (const text of ["", " ", "\n\t", "\u00a0"])
    assert.throws(
      () => validateDiscussionSend(text, "backer", true, "message"),
      /Write a message/,
    );
  assert.equal(
    validateDiscussionSend(" <b>Hello</b> ", "backer", true, "message"),
    "<b>Hello</b>",
  );
});

test("scope keys distinguish projects and campaigns, including IDs containing delimiters", () => {
  assert.notEqual(
    discussionScopeKey({ projectId: "a", campaignId: "b:c" }),
    discussionScopeKey({ projectId: "a:b", campaignId: "c" }),
  );
  assert.equal(new Set(demoDiscussionContexts.map(discussionScopeKey)).size, 3);
  const first = demoDiscussionContexts[0];
  assert.notEqual(
    discussionScopeKey(first),
    discussionScopeKey({ ...first, projectId: "other" }),
  );
  assert.notEqual(
    discussionScopeKey(first),
    discussionScopeKey({ ...first, campaignId: "other" }),
  );
});

test("fixtures have five independently allocated, correctly scoped messages per context", () => {
  for (const context of demoDiscussionContexts) {
    const messages = createMockDiscussionMessages(context);
    assert.equal(messages.length, 5);
    assert.equal(new Set(messages.map((message) => message.id)).size, 5);
    assert.ok(
      messages.every(
        (message) =>
          discussionScopeKey(message) === discussionScopeKey(context),
      ),
    );
    assert.ok(
      messages.some(
        (message) => message.type === "update" && message.role === "creator",
      ),
    );
    messages[0].text = "Changed";
    assert.notEqual(createMockDiscussionMessages(context)[0].text, "Changed");
  }
});

test("mock handler also blocks read-only roles and backer updates", async () => {
  for (const role of ["visitor", "connected_non_backer"] as const)
    await assert.rejects(
      simulateDiscussionSend({ ...request, role }, undefined, 0),
      /permission/,
    );
  await assert.rejects(
    simulateDiscussionSend({ ...request, type: "update" }, undefined, 0),
    /permission/,
  );
  await assert.rejects(
    simulateDiscussionSend(
      { ...request, role: "creator", type: "update", canPost: false },
      undefined,
      0,
    ),
    /permission/,
  );
});

test("successful async posts preserve captured IDs, identity and plain text", async () => {
  const message = await simulateDiscussionSend(
    { ...request, text: "  <script>hello</script>  " },
    undefined,
    0,
  );
  assert.equal(message.text, "<script>hello</script>");
  assert.equal(message.projectId, request.projectId);
  assert.equal(message.campaignId, request.campaignId);
  assert.equal(message.role, "backer");
  const update = await simulateDiscussionSend(
    { ...request, role: "creator", type: "update" },
    undefined,
    0,
  );
  assert.equal(update.type, "update");
  assert.notEqual(message.id, update.id);
});

test("failed, cancelled and aborted sends return no message and can be retried", async () => {
  for (const outcome of ["error", "cancel"] as const)
    await assert.rejects(
      simulateDiscussionSend({ ...request, outcome }, undefined, 0),
      /draft is saved/,
    );
  const controller = new AbortController();
  const pending = simulateDiscussionSend(request, controller.signal, 20);
  controller.abort();
  await assert.rejects(pending, /closed/);
  assert.equal(
    (await simulateDiscussionSend(request, undefined, 0)).text,
    "Hello",
  );
});
