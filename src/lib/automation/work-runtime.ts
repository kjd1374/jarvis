// The CLI policy lives in the installed runner, not the deployed web service.
export const MIN_PROJECT_WORK_RUNNER = "2.9.6";
export function workRunnerVersion(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : undefined;
}
export function projectWorkRunnerReady(value: unknown) {
  const version = workRunnerVersion(value);
  if (!version) return false;
  const parts = version.split(".").map(Number), minimum = MIN_PROJECT_WORK_RUNNER.split(".").map(Number);
  for (let index = 0; index < 3; index++) if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  return true;
}
