import { redirect } from "next/navigation";
import { deriveCampaignAddresses } from "@/lib/solana/phantom-gateway";

/** Preserve existing shared links while using the single project experience. */
export default async function LegacyCampaignLink({
  params,
}: {
  params: Promise<{ creator: string }>;
}) {
  const { creator } = await params;
  try {
    const { campaignAddress } = await deriveCampaignAddresses(creator);
    redirect("/projects/" + campaignAddress);
  } catch (cause) {
    // Next's redirect is a control-flow exception; preserve it.
    if (typeof cause === "object" && cause !== null && "digest" in cause)
      throw cause;
    redirect("/projects");
  }
}
