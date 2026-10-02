import { PlatformProject } from "@/features/platform/platform-pages";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlatformProject key={id} campaignAddress={id} />;
}
