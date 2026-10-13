import type { Metadata } from "next";
import { WorkItems } from "@/components/workspace/work-items";

export const metadata: Metadata = { title: "업무" };
export default function TasksPage() {
  return <WorkItems kind="tasks" />;
}
