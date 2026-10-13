import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/workspace/module-placeholder";

export const metadata: Metadata = { title: "노트" };
export default function NotesPage() {
  return <ModulePlaceholder href="/notes" eyebrow="MY NOTES" title="노트" description="떠오른 생각이 사라지기 전에, 잠시 머물 자리를 만들어주세요." emptyTitle="작은 생각도 소중하니까." emptyDescription="메모, 기록, 영감이 되어줄 아이디어를 담아둘 공간입니다." />;
}
