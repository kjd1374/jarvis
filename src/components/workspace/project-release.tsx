"use client";
import { useEffect, useRef, useState } from "react";
import { type Project, dateLabel } from "@/lib/workspace/types";
import { type ProjectRelease, releaseBusy } from "@/lib/releases/state";
import { repositoryFor } from "@/lib/automation/state";
import { useWorkspace } from "./workspace-provider";
import { ProjectProviders } from "./project-providers";
import styles from "./studio.module.css";
import css from "./project-release.module.css";
const errors:Record<string,string>={
  sensitive_source_files:"저장소에 환경 비밀 파일이 포함되어 있습니다. 배포 전에 소스에서 분리해주세요.",
  source_checks_pending:"GitHub 자동 검사가 진행 중입니다. 완료 후 다시 검사해주세요.",
  source_checks_failed:"이 커밋의 GitHub 검사가 실패했습니다. 개발 대화에서 수정한 뒤 다시 검사해주세요.",
  supabase_request_failed:"Supabase 준비를 완료하지 못했습니다. 무료 프로젝트 한도와 조직 권한을 확인해주세요. 기존 자원은 유지합니다.",
  vercel_request_failed:"Vercel 준비를 완료하지 못했습니다. GitHub 앱 연결·프로젝트 권한·사용 한도를 확인해주세요.",
  release_project_selection_required:"같은 코드에 연결된 Vercel 환경이 여러 개입니다. 사용할 환경을 직접 선택해주세요.",
  existing_database_selection_required:"기존 운영환경이 있어 새 DB로 자동 대체하지 않습니다. 기존 Supabase를 선택하거나 별도 새 환경을 명시해주세요.",
  release_connections_required:"이 영역의 GitHub와 무료 Vercel 계정을 아래에서 한 번 연결해주세요.",
  github_connection_required:"GitHub의 저장소 읽기·검사 읽기·Jarvis 워크플로 실행 권한을 확인해주세요.",
  vercel_connection_required:"Vercel 계정과 GitHub 앱의 저장소 접근 권한을 확인해주세요.",
  supabase_connection_required:"무료 Supabase 조직 연결이 필요합니다.",
  free_vercel_required:"무료 Hobby 계정 범위를 선택해주세요. 유료 플랜으로 자동 전환하지 않습니다.",
  free_supabase_required:"무료 Supabase 조직이 필요합니다. 유료 자원을 만들지 않습니다.",
  release_repository_required:"이 프로젝트의 GitHub 저장소를 선택해주세요.",
  runtime_conversion_required:"이 코드는 상시 서버 또는 맥미니 연결을 사용합니다. 개발 대화에서 서버리스 운영에 맞게 변경하고 다시 검사해주세요.",
  local_storage_requires_conversion:"로컬 SQLite·파일 저장을 사용합니다. 기존 자료를 유지하고 개발 대화에서 Supabase용 코드로 전환한 뒤 다시 검사해주세요.",
  database_schema_required:"새 DB에 적용할 supabase/migrations의 SQL이 없습니다. 개발 대화에서 저장 구조와 RLS를 준비해주세요.",
  development_busy:"진행 중인 개발·환경 준비가 끝난 뒤 운영 전환을 시작해주세요.",
  release_source_changed:"검토한 뒤 기본 브랜치 코드가 바뀌었습니다. 운영 구성을 다시 검사해주세요.",
  release_changed:"다른 기기에서 배포 기록이 변경됐습니다. 최신 운영 화면을 다시 확인해주세요.",
  deployment_access_review:"배포를 확인했지만 접근 보호 또는 이동 응답으로 앱 기능을 자동 확인하지 못했습니다. 접근 정책은 유지합니다. 운영 화면을 열어 주요 기능을 직접 확인해주세요.",
  deployment_health_failed:"운영 주소가 정상 응답하지 않았습니다. 배포 로그와 앱 설정을 확인해주세요.",
  deployment_build_failed:"Vercel 빌드가 실패했습니다. 배포 로그를 확인하고 개발 대화에서 수정해주세요.",
  resource_creation_uncertain:"생성 응답을 확인하지 못했습니다. 외부 자원을 중복 생성하지 않고 기존 자원을 다시 조회합니다.",
  deployment_creation_uncertain:"배포 생성 응답을 확인하지 못했습니다. 중복 배포를 만들지 않고 기존 배포를 다시 조회합니다.",
  release_dispatch_failed:"GitHub 배포 워커를 시작하지 못했습니다. GitHub 연결의 Actions 권한과 워크플로를 확인하고 이어서 준비해주세요.",
  release_worker_expired:"클라우드 작업 시간이 만료됐습니다. 만든 자원을 유지하고 이어서 상태를 확인할 수 있습니다.",
  release_session_refresh_required:"이 기기의 연결을 새로 확인한 뒤 시작해주세요. 배포 작업에 필요한 연결 시간을 확보하지 못했습니다.",
  provider_scope_changed:"진행 중 계정 연결이 변경됐습니다. 대상 계정과 자원을 다시 확인해주세요.",
  imported_request_review:"백업에서 복원한 배포 기록입니다. 외부 상태와 구성을 다시 검사해주세요.",
  public_worker_required:"기존 공개 Jarvis 저장소의 클라우드 배포 워크플로가 필요합니다. 유료 실행기로 자동 전환하지 않습니다.",
  deployment_repository_mismatch:"Vercel 프로젝트와 선택한 GitHub 저장소가 다릅니다. 프로젝트 ID를 확인해주세요.",
  self_release_unsupported:"Jarvis 자체는 기존 보호된 배포 경로에서 관리합니다.",
  deployment_alias_changed:"운영 주소가 다른 배포를 가리킵니다. 다시 검사해 현재 배포를 확인해주세요.",
};
const statusLabels={planned:"운영 구성 검토",queued:"클라우드 실행 대기",running:"클라우드에서 배포 중",deployed:"배포 확인 완료 · 기능 확인 대기",failed:"운영 전환 확인 필요",cancelled:"배포 작업 취소됨",interrupted:"배포 기록 재검토 필요"};
const phases={database:"DB 준비",database_wait:"새 DB·스키마 확인",environment:"운영 환경 연결",deployment:"고정 커밋 배포",deployment_wait:"빌드·배포 확인",health:"운영 주소 응답 확인",done:"서비스 기능 확인 대기"};
export function ProjectReleasePanel({project,live=false}:{project:Project;live?:boolean}) {
  const {data,account,saving,syncStatus,retryCloud,mutate}=useWorkspace();
  const [localRelease,setRelease]=useState<ProjectRelease|undefined>(project.release),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [database,setDatabase]=useState(project.release?.databaseId?"existing":"auto"),[databaseId,setDatabaseId]=useState(project.release?.databaseId??""),[vercelId,setVercelId]=useState(project.release?.vercelId??"");
  const repos=[...new Set(data.services.filter(s=>s.space===project.space&&s.projectId===project.id).map(repositoryFor).filter(Boolean))];
  const [repository,setRepository]=useState(repos[0]??""),[reviewKey,setReviewKey]=useState(""),[functionKey,setFunctionKey]=useState("");
  const lock=useRef(false);
  const release=localRelease&&(!project.release||localRelease.updatedAt>=project.release.updatedAt)?localRelease:project.release;
  const reviewed=!!release&&reviewKey===release.id;
  const functionalKey=release?`${release.id}:${release.executionId??""}:${release.deploymentId??""}`:"";
  const functional=!!functionalKey&&functionKey===functionalKey;
  const polling=releaseBusy(release);
  const releaseLabel=release?.status==="deployed"&&release.confirmedAt?"운영 중 · 기능 직접 확인 완료":release?statusLabels[release.status]:"";
  useEffect(()=>{
    if(!account?.authenticated||!polling)return;let disposed=false;
    const poll=async()=>{try{const response=await fetch('/api/projects/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space:project.space,projectId:project.id,action:'status'})});const result=await response.json();if(!disposed&&response.ok)setRelease(result.release??undefined);}catch{}};
    void poll();const timer=setInterval(()=>void poll(),8000);return()=>{disposed=true;clearInterval(timer);};
  },[account?.authenticated,project.space,project.id,polling]);
  async function act(action:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try{
      await retryCloud();
      const response=await fetch('/api/projects/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space:project.space,projectId:project.id,action,jobId:release?.id,executionId:release?.executionId,deploymentId:release?.deploymentId,repository,database,...(databaseId?{databaseId}:{}),...(vercelId?{vercelId}:{}),reviewed,functionalChecked:functional})});
      const result=await response.json();if(!response.ok)throw Error(result.error??'release_request_failed');
      setRelease(result.release??undefined);if(action==='plan'){setReviewKey("");setFunctionKey("");}
      await retryCloud();
    }catch(e){const code=e instanceof Error?e.message:'';setError(errors[code]??`운영 전환을 처리하지 못했습니다. ${/^[a-z_]{1,100}$/.test(code)?code:'연결 상태를 확인해주세요.'}`);}
    finally{lock.current=false;setBusy(false);}
  }
  const disabled=busy||saving||!account?.authenticated||syncStatus==='conflict',running=releaseBusy(release);
  return <details className={`${styles.detailSection} ${css.panel}`} aria-label="프로젝트 운영 전환" open={!!release}>
    <summary>개발 완료·운영 전환 {release&&<span> · {releaseLabel}</span>}</summary>
    <p>GitHub의 코드를 클라우드에서 배포합니다. 맥미니가 꺼져 있어도 배포가 이어집니다.</p>
    {!account?.authenticated&&<p role="status">이 기기의 서버 연결이 필요합니다. 로컬 개발 기록은 그대로 유지합니다.</p>}
    <ProjectProviders space={project.space}/>
    {!running&&<form onSubmit={e=>{e.preventDefault();void act('plan');}} className={css.form}>
      <label>운영할 GitHub 저장소<select aria-label="운영할 GitHub 저장소" value={repository} onChange={e=>setRepository(e.target.value)} required><option value="">저장소 선택</option>{repos.map(repo=><option key={repo} value={repo!}>{repo}</option>)}</select></label>
      <label>운영 데이터베이스<select aria-label="운영 데이터베이스" value={database} onChange={e=>setDatabase(e.target.value)}><option value="auto">코드와 기존 연결에 맞춰 자동 선택</option><option value="none">새 DB 연결 없음 · 기존 설정 유지</option><option value="new">새 Supabase · 저장소 스키마 적용</option><option value="existing">기존 Supabase · 데이터 보존</option></select></label>
      {database==='existing'&&<label>Supabase 프로젝트 ID<input required pattern="[a-z]{20}" maxLength={20} value={databaseId} onChange={e=>setDatabaseId(e.target.value)}/></label>}
      <label>Vercel 프로젝트 ID · 기존 연결이 있을 때<input placeholder="비우면 프로젝트 전용 환경 준비" maxLength={120} value={vercelId} onChange={e=>setVercelId(e.target.value)}/></label>
      <button className={styles.secondaryButton} disabled={disabled||!repository}>운영 구성 검사</button>
    </form>}
    {release&&<div className={css.result}>
      <strong role="status">{releaseLabel}</strong><p>{release.phase==="done"&&release.confirmedAt?"운영 확인 완료":phases[release.phase]} · {dateLabel(release.updatedAt)}</p>
      <p>{release.plan.repository} · 코드 {release.plan.sha.slice(0,8)} · {release.plan.framework}</p>
      <p>DB: {release.databaseId??release.plan.databaseId??(release.plan.database==='none'?'별도 DB 없음':'새 프로젝트 준비')} · {release.databaseStatus??'확인 대기'}</p>
      {release.vercelId&&<p><a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">Vercel 배포·로그 관리 ↗</a></p>}
      {release.databaseId&&<p><a href={`https://supabase.com/dashboard/project/${release.databaseId}`} target="_blank" rel="noopener noreferrer">Supabase 환경 관리 ↗</a></p>}
      {release.deploymentStatus&&<p>Vercel: {release.deploymentStatus} · {release.deploymentId}</p>}
      {release.environmentKeys?.length ? <p>연결한 환경: {release.environmentKeys.join(', ')}</p>:null}
      {release.plan.migrations.length>0&&<details><summary>새 DB에 적용할 스키마 {release.plan.migrations.length}개</summary><ul>{release.plan.migrations.map(m=><li key={m.path}>{m.path} · {m.sha.slice(0,8)}</li>)}</ul></details>}
      {release.plan.notes.map(note=><p key={note}>{note}</p>)}
      {release.healthStatus&&<p>자동 응답: HTTP {release.healthStatus}{release.confirmedAt?` · 기능 직접 확인 ${dateLabel(release.confirmedAt)}`:""}</p>}
      {release.error&&!(release.error==="deployment_access_review"&&release.confirmedAt)&&<p role="alert">{errors[release.error]??`진행을 멈췄습니다. ${release.error}`}</p>}
      {release.url&&<p><a className={styles.primaryButton} href={release.url} target="_blank" rel="noopener noreferrer">운영 화면 확인 ↗</a></p>}
      {release.workflowUrl&&<p><a href={release.workflowUrl} target="_blank" rel="noopener noreferrer">클라우드 배포 진행 기록 ↗</a></p>}
      {['planned','failed','cancelled','interrupted'].includes(release.status)&&<><label className={css.check}><input type="checkbox" checked={reviewed} onChange={e=>setReviewKey(e.target.checked?release.id:"")}/>고정 코드·무료 계정·DB 적용 범위를 확인했습니다. 기존 로컬 자료는 보존하고 별도 운영환경을 시작합니다.</label><button className={styles.primaryButton} disabled={disabled||!reviewed} onClick={()=>void act(release.status==='planned'?'start':'retry')}>{release.status==='planned'?'클라우드에서 배포 시작':'기존 자원으로 이어서 확인'}</button></>}
      {running&&<><p>브라우저를 닫아도 GitHub에서 계속 처리합니다. 취소 시 이미 만든 외부 자원은 유지됩니다.</p><button disabled={disabled} className={styles.secondaryButton} onClick={()=>void act('cancel')}>배포 작업 취소</button></>}
      {release.status==='deployed'&&(!live||!release.confirmedAt)&&<><label className={css.check}><input type="checkbox" checked={functional} onChange={e=>setFunctionKey(e.target.checked?functionalKey:"")}/>운영 화면에서 주요 기능과 필요한 데이터 저장을 직접 확인했습니다.</label><button className={styles.primaryButton} disabled={disabled||!functional} onClick={()=>void act('complete')}>개발 완료 · 사용 중으로 전환</button></>}
      {release.history.length>0&&<details><summary>이전 운영 전환 {release.history.length}건</summary>{release.history.slice().reverse().map(h=><p key={h.id}>{h.sha.slice(0,8)} · {h.status} · {dateLabel(h.at)} {h.url&&<a href={h.url} target="_blank" rel="noopener noreferrer">기록된 운영 주소 ↗</a>}</p>)}</details>}
    </div>}
    {live&&<button disabled={busy||saving||running} className={styles.secondaryButton} onClick={()=>void mutate(d=>({...d,projects:d.projects.map(p=>p.id===project.id&&p.space===project.space?{...p,stage:"development"}:p)})).catch(e=>setError(e.message))}>수정 개발로 돌아가기</button>}
    {error&&<div><p role="alert" className={styles.errorBanner}>{error}</p>{!live&&<button className={styles.secondaryButton} onClick={()=>{window.dispatchEvent(new CustomEvent("jarvis-release-help",{detail:{projectId:project.id,space:project.space,request:`운영 전환 검사에서 다음 항목을 확인했습니다: ${error}\n기존 로컬 자료와 운영 자료를 보존하고, Vercel 서버리스와 Supabase의 RLS/저장 구조에 맞게 필요한 코드와 테스트를 준비해주세요. 별도 API 과금이나 인증 우회는 하지 마세요.`}}));window.dispatchEvent(new Event("jarvis-project-chat"));}}>필요한 수정을 개발 대화에 작성</button>}</div>}
  </details>;
}
