/** Read-only public RPC proxy. Wallet signatures never pass through this route. */
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

const METHODS = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getBlockHeight",
]);

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
