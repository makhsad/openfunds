/** Read-only public RPC proxy. Wallet signatures never pass through this route. */
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
} from "@solana/kit";
import {
  ANCHOR_DISCRIMINATORS,
  OPENFUNDS_PROGRAM_ADDRESS,
} from "./phantom-gateway";
import { PROJECT_DISCRIMINATORS } from "./project-ledger";
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

const METHODS = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getBlockHeight",
  "getProgramAccounts",
  "getSignaturesForAddress",
  "getTransaction",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publicAddress(value: unknown): boolean {
  try {
    return (
      typeof value === "string" &&
      getAddressEncoder().encode(address(value)).length === 32
    );
  } catch {
    return false;
  }
}

function transactionSignature(value: unknown): boolean {
  try {
    return (
      typeof value === "string" &&
      getBase58Encoder().encode(value).length === 64
    );
  } catch {
    return false;
  }
}

function boundedRead(method: string, params: readonly unknown[]): boolean {
  if (
    ![
      "getProgramAccounts",
      "getSignaturesForAddress",
      "getTransaction",
    ].includes(method)
  )
    return true;
  if (params.length !== 2) return false;
  const config = record(params[1]);
  if (!config || config.commitment !== "confirmed") return false;
  if (method === "getTransaction")
    return (
      transactionSignature(params[0]) &&
      config.encoding === "jsonParsed" &&
      config.maxSupportedTransactionVersion === 0 &&
      Object.keys(config).every((key) =>
        ["commitment", "encoding", "maxSupportedTransactionVersion"].includes(
          key,
        ),
      )
    );
  if (method === "getSignaturesForAddress")
    return (
      publicAddress(params[0]) &&
      typeof config.limit === "number" &&
      Number.isInteger(config.limit) &&
      config.limit >= 1 &&
      config.limit <= 20 &&
      (config.before === undefined || transactionSignature(config.before)) &&
      Object.keys(config).every((key) =>
        ["commitment", "limit", "before"].includes(key),
      )
    );
  if (
    params[0] !== OPENFUNDS_PROGRAM_ADDRESS ||
    config.encoding !== "base64" ||
    config.withContext !== true ||
    !Array.isArray(config.filters) ||
    !Object.keys(config).every((key) =>
      ["commitment", "encoding", "withContext", "filters"].includes(key),
    )
  )
    return false;
  const filters = config.filters.map(record);
  const sizeFilters = filters.filter(
    (filter) =>
      filter &&
      Object.keys(filter).length === 1 &&
      typeof filter.dataSize === "number",
  );
  const discriminatorFilters = filters.filter(
    (filter) => record(filter?.memcmp)?.offset === 0,
  );
  if (sizeFilters.length !== 1 || discriminatorFilters.length !== 1)
    return false;
  const size = sizeFilters[0]!.dataSize;
  const expected = [
    {
      size: 48,
      discriminator: ANCHOR_DISCRIMINATORS.campaign,
      identityOffsets: [],
    },
    {
      size: 49,
      discriminator: ANCHOR_DISCRIMINATORS.campaign,
      identityOffsets: [],
    },
    {
      size: 80,
      discriminator: ANCHOR_DISCRIMINATORS.contribution,
      identityOffsets: [8, 40],
    },
    {
      size: 789,
      discriminator: PROJECT_DISCRIMINATORS.campaign,
      identityOffsets: [],
    },
    {
      size: 88,
      discriminator: PROJECT_DISCRIMINATORS.contribution,
      identityOffsets: [8, 40],
    },
    {
      size: 332,
      discriminator: PROJECT_DISCRIMINATORS.message,
      identityOffsets: [8],
    },
    {
      size: 80,
      discriminator: PROJECT_DISCRIMINATORS.legacyReceipt,
      identityOffsets: [8, 40],
    },
  ].find(
    (schema) =>
      schema.size === size &&
      record(discriminatorFilters[0]?.memcmp)?.bytes ===
        getBase58Decoder().decode(Uint8Array.from(schema.discriminator)),
  );
  if (!expected) return false;
  let hasSize = false;
  let hasDiscriminator = false;
  let hasIdentity = false;
  for (const filter of filters) {
    if (!filter || Object.keys(filter).length !== 1) return false;
    if (filter.dataSize === size && !hasSize) {
      hasSize = true;
      continue;
    }
    const memcmp = record(filter.memcmp);
    if (
      !memcmp ||
      !Object.keys(memcmp).every((key) => ["offset", "bytes"].includes(key))
    )
      return false;
    if (memcmp.offset === 0 && !hasDiscriminator) {
      hasDiscriminator = true;
      continue;
    }
    if (
      expected.identityOffsets.includes(memcmp.offset as number) &&
      publicAddress(memcmp.bytes) &&
      !hasIdentity
    ) {
      hasIdentity = true;
      continue;
    }
    return false;
  }
  return (
    hasSize &&
    hasDiscriminator &&
    (expected.identityOffsets.length === 0
      ? filters.length === 2
      : filters.length === 3 && hasIdentity)
  );
}

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function errorResponse(message: string, status: number, id: unknown = null) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32600, message } }),
    { status, headers: HEADERS },
  );
}

export async function handleDevnetRpc(
  request: Request,
  upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST")
    return errorResponse("Use POST for the Devnet RPC endpoint.", 405);

  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 32_768)
      return errorResponse("RPC request is too large.", 413);
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return errorResponse("Send one JSON-RPC request.", 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON-RPC request.", 400);
  }

  const { id, method, params, jsonrpc } = payload;
  if (
    jsonrpc !== "2.0" ||
    typeof method !== "string" ||
    !METHODS.has(method) ||
    (params !== undefined && !Array.isArray(params)) ||
    (id !== null && typeof id !== "string" && typeof id !== "number") ||
    (typeof id === "number" && !Number.isSafeInteger(id))
  )
    return errorResponse(
      "Only supported read-only Devnet RPC methods are allowed.",
      400,
    );

  if (!boundedRead(method, (params ?? []) as readonly unknown[]))
    return errorResponse(
      "Only bounded OpenFunds account scans and transaction history reads are allowed.",
      400,
      id,
    );

  try {
    const upstream = await upstreamFetch(DEVNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? [],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!upstream.ok) {
      const message =
        upstream.status === 429
          ? "Devnet RPC is busy. Try refreshing later."
          : "Devnet RPC is temporarily unavailable.";
      return errorResponse(message, upstream.status === 429 ? 429 : 502, id);
    }
    // Preserve raw u64 JSON integers. The Solana SDK decodes them losslessly.
    return new Response(await upstream.text(), {
      status: 200,
      headers: HEADERS,
    });
  } catch {
    return errorResponse(
      "Could not reach Devnet RPC. Try refreshing later.",
      503,
      id,
    );
  }
}
