import type { Metadata } from "next";
import { WorkItems } from "@/components/workspace/work-items";

export const metadata: Metadata = { title: "프로젝트" };
export default function ProjectsPage() {
  return <WorkItems kind="projects" />;
}
