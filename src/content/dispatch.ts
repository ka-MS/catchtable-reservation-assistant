/**
 * 런 이벤트를 Service Worker로 보내되, 전송 실패가 시간 임계 실행을 절대 깨뜨리지
 * 않게 한다. 확장 컨텍스트가 무효화되면(리로드·bfcache) `chrome.runtime.sendMessage`는
 * 프라미스 거부가 아니라 **동기 throw**를 낸다 — `.catch()`만으로는 못 잡으므로
 * try/catch로 감싸고 반환 프라미스의 거부도 함께 삼킨다.
 */
export function dispatchRunEvent(send: (message: unknown) => Promise<unknown>, message: unknown): void {
  try {
    void send(message).catch(() => undefined);
  } catch {
    // 무효 컨텍스트에서의 동기 throw. 로그 전송은 포기하고 실행은 계속한다.
  }
}
