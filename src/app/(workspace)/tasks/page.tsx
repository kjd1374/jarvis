import type { Metadata } from "next";
import { WorkItems } from "@/components/workspace/work-items";

export const metadata: Metadata = { title: "업무" };
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <WorkItems kind="tasks" initialView={view === "requests" ? "requests" : "tasks"} />;
}
