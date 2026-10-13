import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/workspace/module-placeholder";

export const metadata: Metadata = { title: "작업" };
export default function TasksPage() {
  return <ModulePlaceholder href="/tasks" eyebrow="MY TASKS" title="작업" description="오늘 할 일과 다음 할 일 사이, 나만의 흐름을 만들어보세요." emptyTitle="하나씩, 가볍게 시작해보세요." emptyDescription="할 일을 정리하고, 우선순위를 정하고, 작은 성취를 쌓아갈 공간입니다." />;
}
