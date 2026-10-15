// Saved references open in the user's browser; they never trigger server fetches.
export function projectUrl(value: string, repository = false): string {
  const input = value.trim();
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(
      "주소를 http:// 또는 https://로 시작하는 전체 주소로 입력해주세요.",
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "로그인 정보가 포함되지 않은 http/https 주소를 입력해주세요.",
    );
  if (
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key/i.test(key),
    )
  )
    throw new Error("토큰이 포함된 주소는 저장할 수 없습니다.");
  if (
    repository &&
    (url.hostname !== "github.com" ||
      url.pathname.split("/").filter(Boolean).length < 2)
  )
    throw new Error(
      "GitHub 저장소 주소를 입력해주세요. 예: https://github.com/소유자/저장소",
    );
  return url.toString();
}

export function projectHref(value: string | undefined): string | null {
  try {
    return value ? projectUrl(value) : null;
  } catch {
    return null;
  }
}
