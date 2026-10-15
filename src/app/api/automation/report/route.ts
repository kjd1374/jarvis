import { applySync } from "@/lib/integrations/sync";
import { acceptFacts, analysisInput, parseAnalysis, preservePrimaryConnection } from "@/lib/automation/facts";
import { actOnSuggestion, applyAnalysis, requireLease } from "@/lib/automation/state";
import { changeWorkspace } from "@/lib/automation/server";
import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    if (typeof body.serviceId !== "string" || !["facts", "analysis", "error"].includes(String(body.phase)))
      throw new CloudError(400, "invalid_report", "실행 결과의 종류를 확인해주세요.");
    const stamp = new Date().toISOString();
    const result = await changeWorkspace(request, space, (current, deviceId) => {
      const service = current.services.find(s => s.id === body.serviceId && s.space === space);
      if (!service) throw new CloudError(404, "service_missing", "이 영역의 연결을 찾을 수 없습니다.");
      try { requireLease(service, body.jobId, deviceId, stamp); }
      catch { throw new CloudError(409, "stale_job", "실행 요청이 만료되었거나 연결이 바뀌었습니다. 새 요청을 확인해주세요."); }
      if (body.phase === "facts") {
        let data;
        try { data = acceptFacts(current, service, body.result, stamp); }
        catch { throw new CloudError(400, "invalid_facts", "검증할 수 없는 점검 결과입니다. 마지막 정상 자료를 유지합니다."); }
        const updated = data.services.find(s => s.id === service.id)!;
        const same = updated.monitoring!.analysis?.basis === updated.monitoring!.inspection!.fingerprint &&
          updated.monitoring!.analysis?.headSha === updated.monitoring!.inspection!.headSha;
        if (same) data = { ...data, services: data.services.map(s => s.id === service.id ? { ...s, monitoring: { ...s.monitoring!,
          job: { ...s.monitoring!.job!, status: "completed" as const, leaseUntil: undefined, leaseOwner: undefined } } } : s) };
        return { data, result: { accepted: true, analysisRequired: !same,
          basis: updated.monitoring!.inspection!.fingerprint, input: same ? null : analysisInput(data, updated) } };
      }
      if (body.phase === "analysis") {
        if (body.basis !== service.monitoring!.inspection?.fingerprint)
          throw new CloudError(409, "stale_analysis", "분석의 기준 자료가 바뀌었습니다. 새 자료로 다시 점검해주세요.");
        let updated;
        try { updated = applyAnalysis(service, parseAnalysis(current, service, body.result, stamp)); }
        catch { throw new CloudError(400, "invalid_analysis", "근거와 범위를 확인할 수 없는 분석입니다. 이전 분석은 유지합니다."); }
        let data = { ...current, services: current.services.map(s => s.id === service.id ? updated : s) };
        for (const suggestion of updated.monitoring!.analysis!.suggestions) {
          if (suggestion.state === "proposed" && suggestion.kind !== "completion")
            data = actOnSuggestion(data, space, service.id, suggestion.id, "adopt", false, stamp);
        }
        return { data, result: { accepted: true } };
      }
      const codes = ["github_auth_required", "github_rate_limited", "github_unavailable", "cli_login_required", "cli_limit", "cli_unavailable", "invalid_analysis"];
      const code = typeof body.code === "string" && codes.includes(body.code) ? body.code : "cli_unavailable";
      const collecting = service.monitoring!.job!.phase === "collect";
      let data = collecting ? applySync(current, service.id, space, { ok: false, code: "unavailable" }, stamp) : current;
      if (collecting) data = { ...data, syncEvents: data.syncEvents.map(e => e.serviceId === service.id && e.attemptedAt === stamp && e.code === "unavailable" ? { ...e, code } : e) };
      data = { ...data, services: data.services.map(s => s.id === service.id ? { ...s,
        ...preservePrimaryConnection(service),
        monitoring: { ...s.monitoring!, nextRetryAt: new Date(Date.parse(stamp) + 15 * 60_000).toISOString(), error: collecting ? code : s.monitoring!.error, job: { ...s.monitoring!.job!, status: "failed" as const, error: code, leaseOwner: undefined, leaseUntil: undefined } },
      } : s) };
      return { data, result: { accepted: true } };
    });
    return reply(result);
  } catch (error) { return failure(error); }
}
