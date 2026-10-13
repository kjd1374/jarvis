import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/workspace/module-placeholder";

export const metadata: Metadata = { title: "설정" };
export default function SettingsPage() {
  return <ModulePlaceholder href="/settings" eyebrow="PREFERENCES" title="설정" description="나에게 더 잘 맞는 워크스페이스를 만들어가세요." emptyTitle="당신에게 맞춰질 공간." emptyDescription="프로필과 화면 설정, 알림 등 나만의 환경을 관리할 공간입니다." />;
}
