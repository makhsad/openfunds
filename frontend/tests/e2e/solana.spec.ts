import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getBase58Decoder } from "@solana/kit";

const TEST_PUBLIC_ADDRESS = getBase58Decoder().decode(
  new Uint8Array(32).fill(7),
);
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

test("Devnet page has honest undeployed state, no demo controls and accessible responsive layout", async ({
  page,
}) => {
  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    const result =
      request.method === "getGenesisHash"
        ? DEVNET_GENESIS
        : { context: { slot: 1 }, value: null };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/solana");
  await expect(
    page.getByRole("heading", { name: "Test your OpenFunds campaign" }),
  ).toBeVisible();
  await expect(page.getByText("Not deployed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create campaign on Devnet",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
  await expect(
    page.getByText("Phantom was not found.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toBeDisabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Phantom public connection reads test SOL while undeployed program cannot request signatures", async ({
  page,
}) => {
  await page.addInitScript((publicAddress) => {
    let isConnected = false;
    let publicKey: { toString(): string } | null = null;
    const listeners = new Map<string, ((key?: unknown) => void)[]>();
    const provider = {
      isPhantom: true,
      get isConnected() {
        return isConnected;
      },
      get publicKey() {
        return publicKey;
      },
      async connect() {
        isConnected = true;
        publicKey = { toString: () => publicAddress };
        return { publicKey };
      },
      async disconnect() {
        isConnected = false;
        publicKey = null;
        listeners.get("disconnect")?.forEach((listener) => listener());
      },
      async request() {
        throw new Error("Undeployed program must never ask to sign");
      },
      on(event: string, listener: (key?: unknown) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      removeListener(event: string, listener: (key?: unknown) => void) {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== listener),
        );
      },
    };
    Object.defineProperty(window, "phantom", { value: { solana: provider } });
  }, TEST_PUBLIC_ADDRESS);
  await page.route("**/api/solana/devnet", async (route) => {
    const request = route.request().postDataJSON();
    const result =
      request.method === "getGenesisHash"
        ? DEVNET_GENESIS
        : request.method === "getBalance"
          ? { context: { slot: 1 }, value: 5_500_000_000 }
          : { context: { slot: 1 }, value: null };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/solana");
  await page
    .getByRole("button", { name: "Connect Phantom", exact: true })
    .click();
  await expect(
    page.getByText("Phantom connected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("5.5 SOL", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create campaign on Devnet",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: /transaction/i })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Disconnect Phantom", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect Phantom", exact: true }),
  ).toBeEnabled();
});
