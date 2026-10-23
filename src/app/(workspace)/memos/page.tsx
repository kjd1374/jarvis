import type { Metadata } from "next";
import { MemosPage } from "@/components/workspace/memos-page";
export const metadata: Metadata = { title: "메모" };
export default function Page() { return <MemosPage />; }
