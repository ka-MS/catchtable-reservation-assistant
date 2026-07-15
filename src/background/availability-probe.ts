export async function ensureAvailabilityProbe(
  tabId: number,
  enabled: boolean,
  scripting: Pick<typeof chrome.scripting, "executeScript">,
): Promise<boolean> {
  if (!enabled) return false;
  try {
    await scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["main-world/availability-probe.js"],
    });
    return true;
  } catch {
    // 진단 probe 주입 실패로 기존 DOM 실행을 막지 않는다.
    return false;
  }
}
