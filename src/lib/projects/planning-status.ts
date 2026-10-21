import type { PlanningTurn } from "./planning";

export function planningFailure(turn: Pick<PlanningTurn, "status" | "error">) {
  const code = turn.error && /^[a-z_]{1,100}$/.test(turn.error)
    ? turn.error : turn.status === "interrupted" ? "runner_interrupted" : "planning_failed";
  const messages: Record<string, [string, string]> = {
    cli_limit: ["구독 사용 한도에 도달했습니다.", "구독 한도가 회복된 뒤 재시도해주세요."],
    cli_login_required: ["맥미니의 구독 CLI 로그인을 확인해주세요.", "실행기 응답과 별개로, 기획에는 맥미니의 ChatGPT 구독 로그인이 필요합니다."],
    cli_timeout: ["기획 AI 응답 대기 시간이 초과됐습니다.", "같은 요청을 재시도할 수 있습니다. 반복되면 요청을 작은 단계로 나눠주세요."],
    cli_unavailable: ["맥미니에서 구독 CLI를 실행하지 못했습니다.", "CLI 실행 조건이나 네트워크 문제일 수 있습니다. 아래 오류 코드를 함께 확인해주세요."],
    invalid_completion: ["AI 응답을 기획안 형식으로 읽지 못했습니다.", "완성된 기획안으로 저장하지 않았습니다. 같은 요청을 재시도할 수 있습니다."],
    invalid_planning_answer: ["AI가 반환한 기획안의 내용·형식을 확인하지 못했습니다.", "완성된 기획안으로 저장하지 않았습니다. 같은 요청을 재시도할 수 있습니다."],
    runner_interrupted: ["기획 작업이 중단되었거나 실행 시간이 만료됐습니다.", "맥미니 실행기가 응답하는지 확인한 뒤 재시도해주세요."],
    preview_cli_cancelled: ["기획 요청 처리가 중단됐습니다.", "실행기 응답 상태를 확인한 뒤 재시도해주세요."],
  };
  const [message, action] = (Object.hasOwn(messages, code) ? messages[code] : undefined) ?? [
    "기획 요청을 완료하지 못했습니다.",
    code === "planning_failed" ? "기록된 상세 원인이 없습니다. 재시도 후 같은 문제가 나면 표시된 오류 코드를 알려주세요."
      : "아래 오류 코드로 원인을 구분할 수 있습니다. 같은 문제가 반복되면 이 코드를 알려주세요.",
  ];
  return { code, message, action };
}
