import { handleDevnetRpc } from "@/lib/solana/devnet-rpc-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleDevnetRpc(request);
}
