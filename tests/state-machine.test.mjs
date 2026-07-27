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
    "SLOT_CLICK_DISPATCHED",
    "SLOT_TRANSITION_CONFIRMED",
    "ADVANCING_RESERVATION",
    "HANDED_OFF",
  ]) {
    machine.transition(state, `to ${state}`);
  }
  assert.equal(machine.state, "HANDED_OFF");
  assert.equal(machine.history.length, 11);
});

test("dry-run cannot enter slot dispatch or legacy selected states", () => {
  const machine = new RunStateMachine({ dryRun: true, now: () => 10 });
  machine.transition("CONFIGURED", "configured");
  machine.transition("VALIDATING", "validating");
  machine.transition("SYNCING_CLOCK", "clock");
  machine.transition("PREPARING_PAGE", "page");
  machine.transition("WAITING_FOR_OPEN", "wait");
  machine.transition("REFRESHING_SLOTS", "refresh");
  machine.transition("SLOT_DETECTED", "detected");
  assert.throws(() => machine.transition("SLOT_CLICK_DISPATCHED", "unsafe"), /dry-run/);
  assert.throws(() => machine.transition("SLOT_SELECTED", "legacy unsafe"), /dry-run|허용되지/);
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

test("auto entry states lead back into the existing page safety check", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  machine.transition("CONFIGURED", "config");
  machine.transition("VALIDATING", "validate");
  machine.transition("SYNCING_CLOCK", "clock");
  machine.transition("ENTERING_RESERVATION", "entry");
  machine.transition("SELECTING_DATE", "date");
  machine.transition("SELECTING_PERSON", "person");
  machine.transition("PREPARING_PAGE", "safety");
  assert.equal(machine.state, "PREPARING_PAGE");
});

test("background navigation is a valid pre-configuration state", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  machine.transition("NAVIGATING", "navigate");
  machine.transition("CONFIGURED", "loaded");
  assert.equal(machine.state, "CONFIGURED");
});

test("ADVANCING_RESERVATION → COMPLETING_RESERVATION is allowed for opt-in completion", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  machine.transition("CONFIGURED", "configured");
  machine.transition("VALIDATING", "validating");
  machine.transition("SYNCING_CLOCK", "clock");
  machine.transition("PREPARING_PAGE", "page");
  machine.transition("WAITING_FOR_OPEN", "wait");
  machine.transition("REFRESHING_SLOTS", "refresh");
  machine.transition("SLOT_DETECTED", "detected");
  machine.transition("SLOT_CLICK_DISPATCHED", "clicked");
  machine.transition("SLOT_TRANSITION_CONFIRMED", "confirmed");
  machine.transition("ADVANCING_RESERVATION", "advancing");
  machine.transition("COMPLETING_RESERVATION", "completing");
  assert.equal(machine.state, "COMPLETING_RESERVATION");
});

test("COMPLETING_RESERVATION safe terminal transitions match the design's exit matrix", () => {
  const outcomes = ["COMPLETED", "STOPPED", "TIMED_OUT", "HANDED_OFF", "FAILED"];
  for (const outcome of outcomes) {
    const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
    machine.transition("CONFIGURED", "configured");
    machine.transition("VALIDATING", "validating");
    machine.transition("SYNCING_CLOCK", "clock");
    machine.transition("PREPARING_PAGE", "page");
    machine.transition("WAITING_FOR_OPEN", "wait");
    machine.transition("REFRESHING_SLOTS", "refresh");
    machine.transition("SLOT_DETECTED", "detected");
    machine.transition("SLOT_CLICK_DISPATCHED", "clicked");
    machine.transition("SLOT_TRANSITION_CONFIRMED", "confirmed");
    machine.transition("ADVANCING_RESERVATION", "advancing");
    machine.transition("COMPLETING_RESERVATION", "completing");
    machine.transition(outcome, `to ${outcome}`);
    assert.equal(machine.state, outcome);
    assert.throws(() => machine.transition("STOPPED", "after terminal"), /종료 상태/);
  }
});

test("COMPLETING_RESERVATION rejects unlisted transitions", () => {
  const machine = new RunStateMachine({ dryRun: false, now: () => 1 });
  machine.transition("CONFIGURED", "configured");
  machine.transition("VALIDATING", "validating");
  machine.transition("SYNCING_CLOCK", "clock");
  machine.transition("PREPARING_PAGE", "page");
  machine.transition("WAITING_FOR_OPEN", "wait");
  machine.transition("REFRESHING_SLOTS", "refresh");
  machine.transition("SLOT_DETECTED", "detected");
  machine.transition("SLOT_CLICK_DISPATCHED", "clicked");
  machine.transition("SLOT_TRANSITION_CONFIRMED", "confirmed");
  machine.transition("ADVANCING_RESERVATION", "advancing");
  machine.transition("COMPLETING_RESERVATION", "completing");
  assert.throws(() => machine.transition("REFRESHING_SLOTS", "invalid"), /허용되지 않는 상태 전이/);
});
