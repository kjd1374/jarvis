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
    label: "대시보드",
    icon: "grid",
    description: "내 작업 공간을 한눈에",
    color: "green",
  },
  {
    href: "/tasks",
    label: "작업",
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
    href: "/notes",
    label: "노트",
    icon: "note",
    description: "잊고 싶지 않은 생각을 담아두는 곳",
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
