import type { IconName } from "./icon";

export const navigation: {
  href: string;
  label: string;
  icon: IconName;
  description: string;
  color: string;
}[] = [
  {
    href: "/",
    label: "업무실",
    icon: "grid",
    description: "오늘 할 일과 서비스 결과, 다음 행동을 한곳에서",
    color: "green",
  },
  {
    href: "/tasks",
    label: "업무",
    icon: "check",
    description: "할 일과 수정 요청, 검증·승인 상태를 관리하는 곳",
    color: "green",
  },
  {
    href: "/projects",
    label: "프로젝트",
    icon: "folder",
    description: "목표·서비스·업무 결과를 프로젝트별로 관리하는 곳",
    color: "purple",
  },
  {
    href: "/memos",
    label: "메모",
    icon: "note",
    description: "저장한 기록을 검색하고 읽어보는 곳",
    color: "orange",
  },
  {
    href: "/library",
    label: "자료실",
    icon: "folder",
    description: "파일을 프로젝트와 업무에 연결하는 곳",
    color: "blue",
  },
  {
    href: "/notes",
    label: "맥락",
    icon: "note",
    description: "메모와 생각, 계속 기억할 기준과 결정을 관리하는 곳",
    color: "orange",
  },
  {
    href: "/settings",
    label: "설정",
    icon: "settings",
    description: "나에게 맞는 작업 공간을 만드는 곳",
    color: "neutral",
  },
];
