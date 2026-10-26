"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { projectStage } from "@/lib/projects/lifecycle";
import { projectHref } from "@/lib/workspace/project-links";
import type { Project } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import home from "./integrated-home.module.css";
const groups = [
  { stage: "idea", title: "아이디어", action: "기획 이어가기", empty: "아이디어를 등록해 기획안부터 정리하세요." },
  { stage: "development", title: "개발 중", action: "작업실 열기", empty: "개발할 프로젝트를 등록하면 이곳에서 이어갑니다." },
  { stage: "live", title: "사용 중", action: "서비스 열기", empty: "완성된 서비스는 여기서 바로 이용합니다." },
] as const;
export function HomeProjects({ projects, embedded = false }: { projects: Project[]; embedded?: boolean }) {
  const { ready, saving, mutate } = useWorkspace(), router = useRouter();
  const pending = useRef(false), [error, setError] = useState("");
  async function open(event: React.MouseEvent, project: Project) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!ready || saving || pending.current) return;
    pending.current = true; setError("");
    try {
      await mutate(data => ({ ...data, activeProjects: { ...data.activeProjects, [project.space]: project.id } }));
      router.push(`/projects/${project.id}`);
    } catch { setError("프로젝트 선택을 저장하지 못했습니다. 다시 열어주세요."); }
    finally { pending.current = false; }
  }
  return <section className={`${styles.detailSection} ${embedded ? home.projectPane : ""}`} aria-label="프로젝트 이어가기" id="home-projects">
    <div className={styles.detailHeading}><h2><Icon name="folder" size={17} /> 프로젝트 이어가기</h2><Link href="/projects">프로젝트 관리 →</Link></div>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <div className={home.projectGroups}>
      {groups.filter(group => !embedded || projects.some(project => projectStage(project) === group.stage)).map(group => {
        const items = projects.filter(p => projectStage(p) === group.stage).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return <section key={group.stage} aria-label={group.title} className={home.projectGroup}>
          <h3>{group.title}<span>{items.length}</span></h3>
          {items.length ? items.slice(0, 2).map(project => {
            const live = group.stage === "live", launch = live ? projectHref(project.launchUrl) : null;
            const Entry = launch ? "a" : Link;
            return <article key={project.id} className={home.projectCard}>
              <Entry href={launch ?? `/projects/${project.id}`} target={launch ? "_blank" : undefined} rel={launch ? "noopener noreferrer" : undefined}
                aria-label={`${project.name} ${launch ? "서비스 열기" : group.action}`} onClick={launch ? undefined : event => void open(event, project)}>
                <strong>{project.name}</strong><p>{project.nextAction || project.description || "프로젝트에서 다음 작업을 확인하세요."}</p>
                <span>{live && !launch ? "서비스 주소 확인" : group.action}<Icon name="arrow" size={14} /></span>
              </Entry>
              {live && <Link className={home.manage} href={`/projects/${project.id}`} onClick={event => void open(event, project)}>{project.name} 관리</Link>}
            </article>;
          }) : <p className={home.empty}>{group.empty}</p>}
          {items.length > 2 && <Link href="/projects" className={home.more}>프로젝트 {items.length - 2}개 더 보기 →</Link>}
        </section>;
      })}
    </div>
    {!projects.length && embedded && <p className={home.empty}>연결된 프로젝트가 없습니다. 전체 업무에서 기존 프로젝트를 확인하거나 서비스 관리에서 프로젝트를 연결하세요.</p>}
  </section>;
}
