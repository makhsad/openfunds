import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddressDecoder } from "@solana/kit";
import {
  readRememberedWallets,
  rememberWallet,
} from "../src/lib/solana/wallet-registry";

const publicAddress = (value: number) =>
  getAddressDecoder().decode(new Uint8Array(32).fill(value));

test("remembered accounts accept only public keys, bounded labels and distinct addresses", () => {
  const address = publicAddress(1);
  const result = readRememberedWallets(
    JSON.stringify([
      { address, label: "  Автор  " },
      { address, label: "duplicate" },
      { address: "not a public key", label: "invalid" },
      { address: publicAddress(2), label: "x".repeat(90) },
      { address: publicAddress(3), secretKey: "unexpected" },
      null,
    ]),
  );
  assert.deepEqual(result, [
    { address, label: "Автор" },
    { address: publicAddress(2), label: "x".repeat(60) },
    { address: publicAddress(3), label: "" },
  ]);
  assert.deepEqual(readRememberedWallets("broken"), []);
  assert.deepEqual(readRememberedWallets('{"address":"x"}'), []);
});

test("switching keeps previously remembered accounts without assigning signing authority", () => {
  const first = rememberWallet([], publicAddress(1));
  const second = rememberWallet(first, publicAddress(2));
  const third = rememberWallet(second, publicAddress(3));
  assert.equal(rememberWallet(third, publicAddress(1)), third);
  assert.equal(third.length, 3);
  assert.ok(
    third.every(
      (wallet) => Object.keys(wallet).sort().join() === "address,label",
    ),
  );
  assert.throws(() => rememberWallet(third, "invalid"));
});

test("remembered account history stays bounded when many accounts are used", () => {
  let wallets = [] as ReturnType<typeof readRememberedWallets>;
  for (let index = 1; index <= 18; index++)
    wallets = rememberWallet(wallets, publicAddress(index));
  assert.equal(wallets.length, 12);
  assert.equal(wallets[0].address, publicAddress(7));
  assert.equal(wallets.at(-1)?.address, publicAddress(18));
});
