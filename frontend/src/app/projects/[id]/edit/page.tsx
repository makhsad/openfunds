import { PlatformEdit } from "@/features/platform/platform-pages";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlatformEdit campaignAddress={id} />;
}
