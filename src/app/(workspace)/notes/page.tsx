import type { Metadata } from "next";
import { ContextPage } from "@/components/workspace/context-page";

export const metadata: Metadata = { title: "맥락" };
export default function NotesPage() {
  return <ContextPage />;
}
