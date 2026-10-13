import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/workspace/module-placeholder";

export const metadata: Metadata = { title: "프로젝트" };
export default function ProjectsPage() {
  return <ModulePlaceholder href="/projects" eyebrow="MY PROJECTS" title="프로젝트" description="시작하고 싶은 일에 이름을 붙이고, 한 걸음씩 나아가세요." emptyTitle="다음 멋진 시작을 위한 자리." emptyDescription="목표와 진행 상황, 함께할 작업을 한곳에 모아둘 공간입니다." />;
}
