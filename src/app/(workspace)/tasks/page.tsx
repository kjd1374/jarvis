import type { Metadata } from "next";
import { WorkItems } from "@/components/workspace/work-items";
import { SheetWorkspace } from "@/components/workspace/sheet-workspace";

export const metadata: Metadata = { title: "업무" };
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; document?: string }> }) {
  const { view, document } = await searchParams;
  if (view === "records" || view === "requests") return <WorkItems kind="tasks" initialView={view === "requests" ? "requests" : "tasks"} />;
  return <SheetWorkspace initialDocument={document} />;
}
