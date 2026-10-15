import {
  commitWorkspace,
  readCloudLocal,
  readFile,
} from "../workspace/storage";
import { type Space, type WorkspaceData } from "../workspace/types";
import { scopeWorkspace } from "../workspace/transfer";
import { canonical, replaceSpace } from "./records";
import { mergeCloudWorkspace } from "./merge";
import {
  pullCloud,
  pushCloud,
  uploadCloudFile,
  CloudRequestError,
} from "./client";

type Remote = Awaited<ReturnType<typeof pullCloud>>;
export class CloudConflict extends Error {
  readonly reviewId = crypto.randomUUID();
  constructor(
    public space: Space,
    public local: WorkspaceData,
    public remote: Remote,
    public base?: WorkspaceData,
  ) {
    super(
      "다른 기기의 변경과 이 기기의 저장 대기가 충돌했습니다. 내용을 검토해주세요.",
    );
  }
}
export async function hydrateCloud(accountId: string) {
  const [company, personal] = await Promise.all([
    pullCloud("company"),
    pullCloud("personal"),
  ]);
  return commitWorkspace((d) => d, [], {
    accountId,
    cloudUpdate(data, sync) {
      sync = structuredClone(sync);
      for (const [space, remote] of [
        ["company", company],
        ["personal", personal],
      ] as const) {
        if (sync.dirty[space] === null && remote.revision >= sync.revisions[space]) {
          data = replaceSpace(data, remote.data, space);
          sync.revisions[space] = remote.revision;
          sync.bases = { ...sync.bases, [space]: remote.data };
        }
      }
      return { data, sync };
    },
  });
}
// Multiple tabs may flush concurrently: server CAS and local generation checks
// keep a late acknowledgement from clearing newer pending edits.
export async function flushCloud(accountId: string) {
  let collisions = 0;
  for (;;) {
    const snapshot = await readCloudLocal(accountId);
    const space = (["company", "personal"] as const).find(
      (s) => snapshot.sync.dirty[s] !== null,
    );
    if (!space) return;
    const generation = snapshot.sync.dirty[space];
    const local = scopeWorkspace(snapshot.data, space);
    const remote = await pullCloud(space);
    const base = snapshot.sync.bases?.[space];
    let candidate = local;
    if (remote.revision !== snapshot.sync.revisions[space] && canonical(local) !== canonical(remote.data)) {
      const merged = mergeCloudWorkspace(base, local, remote.data);
      if (!base || merged.conflicts.length) throw new CloudConflict(space, local, remote, base);
      candidate = merged.data;
    }
    const matches = canonical(candidate) === canonical(remote.data);
    let revision = remote.revision;
    if (!matches) {
      try {
        revision = (await pushCloud(space, candidate, remote.revision)).revision;
      } catch (e) {
        if (e instanceof CloudRequestError && e.status === 409) {
          if (++collisions < 5) continue;
          throw new Error("서버 갱신과 저장이 겹쳤습니다. 입력은 이 기기에 보관되어 있습니다. 서버 저장을 다시 시도해주세요.");
        }
        throw e;
      }
    }
    collisions = 0;
    await commitWorkspace((d) => d, [], {
      accountId,
      cloudUpdate(data, sync) {
        if (sync.revisions[space] > revision) return { data, sync };
        const current = scopeWorkspace(data, space);
        const rebased = mergeCloudWorkspace(local, current, candidate);
        if (rebased.conflicts.length) throw new CloudConflict(space, current, { data: candidate, revision }, local);
        return {
          data: replaceSpace(data, rebased.data, space),
          sync: {
            ...sync,
            bases: { ...sync.bases, [space]: candidate },
            revisions: {
              ...sync.revisions,
              [space]: Math.max(sync.revisions[space], revision),
            },
          },
        };
      },
    });
    for (const file of local.documents) {
      if (file.sourceUrl || snapshot.sync.uploadedFiles.includes(file.id))
        continue;
      await uploadCloudFile(space, file.id, await readFile(file.id, accountId));
      await commitWorkspace((d) => d, [], {
        accountId,
        cloudUpdate(data, sync) {
          return {
            data,
            sync: {
              ...sync,
              uploadedFiles: [...new Set([...sync.uploadedFiles, file.id])],
            },
          };
        },
      });
    }
    await commitWorkspace((d) => d, [], {
      accountId,
      cloudUpdate(data, sync) {
        return {
          data,
          sync: {
            ...sync,
            dirty: {
              ...sync.dirty,
              [space]:
                sync.dirty[space] === generation ? null : sync.dirty[space],
            },
          },
        };
      },
    });
  }
}
export async function resolveCloudConflict(
  accountId: string,
  conflict: CloudConflict,
  preferLocal: boolean,
) {
  const remote = await pullCloud(conflict.space);
  const current = await readCloudLocal(accountId);
  const local = scopeWorkspace(current.data, conflict.space);
  if (canonical(local) !== canonical(conflict.local))
    throw new CloudConflict(conflict.space, local, remote, current.sync.bases?.[conflict.space]);
  const reviewed = mergeCloudWorkspace(conflict.base, local, conflict.remote.data, preferLocal ? "local" : "remote").data;
  // Keep the choice tied to the reviewed values, not to a workspace-wide revision.
  const merged = mergeCloudWorkspace(conflict.remote.data, reviewed, remote.data);
  if (merged.conflicts.length) throw new CloudConflict(conflict.space, local, remote, conflict.base);
  return commitWorkspace((d) => d, [], {
    accountId,
    trackCloud: true,
    cloudUpdate(data, sync) {
      const latest = scopeWorkspace(data, conflict.space);
      if (canonical(latest) !== canonical(local) || sync.revisions[conflict.space] > remote.revision)
        throw new CloudConflict(conflict.space, latest, remote, sync.bases?.[conflict.space]);
      return {
        data: replaceSpace(data, merged.data, conflict.space),
        sync: {
          ...sync,
          bases: { ...sync.bases, [conflict.space]: remote.data },
          revisions: { ...sync.revisions, [conflict.space]: remote.revision },
        },
      };
    },
  });
}
