import type { Metadata } from "next";
import { PlatformSetup } from "@/features/platform/platform-setup";

export const metadata: Metadata = {
  title: "OpenFunds | Platform activation",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return <PlatformSetup />;
}
