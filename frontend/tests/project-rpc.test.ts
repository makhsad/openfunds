import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import { PROJECT_DISCRIMINATORS } from "../src/lib/solana/project-ledger";
import { OPENFUNDS_PROGRAM_ADDRESS } from "../src/lib/solana/phantom-gateway";
import {
  DEVNET_RPC_URL,
  handleDevnetRpc,
} from "../src/lib/solana/devnet-rpc-proxy";

const publicKey = getAddressDecoder().decode(new Uint8Array(32).fill(15));
function scan(
  size: number,
  discriminator: readonly number[],
  identityOffset?: number,
) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "getProgramAccounts",
    params: [
      OPENFUNDS_PROGRAM_ADDRESS,
      {
        encoding: "base64",
        commitment: "confirmed",
        withContext: true,
        filters: [
          { dataSize: size },
          {
            memcmp: {
              offset: 0,
              bytes: getBase58Decoder().decode(Uint8Array.from(discriminator)),
            },
          },
          ...(identityOffset === undefined
            ? []
            : [{ memcmp: { offset: identityOffset, bytes: publicKey } }]),
        ],
      },
    ],
  };
}
function request(payload: unknown) {
  return new Request("http://localhost/api/solana/devnet", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

test("project RPC accepts canonical V2 catalogue, backer and scoped message reads", async () => {
  const payloads = [
    scan(789, PROJECT_DISCRIMINATORS.campaign),
    scan(88, PROJECT_DISCRIMINATORS.contribution, 8),
    scan(88, PROJECT_DISCRIMINATORS.contribution, 40),
    scan(332, PROJECT_DISCRIMINATORS.message, 8),
    scan(80, PROJECT_DISCRIMINATORS.legacyReceipt, 8),
    scan(80, PROJECT_DISCRIMINATORS.legacyReceipt, 40),
  ];
  for (const payload of payloads) {
    let calls = 0;
    const response = await handleDevnetRpc(
      request(payload),
      async (url, init) => {
        calls++;
        assert.equal(url, DEVNET_RPC_URL);
        assert.deepEqual(JSON.parse(init?.body as string), payload);
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"value":[]}}');
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test("project RPC rejects unscoped chat, mismatched size/discriminator, and unrelated scans", async () => {
  const payloads = [
    scan(332, PROJECT_DISCRIMINATORS.message),
    scan(332, PROJECT_DISCRIMINATORS.message, 40),
    scan(88, PROJECT_DISCRIMINATORS.campaign, 8),
    scan(789, PROJECT_DISCRIMINATORS.contribution),
    scan(90, PROJECT_DISCRIMINATORS.contribution, 8),
    scan(88, PROJECT_DISCRIMINATORS.contribution),
  ];
  const unrelated = scan(789, PROJECT_DISCRIMINATORS.campaign);
  unrelated.params[0] = publicKey;
  payloads.push(unrelated);
  for (const payload of payloads) {
    const response = await handleDevnetRpc(request(payload), async () => {
      throw new Error("Rejected scans must not reach Devnet.");
    });
    assert.equal(response.status, 400);
  }
});
