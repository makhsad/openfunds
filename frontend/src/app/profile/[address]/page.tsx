import { address as validateAddress } from "@solana/kit";
import { notFound } from "next/navigation";
import { PlatformPublicProfile } from "@/features/platform/platform-pages";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  try {
    validateAddress(address);
  } catch {
    notFound();
  }
  return <PlatformPublicProfile address={address} />;
}
