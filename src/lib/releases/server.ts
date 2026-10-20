import "server-only";
import { randomUUID } from "node:crypto";
import { authorize, CloudError, loadSpace, saveSpace } from "../cloud/server";
import { credentialsFor } from "../automation/providers";
import { sealProvider, openProvider } from "../automation/provider-vault.mjs";
import { repositoryFor } from "../automation/state";
import { cloudApi, inspectRelease, advanceRelease, workflowRepository, releaseError } from "./engine.mjs";
import { projectForRelease, releasePatch, releaseBusy, finishRelease, type ProjectRelease, type ReleasePlan } from "./state";
import type { Space, WorkspaceData } from "../workspace/types";
type Auth = Awaited<ReturnType<typeof authorize>>;
export async function releaseEdit(auth: Auth, space: Space, transform: (data: WorkspaceData) => WorkspaceData) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await loadSpace(auth, space), next = transform(snapshot.data);
    if (next === snapshot.data) return snapshot.data;
    try { await saveSpace(auth, space, next, snapshot.revision); return next; }
    catch (e) { if (!(e instanceof CloudError) || e.status !== 409 || attempt === 3) throw e; }
  }
  throw releaseError("release_conflict");
}
function ownedCredentials(data: WorkspaceData, auth: Auth, space: Space) {
  const c = credentialsFor(data, auth.ownerId, space, ["github", "vercel", "supabase"]);
  if (!c.github?.token || !c.vercel?.token) throw releaseError("release_connections_required");
  return c;
}
function repoFor(data: WorkspaceData, space: Space, projectId: string, requested?: unknown) {
  const repos = [...new Set(data.services.filter(s => s.space === space && s.projectId === projectId).map(repositoryFor).filter(Boolean))];
  const selected = typeof requested === "string" ? requested : repos.length === 1 ? repos[0] : undefined;
  if (!selected || !repos.includes(selected)) throw releaseError("release_repository_required");
  return selected;
}
function idle(data: WorkspaceData, space: Space, projectId: string) {
  const p = projectForRelease(data, space, projectId);
  if (p.stage === "idea" || p.setup && ["queued", "running"].includes(p.setup.status) || p.automation?.turns.some(t => ["queued", "running"].includes(t.status))) throw releaseError("development_busy");
  return p;
}
async function grantFor(request: Request, auth: Auth, space: Space, projectId: string, r: ProjectRelease) {
  let session = (await auth.client.auth.getSession()).data.session;
  let bearer = request.headers.get("authorization")?.slice(7) ?? session?.access_token;
  const expiration = (token?: string) => { try { return Number(JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()).exp) * 1000; } catch { return 0; } };
  if (expiration(bearer) < Date.now() + 26 * 60_000 && session?.refresh_token) {
    session = (await auth.client.auth.refreshSession()).data.session; bearer = session?.access_token;
  }
  if (!bearer || expiration(bearer) < Date.now() + 26 * 60_000) throw releaseError("release_session_refresh_required");
  const expiresAt = Date.now() + 25 * 60_000;
  const ticket = sealProvider({ bearer, ownerId: auth.ownerId, deviceId: auth.deviceId, space, projectId, jobId: r.id, executionId: r.executionId, expiresAt }, process.env.JARVIS_PREVIEW_SIGNING_KEY, "jarvis-release", "worker", "grant-v1");
  return { ticket, runUntil: new Date(expiresAt).toISOString() };
}
export async function releaseAction(request: Request, auth: Auth, space: Space, body: Record<string, unknown>) {
  if (typeof body.projectId !== "string") throw releaseError("project_missing");
  const projectId = body.projectId, stamp = new Date().toISOString();
  let { data } = await loadSpace(auth, space), project = projectForRelease(data, space, projectId);
  if (body.action === "status") {
    if (releaseBusy(project.release) && Date.parse(project.release?.runUntil ?? "") <= Date.now()) {
      data = await releaseEdit(auth, space, d => { const p = projectForRelease(d, space, projectId); return p.release && releaseBusy(p.release) && Date.parse(p.release.runUntil ?? "") <= Date.now() ? releasePatch(d,p,{...p.release,status:"failed",error:"release_worker_expired",leaseToken:undefined,leaseUntil:undefined,updatedAt:stamp}) : d; });
      project = projectForRelease(data, space, projectId);
    }
    return project.release ?? null;
  }
  if (body.action === "cancel") {
    data = await releaseEdit(auth, space, d => { const p = projectForRelease(d, space, projectId), r = p.release; if (!r || r.id !== body.jobId || !["queued","running","failed"].includes(r.status)) throw releaseError("release_changed"); return releasePatch(d,p,{...r,status:"cancelled",leaseToken:undefined,leaseUntil:undefined,executionId:randomUUID(),updatedAt:stamp}); });
    return projectForRelease(data, space, projectId).release;
  }
  if (body.action === "development") {
    data = await releaseEdit(auth, space, d => { const p = projectForRelease(d, space, projectId); if (releaseBusy(p.release)) throw releaseError("release_busy"); return {...d,projects:d.projects.map(row=>row.id===p.id?{...row,stage:"development" as const}:row)}; });
    return projectForRelease(data, space, projectId).release ?? null;
  }
  if (body.action === "complete") {
    if (body.functionalChecked !== true) throw releaseError("functional_check_required");
    const r = project.release;
    if (!r || r.id !== body.jobId || r.status !== "deployed") throw releaseError("release_not_verified");
    const c = ownedCredentials(data, auth, space), api = cloudApi(c);
    const deployment = await api("vercel", `/v13/deployments/${r.deploymentId}`);
    const alias = await api("vercel", `/v4/aliases/${new URL(r.url!).hostname}`);
    if (deployment?.projectId !== r.vercelId || deployment?.meta?.githubCommitSha !== r.plan.sha || deployment?.readyState !== "READY" || alias?.deployment?.id !== r.deploymentId) throw releaseError("deployment_source_mismatch");
    data = await releaseEdit(auth, space, d => finishRelease(d,space,projectId,body.jobId,stamp));
    return projectForRelease(data,space,projectId).release;
  }
  const c = ownedCredentials(data, auth, space), api = cloudApi(c);
  idle(data, space, projectId);
  if (body.action === "plan") {
    if (releaseBusy(project.release)) throw releaseError("release_busy");
    const previous = project.release;
    if (previous && (previous.databaseIntent && !previous.databaseId && body.database !== "existing" || previous.vercelIntent && !previous.vercelId && !body.vercelId || previous.deploymentIntent && !previous.deploymentId)) throw releaseError("resource_creation_uncertain");
    const repository = repoFor(data,space,projectId,body.repository);
    const plan = await inspectRelease({ project, repository, ownerId: auth.ownerId, database: typeof body.database === "string" ? body.database : "auto", databaseId: body.databaseId, vercelId: body.vercelId },api,c);
    const r: ProjectRelease = {id:randomUUID(),status:"planned",phase:"database",createdAt:stamp,updatedAt:stamp,ownerDevice:auth.deviceId,plan:plan as ReleasePlan,
      history:[...(project.release?.history??[]),...(project.release?[{id:project.release.id,sha:project.release.plan.sha,status:project.release.status,at:project.release.updatedAt,...(project.release.url?{url:project.release.url}:{})}]:[])].slice(-20)};
    data = await releaseEdit(auth,space,d=>{const p=idle(d,space,projectId);if(releaseBusy(p.release)||p.release?.id!==project.release?.id||repoFor(d,space,projectId,repository)!==repository)throw releaseError("release_changed");return releasePatch(d,p,r);});
    return projectForRelease(data,space,projectId).release;
  }
  if (body.action !== "start" && body.action !== "retry") throw releaseError("invalid_release_action");
  const current=project.release;
  if(!current||current.id!==body.jobId||!(body.action==="start"?current.status==="planned":["failed","cancelled","interrupted"].includes(current.status))||body.reviewed!==true)throw releaseError("release_review_required");
  repoFor(data,space,projectId,current.plan.repository);
  const head=await api("github",`/repos/${current.plan.repository}/commits/${encodeURIComponent(current.plan.branch)}`);
  if(head?.sha!==current.plan.sha)throw releaseError("release_source_changed");
  const workerRepo=await api("github",`/repos/${workflowRepository}`);
  if(!workerRepo || workerRepo.private!==false)throw releaseError("public_worker_required");
  const executionId=randomUUID(), r={...current,phase:current.phase==="done"?"health" as const:current.phase,confirmedAt:undefined,status:"queued" as const,executionId,ownerDevice:auth.deviceId,error:undefined,leaseUntil:undefined,leaseToken:undefined,updatedAt:stamp};
  const grant=await grantFor(request,auth,space,projectId,r);
  data=await releaseEdit(auth,space,d=>{const p=idle(d,space,projectId);if(p.release?.id!==current.id||p.release.status!==current.status)throw releaseError("release_changed");return releasePatch(d,p,{...r,runUntil:grant.runUntil});});
  try {
    const run=await api("github",`/repos/${workflowRepository}/actions/workflows/project-release.yml/dispatches`,"POST",{ref:"main",return_run_details:true,inputs:{job_id:r.id,ticket:grant.ticket}});
    if(!run)throw releaseError("release_workflow_missing");
    const workflowUrl=typeof run.html_url==="string"&&new RegExp(`^https://github.com/${workflowRepository}/actions/runs/[0-9]+$`).test(run.html_url)?run.html_url:`https://github.com/${workflowRepository}/actions`;
    data=await releaseEdit(auth,space,d=>{const p=projectForRelease(d,space,projectId);return p.release?.id===r.id&&p.release.executionId===executionId?releasePatch(d,p,{...p.release,workflowUrl}):d;});
  } catch {
    data=await releaseEdit(auth,space,d=>{const p=projectForRelease(d,space,projectId);return p.release?.id===r.id&&p.release.executionId===executionId?releasePatch(d,p,{...p.release,status:"failed",error:"release_dispatch_failed",executionId:randomUUID(),updatedAt:stamp}):d;});
  }
  return projectForRelease(data,space,projectId).release;
}
export async function workerRelease(request: Request, ticket: unknown) {
  if(typeof ticket!=="string"||ticket.length>12000)throw releaseError("invalid_release_grant");
  const grant=openProvider(ticket,process.env.JARVIS_PREVIEW_SIGNING_KEY,"jarvis-release","worker","grant-v1");
  if(!grant||grant.expiresAt<=Date.now()||!['company','personal'].includes(grant.space)||typeof grant.bearer!=="string")throw releaseError("invalid_release_grant");
  const auth=await authorize(new Request(request.url,{headers:{Authorization:`Bearer ${grant.bearer}`}}));
  if(auth.ownerId!==grant.ownerId||auth.deviceId!==grant.deviceId)throw releaseError("invalid_release_grant");
  const space=grant.space as Space,token=randomUUID(),stamp=new Date().toISOString();let claimed=false;
  const data=await releaseEdit(auth,space,d=>{
    claimed=false;const p=projectForRelease(d,space,grant.projectId),r=p.release;
    if(!r||r.id!==grant.jobId||r.executionId!==grant.executionId||r.ownerDevice!==grant.deviceId)throw releaseError("stale_release");
    if(!releaseBusy(r))return d;
    if(Date.parse(r.leaseUntil??'')>Date.now())return d;
    claimed=true;return releasePatch(d,p,{...r,status:"running",leaseToken:token,leaseUntil:new Date(Date.now()+120000).toISOString(),updatedAt:stamp});
  });
  const current=projectForRelease(data,space,grant.projectId).release!;
  if(!claimed)return{status:current.status,phase:current.phase,retryAfter:5000};
  const persist=async(next:ProjectRelease)=>{await releaseEdit(auth,space,d=>{const p=projectForRelease(d,space,grant.projectId),r=p.release;if(!r||r.id!==grant.jobId||r.executionId!==grant.executionId||r.leaseToken!==token||!releaseBusy(r)||Date.parse(r.leaseUntil??'')<=Date.now())throw releaseError("stale_release");return releasePatch(d,p,next);});};
  try {
    const credentials=ownedCredentials(data,auth,space), remote=cloudApi(credentials);
    const api=async(provider:string,path:string,method="GET",body?:unknown)=>{
      const latest=(await loadSpace(auth,space)).data,p=projectForRelease(latest,space,grant.projectId),r=p.release;
      if(!r||r.executionId!==grant.executionId||r.leaseToken!==token||!releaseBusy(r)||Date.parse(r.leaseUntil??"")<=Date.now())throw releaseError("stale_release");
      repoFor(latest,space,grant.projectId,current.plan.repository);
      for(const provider of ["github","vercel",...(current.plan.database!=="none"?["supabase"]:[])] as const){
        const key=provider as "github"|"vercel"|"supabase";
        if(latest.providerConnections?.[space]?.[key]?.sealed!==data.providerConnections?.[space]?.[key]?.sealed)throw releaseError("provider_scope_changed");
      }
      return remote(provider,path,method,body);
    };
    repoFor(data,space,grant.projectId,current.plan.repository);
    const next=await advanceRelease(current,api,credentials,persist);
    await persist({...next,updatedAt:new Date().toISOString(),leaseToken:undefined,leaseUntil:undefined});
    return{status:next.status,phase:next.phase,retryAfter:next.phase===current.phase?10000:1000};
  } catch(e) {
    const code=e instanceof Error&&/^[a-z_]{1,100}$/.test(e.message)?e.message:"release_step_failed";
    if(code==="stale_release")return{status:"cancelled",phase:current.phase};
    // Read back checkpointed resource IDs before reporting failure.
    const latest=projectForRelease((await loadSpace(auth,space)).data,space,grant.projectId).release!;
    await persist({...latest,status:"failed",error:code,leaseToken:undefined,leaseUntil:undefined,updatedAt:new Date().toISOString()});
    return{status:"failed",phase:latest.phase,error:code};
  }
}
