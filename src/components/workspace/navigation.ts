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
    description: "AI 대화와 오늘의 업무, 맥락을 한곳에서",
    color: "green",
  },
  {
    href: "/tasks",
    label: "업무",
    icon: "check",
    description: "오늘 할 일과 다음 할 일을 정리하는 곳",
    color: "green",
  },
  {
    href: "/projects",
    label: "프로젝트",
    icon: "folder",
    description: "작은 시작부터 큰 목표까지 모아두는 곳",
    color: "purple",
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
    description: "계속 기억할 배경과 결정, 아이디어를 관리하는 곳",
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
