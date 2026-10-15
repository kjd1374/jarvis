import type { Service, Space } from "../workspace/types";

// Registration defaults only. These entries never enable a connector or fetch data.
export const servicePresets = {
  custom: {
    label: "직접 입력",
    name: "",
    webUrl: "",
    repositoryUrl: "",
    connector: "shortcut",
    hint: "웹 주소를 등록하고 프로젝트에 연결합니다.",
  },
  v4: {
    label: "v4 웹 · 회사 전용",
    name: "v4 웹",
    webUrl: "https://33m2-v4-workspace.vercel.app",
    repositoryUrl: "https://github.com/kjd1374/33m2-v4-workspace",
    connector: "v4",
    hint: "웹 v4부터 연결합니다. 전용 읽기 권한과 조회 API는 별도 준비가 필요합니다. 로컬 PC 연결은 추후 진행합니다.",
  },
  github: {
    label: "GitHub · 개발 기록",
    name: "GitHub 개발 기록",
    webUrl: "",
    repositoryUrl: "",
    connector: "shortcut",
    hint: "해당 영역의 저장소 주소를 입력하세요. 지금은 바로가기로 저장하며, 이슈·PR·검증·배포 자동 조회와 AI 판정은 연결이 필요합니다.",
  },
  sheets: {
    label: "구글 시트 · 업무 원본",
    name: "구글 시트",
    webUrl: "",
    repositoryUrl: "",
    connector: "shortcut",
    hint: "실제로 사용하는 시트 주소를 입력하세요. 지금은 원본을 열 수 있으며, 자료 읽기와 특정 행·열로 입력 전송은 별도 연결이 필요합니다.",
  },
} satisfies Record<
  string,
  {
    label: string;
    name: string;
    webUrl: string;
    repositoryUrl: string;
    connector: Service["connector"];
    hint: string;
  }
>;

export type ServicePreset = keyof typeof servicePresets;

export function presetAllowed(preset: ServicePreset, space: Space) {
  return preset !== "v4" || space === "company";
}

export function matchesPreset(
  service: Service,
  preset: Exclude<ServicePreset, "custom">,
) {
  if (preset === "v4")
    return (
      service.space === "company" &&
      (service.connector === "v4" ||
        service.webUrl === new URL(servicePresets.v4.webUrl).href)
    );
  try {
    const url = new URL(service.webUrl);
    return preset === "github"
      ? url.hostname === "github.com"
      : url.hostname === "docs.google.com" &&
          url.pathname.startsWith("/spreadsheets/");
  } catch {
    return false;
  }
}
