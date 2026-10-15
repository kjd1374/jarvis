import type { Metadata } from "next";
import { AgentWorkspace } from "@/components/workspace/agent-workspace";
export const metadata: Metadata = { title: "자료 검색 · AI 질문" };
export default function AssistantPage() { return <AgentWorkspace />; }
