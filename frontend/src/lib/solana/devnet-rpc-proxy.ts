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
  const size = filters.find(
    (filter) =>
      filter &&
      Object.keys(filter).length === 1 &&
      (filter.dataSize === 48 || filter.dataSize === 80),
  )?.dataSize;
  if (size !== 48 && size !== 80) return false;
  const discriminator = getBase58Decoder().decode(
    new Uint8Array(
      ANCHOR_DISCRIMINATORS[size === 48 ? "campaign" : "contribution"],
    ),
  );
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
    if (
      memcmp.offset === 0 &&
      memcmp.bytes === discriminator &&
      !hasDiscriminator
    ) {
      hasDiscriminator = true;
      continue;
    }
    if (
      size === 80 &&
      (memcmp.offset === 8 || memcmp.offset === 40) &&
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
    (size === 48 ? filters.length === 2 : filters.length === 3 && hasIdentity)
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
