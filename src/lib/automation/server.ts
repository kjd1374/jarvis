import "server-only";
import { authorize, CloudError, loadSpace, saveSpace } from "../cloud/server";
import type { Space, WorkspaceData } from "../workspace/types";
export async function changeWorkspace(request: Request, space: Space, transform: (data: WorkspaceData, deviceId: string) => { data: WorkspaceData; result: Record<string, unknown> }) {
  const auth = await authorize(request);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await loadSpace(auth, space);
    const { data, result } = transform(snapshot.data, auth.deviceId);
    if (data === snapshot.data) return result;
    try {
      await saveSpace(auth, space, data, snapshot.revision);
      return result;
    } catch (error) {
      if (!(error instanceof CloudError) || error.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new CloudError(409, "revision_conflict", "다른 저장이 진행 중입니다. 잠시 후 다시 시도해주세요.");
}
