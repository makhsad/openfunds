import { ProjectsHome } from "@/components/projects-home";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return <ProjectsHome live={mode !== "demo"} />;
}
