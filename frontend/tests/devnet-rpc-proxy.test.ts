import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import {
  ANCHOR_DISCRIMINATORS,
  OPENFUNDS_PROGRAM_ADDRESS,
} from "../src/lib/solana/phantom-gateway";
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

const publicKey = getAddressDecoder().decode(new Uint8Array(32).fill(1));
const publicSignature = getBase58Decoder().decode(new Uint8Array(64).fill(2));
const campaignFilter = {
  memcmp: {
    offset: 0,
    bytes: getBase58Decoder().decode(
      new Uint8Array(ANCHOR_DISCRIMINATORS.campaign),
    ),
  },
};
const contributionFilter = {
  memcmp: {
    offset: 0,
    bytes: getBase58Decoder().decode(
      new Uint8Array(ANCHOR_DISCRIMINATORS.contribution),
    ),
  },
};

test("Devnet proxy allows only canonical OpenFunds catalogue scans and bounded parsed history", async () => {
  const reads = [
    {
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          withContext: true,
          filters: [{ dataSize: 48 }, campaignFilter],
        },
      ],
    },
    ...[8, 40].map((offset) => ({
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          withContext: true,
          filters: [
            { dataSize: 80 },
            contributionFilter,
            { memcmp: { offset, bytes: publicKey } },
          ],
        },
      ],
    })),
    {
      method: "getSignaturesForAddress",
      params: [
        publicKey,
        { commitment: "confirmed", limit: 10, before: publicSignature },
      ],
    },
    {
      method: "getTransaction",
      params: [
        publicSignature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    },
  ];
  for (const read of reads) {
    const payload = { jsonrpc: "2.0", id: 1, ...read };
    let calls = 0;
    const response = await handleDevnetRpc(
      request(payload),
      async (url, init) => {
        calls++;
        assert.equal(url, DEVNET_RPC_URL);
        assert.deepEqual(JSON.parse(init?.body as string), payload);
        return new Response('{"jsonrpc":"2.0","id":1,"result":null}');
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test("Devnet proxy rejects unrelated or unfiltered program scans, unbounded history and arbitrary transaction encoding", async () => {
  const badReads = [
    {
      method: "getProgramAccounts",
      params: [
        publicKey,
        {
          encoding: "base64",
          commitment: "confirmed",
          withContext: true,
          filters: [{ dataSize: 48 }, campaignFilter],
        },
      ],
    },
    {
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          commitment: "confirmed",
          encoding: "base64",
          withContext: true,
          filters: [],
        },
      ],
    },
    {
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          commitment: "confirmed",
          encoding: "base64",
          withContext: true,
          filters: [{ dataSize: 80 }, contributionFilter],
        },
      ],
    },
    {
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          commitment: "confirmed",
          encoding: "base64",
          withContext: true,
          filters: [{ dataSize: 48 }, contributionFilter],
        },
      ],
    },
    {
      method: "getProgramAccounts",
      params: [
        OPENFUNDS_PROGRAM_ADDRESS,
        {
          commitment: "confirmed",
          encoding: "base64",
          withContext: true,
          filters: [{ dataSize: 48 }, campaignFilter],
          dataSlice: { length: 0, offset: 0 },
        },
      ],
    },
    {
      method: "getSignaturesForAddress",
      params: [publicKey, { commitment: "confirmed", limit: 1_000 }],
    },
    {
      method: "getSignaturesForAddress",
      params: [publicKey, { commitment: "confirmed", limit: 0 }],
    },
    {
      method: "getSignaturesForAddress",
      params: [
        publicKey,
        { commitment: "confirmed", limit: 10, before: "bad-signature" },
      ],
    },
    {
      method: "getTransaction",
      params: [
        publicSignature,
        {
          commitment: "confirmed",
          encoding: "base64",
          maxSupportedTransactionVersion: 0,
        },
      ],
    },
    {
      method: "getTransaction",
      params: [
        "not-a-signature",
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    },
  ];
  for (const read of badReads) {
    const response = await handleDevnetRpc(
      request({ jsonrpc: "2.0", id: 1, ...read }),
      async () => {
        throw new Error("Network must not be called");
      },
    );
    assert.equal(response.status, 400);
  }
});
