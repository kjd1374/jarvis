import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
