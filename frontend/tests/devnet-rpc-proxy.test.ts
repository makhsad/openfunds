import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEVNET_RPC_URL,
  handleDevnetRpc,
} from "../src/lib/solana/devnet-rpc-proxy";

function request(payload: unknown) {
  return new Request("http://localhost/api/solana/devnet", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

test("Devnet proxy preserves u64 balances and always uses the fixed Devnet URL", async () => {
  const raw =
    '{"jsonrpc":"2.0","id":1,"result":{"value":18446744073709551615}}';
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, DEVNET_RPC_URL);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: ["public-address"],
    });
    return new Response(raw);
  };
  const response = await handleDevnetRpc(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: ["public-address"],
      url: "https://api.mainnet-beta.solana.com",
    }),
    fetcher,
  );
  assert.equal(await response.text(), raw);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Devnet proxy rejects signed transactions, airdrops and malformed requests before network access", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("Network must not be called");
  };
  for (const payload of [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: ["signed-data"],
    },
    { jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: ["address", 1] },
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: "not-an-array" },
    [{ jsonrpc: "2.0", id: 1, method: "getBalance", params: [] }],
    null,
  ]) {
    const response = await handleDevnetRpc(request(payload), fetcher);
    assert.equal(response.status, 400);
  }
});

test("Devnet proxy reports upstream limits and connection failures without fabricating a result", async () => {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getGenesisHash",
    params: [],
  };
  const limited = await handleDevnetRpc(
    request(payload),
    async () => new Response("busy", { status: 429 }),
  );
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).result, undefined);
  const unavailable = await handleDevnetRpc(request(payload), async () => {
    throw new Error("offline");
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).result, undefined);
});

test("Devnet proxy rejects oversized payloads", async () => {
  const response = await handleDevnetRpc(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: ["x".repeat(33_000)],
    }),
    async () => {
      throw new Error("Network must not be called");
    },
  );
  assert.equal(response.status, 413);
});
