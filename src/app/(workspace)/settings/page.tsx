import type { Metadata } from "next";
import { StorageSettings } from "@/components/workspace/storage-settings";

export const metadata: Metadata = { title: "설정" };
export default function SettingsPage() {
  return <StorageSettings />;
}
