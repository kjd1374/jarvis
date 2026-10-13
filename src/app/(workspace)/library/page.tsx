import type { Metadata } from "next";
import { Library } from "@/components/workspace/library";

export const metadata: Metadata = { title: "자료실" };
export default function LibraryPage() {
  return <Library />;
}
