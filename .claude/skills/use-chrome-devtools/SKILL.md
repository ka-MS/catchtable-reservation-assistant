---
name: use-chrome-devtools
description: Use Chrome DevTools MCP to control and E2E-test the live Catchtable site and Catchtable Reserve Assistant extension. Use for extension build reload/update, Side Panel operation, scheduled reservation-job setup, favorites, run/stop workflows, Console and Network inspection, service-worker logs, extension IndexedDB telemetry, or UI-log-to-run/event verification. Prefer this over claude-in-chrome for Chrome extension and DevTools work.
---

# Use Chrome DevTools

Use the `chrome-devtools` MCP tools, not `claude-in-chrome`.

Before substantial work, read `docs/testing/chrome-devtools-mcp-ai-guide.md`. It is the detailed source for setup, selectors, IndexedDB snippets, E2E scenarios, known MCP limitations, and result reporting.

## Known environment

- MCP config: project `.mcp.json`
- Windows command: `cmd /c npx -y chrome-devtools-mcp@latest --auto-connect`
- Required environment: `SystemRoot=C:\Windows`, `PROGRAMFILES=C:\Program Files`
- Chrome connection: enable remote debugging at `chrome://inspect/#remote-debugging`
- Extension: `Catchtable Reserve Assistant`
- Observed ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- Management: `chrome://extensions/?id=<id>`
- Side Panel: `chrome-extension://<id>/sidepanel/sidepanel.html`
- Telemetry DB: `catchtable-reserve-telemetry`, stores `runs` and `events`

Verify ID, version, and load path instead of assuming the observed values remain current.

## Core workflow

1. Run `npm run check` after code changes.
2. List Chrome pages and select the intended target by URL.
3. Open the extension management page.
4. Use top-level `업데이트` for Chrome-wide extension update checks or extension `새로고침` to reload this unpacked extension from `dist`.
5. Discard old targets and UIDs after reload.
6. Navigate the management-page target to the Side Panel extension URL.
7. Verify `location.href` and `location.origin`; the page list may retain its old title.
8. Take a fresh snapshot and operate the Side Panel.
9. Verify behavior in the Catchtable tab, Side Panel logs, Console/Network, and IndexedDB.

## Tool discipline

- Take a new snapshot after navigation, form changes, reload, or rerender.
- Use only UIDs from the latest snapshot.
- Prefer bulk form fill for multiple fields.
- Validate a click through resulting state, not the click success response.
- Prefer `navigate_page` over `new_page` for `chrome-extension://` URLs.
- If a target disappears after extension reload, restart from page listing.
- Avoid broad `wait_for` text such as `오류`; it may match static controls like `오류 수집`.

## Catchtable reservation jobs

For a new or edited job, verify URL, open datetime, stop datetime, reservation date, party size, time range, options, and execution summary before saving. After save, verify the job card.

Scheduler semantics:

- Future open time: save as `예정`.
- Open time passed but stop time remains: saving may immediately execute.
- Stop time passed: validation rejects the save.
- `지금 시작`: execute immediately.
- `실행 중지`: terminate and verify `STOPPED` in UI and telemetry.

Favorites and jobs are separate persistence operations. To save a favorite, expand `최근 설정`, select `즐겨찾기`, click `현재 설정 저장`, verify the item, then separately click `예약 저장` when a job is also required.

## Logs and IndexedDB

Select the intended run by restaurant, reservation date, and start time. Compare the Side Panel log with IndexedDB in the extension origin.

For the chosen `runId`, verify:

- `runs.eventCount` equals stored event count
- event `seq` is continuous
- `droppedCount`
- `finalState`
- first `RUN_STARTED` and terminal event
- code/severity/component counts
- timestamps and UI-log order

The service worker and Side Panel share the same extension origin. If the worker target is absent from the page list, query its IndexedDB through the Side Panel document.

## E2E completion

Report the extension ID/version/reload method, inputs, resulting job state, browser behavior, UI-log transitions, Console/Network findings, and IndexedDB run evidence. Repeat the original observable check after a code fix.
