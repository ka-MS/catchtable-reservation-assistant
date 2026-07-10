import assert from "node:assert/strict";
import test from "node:test";
import { RunStateMachine } from "../dist/shared/state-machine.js";

test("open-run state follows the documented happy path", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 123 });
  for (const state of [
    "CONFIGURED",
    "VALIDATING",
    "SYNCING_CLOCK",
    "PREPARING_PAGE",
    "WAITING_FOR_OPEN",
    "REFRESHING_SLOTS",
    "SLOT_DETECTED",
    "SLOT_SELECTED",
    "ADVANCING_RESERVATION",
    "HANDED_OFF",
  ]) {
    machine.transition(state, `to ${state}`);
  }
  assert.equal(machine.state, "HANDED_OFF");
  assert.equal(machine.history.length, 10);
});

test("dry-run cannot enter SLOT_SELECTED", () => {
  const machine = new RunStateMachine({ dryRun: true, now: () => 10 });
  machine.transition("CONFIGURED", "configured");
  machine.transition("VALIDATING", "validating");
  machine.transition("SYNCING_CLOCK", "clock");
  machine.transition("PREPARING_PAGE", "page");
  machine.transition("WAITING_FOR_OPEN", "wait");
  machine.transition("REFRESHING_SLOTS", "refresh");
  machine.transition("SLOT_DETECTED", "detected");
  assert.throws(() => machine.transition("SLOT_SELECTED", "unsafe"), /dry-run/);
  machine.transition("DRY_RUN_COMPLETED", "detected only");
  assert.equal(machine.state, "DRY_RUN_COMPLETED");
});

test("terminal states reject further transitions", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  machine.transition("CONFIGURED", "configured");
  machine.transition("STOPPED", "user stop", { userStopped: true });
  assert.throws(() => machine.transition("VALIDATING", "invalid"), /종료 상태/);
});

test("invalid state jumps are rejected", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  assert.throws(() => machine.transition("SLOT_SELECTED", "skip"), /허용되지 않는 상태 전이/);
});
