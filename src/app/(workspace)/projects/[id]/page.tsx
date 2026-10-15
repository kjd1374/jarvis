import type { Metadata } from "next";
import { ProjectDetail } from "@/components/workspace/project-detail";

export const metadata: Metadata = { title: "프로젝트 상세" };
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetail projectId={id} />;
}
