import "server-only";
import type { Service } from "../workspace/types";
import type { ReadConnector } from "./sync";

// Web v4's code has been reviewed; a dedicated read-only API/role is proposed,
// not implemented. Never guess a URL or fetch user-configured addresses here.
export function connectorFor(_service: Service): ReadConnector | null {
  void _service;
  return null;
}
export const connectorAvailability = {
  shortcut: {
    readable: false,
    executable: false,
    reason: "주소만 등록된 바로가기입니다.",
  },
  v4: {
    readable: false,
    executable: false,
    reason: "v4 코드 검토 완료 · 전용 읽기 권한과 최소 조회 API 연결이 필요합니다.",
  },
} as const;
