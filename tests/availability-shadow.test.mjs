import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAvailabilityResponse,
  isAvailabilityShadowEvent,
  normalizeReservationDate,
} from "../dist/shared/availability-shadow.js";
import { ShadowClaimCoordinator } from "../dist/content/availability-shadow-observer.js";

const request = { requestDate: "260801", personCount: 2 };

test("availability classifier normalizes a populated timeSlotMap without retaining raw payload", () => {
  const result = classifyAvailabilityResponse(JSON.stringify({
    data: {
      inputDate: "2026-08-01",
      personCount: 2,
      timeSlotMap: {
        "1900": { availableYn: true, time: "1900", tableType: "H", secret: "discard-me" },
        "1830": { availableYn: true, time: "1830" },
        "1800": { availableYn: false, time: "1800" },
      },
    },
  }), request);

  assert.deepEqual(result, { classification: "POPULATED", availableMinutes: [1110, 1140] });
  assert.equal(JSON.stringify(result).includes("discard-me"), false);
});

test("availability classifier distinguishes empty, irrelevant, and malformed responses", () => {
  assert.deepEqual(classifyAvailabilityResponse(JSON.stringify({
    data: { inputDate: "260801", personCount: 2, timeSlotMap: {} },
  }), request), { classification: "EMPTY", availableMinutes: [] });

  assert.deepEqual(classifyAvailabilityResponse(JSON.stringify({
    data: { inputDate: "260802", personCount: 2, timeSlotMap: {} },
  }), request), { classification: "IRRELEVANT", availableMinutes: [] });

  assert.deepEqual(classifyAvailabilityResponse(JSON.stringify({
    data: { inputDate: "260801", personCount: 2, timeSlotMap: { "2500": { availableYn: true } } },
  }), request), { classification: "UNPARSABLE", availableMinutes: [] });

  assert.deepEqual(classifyAvailabilityResponse("not-json", request), {
    classification: "UNPARSABLE",
    availableMinutes: [],
  });
});

test("reservation dates normalize only supported explicit formats", () => {
  assert.equal(normalizeReservationDate("2026-08-01"), "2026-08-01");
  assert.equal(normalizeReservationDate("260801"), "2026-08-01");
  assert.equal(normalizeReservationDate("20260801"), "2026-08-01");
  assert.equal(normalizeReservationDate("01/08/2026"), null);
});

test("bridge event validation rejects malformed and oversized payloads", () => {
  const valid = {
    source: "ct-reserve-main",
    type: "AVAILABILITY_SHADOW_EVENT",
    schemaVersion: 1,
    channelId: "channel-1",
    sequence: 1,
    requestDate: "260801",
    personCount: 2,
    classification: "POPULATED",
    availableMinutes: [1110, 1140],
    responseStatus: 200,
    requestSentMonoMs: 1,
    responseCompletedMonoMs: 2,
    bodyReadCompletedMonoMs: 3,
    payloadClassifiedMonoMs: 4,
  };
  assert.equal(isAvailabilityShadowEvent(valid, "channel-1"), true);
  assert.equal(isAvailabilityShadowEvent({ ...valid, channelId: "other" }, "channel-1"), false);
  assert.equal(isAvailabilityShadowEvent({ ...valid, sequence: 0 }, "channel-1"), false);
  assert.equal(isAvailabilityShadowEvent({ ...valid, availableMinutes: Array.from({ length: 65 }, (_, i) => i) }, "channel-1"), false);
  assert.equal(isAvailabilityShadowEvent({ ...valid, availableMinutes: [1440] }, "channel-1"), false);
});

test("shadow claim coordinator keeps the first diagnostic claim only", () => {
  const coordinator = new ShadowClaimCoordinator();
  const first = coordinator.propose({ source: "body", minutes: 1140, observedMonoMs: 10, sequence: 7 });
  const second = coordinator.propose({ source: "dom", minutes: 1140, observedMonoMs: 30, sequence: null });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.deepEqual(coordinator.claim, {
    source: "body",
    minutes: 1140,
    observedMonoMs: 10,
    sequence: 7,
  });
});
