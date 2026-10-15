import {
  commitWorkspace,
  readCloudLocal,
  readFile,
} from "../workspace/storage";
import { type Space, type WorkspaceData } from "../workspace/types";
import { mergeWorkspace, scopeWorkspace } from "../workspace/transfer";
import { canonical, replaceSpace } from "./records";
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
        if (sync.dirty[space] === null) {
          data = replaceSpace(data, remote.data, space);
          sync.revisions[space] = remote.revision;
        }
      }
      return { data, sync };
    },
  });
}
// Multiple tabs may flush concurrently: server CAS and local generation checks
// keep a late acknowledgement from clearing newer pending edits.
export async function flushCloud(accountId: string) {
  for (;;) {
    const snapshot = await readCloudLocal(accountId);
    const space = (["company", "personal"] as const).find(
      (s) => snapshot.sync.dirty[s] !== null,
    );
    if (!space) return;
    const generation = snapshot.sync.dirty[space];
    const local = scopeWorkspace(snapshot.data, space);
    const remote = await pullCloud(space);
    const matches = canonical(local) === canonical(remote.data);
    if (remote.revision !== snapshot.sync.revisions[space] && !matches)
      throw new CloudConflict(space, local, remote);
    let revision = remote.revision;
    if (!matches) {
      try {
        revision = (await pushCloud(space, local, remote.revision)).revision;
      } catch (e) {
        if (e instanceof CloudRequestError && e.status === 409)
          throw new CloudConflict(space, local, await pullCloud(space));
        throw e;
      }
    }
    await commitWorkspace((d) => d, [], {
      accountId,
      cloudUpdate(data, sync) {
        return {
          data,
          sync: {
            ...sync,
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
  if (
    remote.revision !== conflict.remote.revision ||
    canonical(local) !== canonical(conflict.local)
  )
    throw new CloudConflict(conflict.space, local, remote);
  const merged = mergeWorkspace(
    preferLocal ? local : remote.data,
    preferLocal ? remote.data : local,
  ).data;
  return commitWorkspace((d) => d, [], {
    accountId,
    trackCloud: true,
    cloudUpdate(data, sync) {
      return {
        data: replaceSpace(data, merged, conflict.space),
        sync: {
          ...sync,
          revisions: { ...sync.revisions, [conflict.space]: remote.revision },
        },
      };
    },
  });
}
