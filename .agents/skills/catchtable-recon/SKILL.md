---
name: catchtable-recon
description: Inspect and E2E-test Catchtable (app.catchtable.co.kr) and the Catchtable Reserve Assistant extension. Use for live DOM reconnaissance, reservation-flow observation, dialog transition measurement, extension update/reload, Side Panel operation, scheduler persistence checks, run-log analysis, Console/Network debugging, or Chrome storage and IndexedDB telemetry verification.
---

# Catchtable Recon

Use Chrome DevTools MCP for live Chrome and extension work. Read `docs/testing/chrome-devtools-mcp-ai-guide.md` before substantial E2E work.

## Sources of truth

1. Read `docs/analysis/site-behavior.md` before inspecting the live site.
2. Keep observed DOM, transition, and URL facts only in that document.
3. Record new facts with the restaurant and observation date.
4. Keep procedures in this skill; do not duplicate volatile site facts here.

## Live-site reconnaissance

1. Select the intended `https://app.catchtable.co.kr/ct/shop/<slug>` page by URL.
2. Assume restaurant-specific variants in entry controls and intermediate table, menu, add-on, and deposit dialogs.
3. Use a fresh accessibility snapshot for structure and stable UIDs.
4. For transition timing, inject the same decision logic used by the extension and poll the relevant state at the required interval.
5. To distinguish SPA navigation from full reload, inject a persistent marker, hook `history.pushState`/`replaceState`, and observe DOM mutations before acting.
6. Observe network requests through DevTools; correlate them with DOM and extension logs.
7. Base selectors on ARIA and `data-*` attributes, not generated CSS classes.
8. Cross-check restaurant variants before generalizing an observation.

## Extension E2E

1. Run `npm run check` after code changes.
2. Open `chrome://extensions/?id=<extension-id>`.
3. Use extension `새로고침` to reload this unpacked extension or top-level `업데이트` for a Chrome-wide update check.
4. Discard old targets and UIDs after reload.
5. If the Side Panel target is absent, navigate the management-page target to `chrome-extension://<id>/sidepanel/sidepanel.html`; `new_page` may fail silently.
6. Verify the extension origin with `location.href` and `location.origin`.
7. Operate jobs, favorites, scheduler actions, and run controls from fresh snapshots.
8. Compare Side Panel state, Catchtable DOM, Console/Network, persisted scheduler state, and telemetry.

## Persistence model

Do not confuse the two storage systems:

- Reservation settings, jobs, favorites, history, drafts, and active-run state are in `chrome.storage.local`. Important keys include `scheduledJobs`, `reservationConfig`, `configHistory`, `configFavorites`, `activeRun`, and `draftForm`.
- Execution telemetry is in IndexedDB database `catchtable-reserve-telemetry`, stores `runs`, `events`, and failure-only `snapshots`.

Verify reservation-job persistence through `chrome.storage.local.scheduledJobs`, not IndexedDB. Verify a selected telemetry `runId` by comparing `runs.eventCount`, stored event count, continuous `seq`, `droppedCount`, `finalState`, and terminal event with the UI log.

## Tool-specific behavior

- Chrome DevTools MCP is the default. Its `evaluate_script` and page listing can return complete URLs, and snapshot UID clicks avoid coordinate drift.
- Use only UIDs from the latest snapshot.
- Prefer bulk form filling for multiple fields.
- Validate actions through resulting state, not the tool's click-success response.
- If an old `claude-in-chrome` workflow is deliberately used, its query-string and cross-extension restrictions do not describe Chrome DevTools MCP behavior.

## Project references

- Live-site facts: `docs/analysis/site-behavior.md`
- DevTools E2E guide: `docs/testing/chrome-devtools-mcp-ai-guide.md`
- Injection policy: `docs/architecture/decisions/ADR-004-on-demand-content.md`
- DOM fixtures: `tests/fixtures/`
- Pipeline states: `docs/architecture/state-machine.md`
