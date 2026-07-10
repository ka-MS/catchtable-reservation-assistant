export interface SlotCandidate {
  key: string;
  minutes: number;
  label: string;
}

export function selectPreferredSlot(
  slots: SlotCandidate[],
  range: { startMinutes: number; endMinutes: number },
  priorityTimes: number[],
): SlotCandidate | null {
  const eligible = slots.filter((slot) => slot.minutes >= range.startMinutes && slot.minutes <= range.endMinutes);
  for (const priority of priorityTimes) {
    const match = eligible.find((slot) => slot.minutes === priority);
    if (match) return match;
  }
  return [...eligible].sort((left, right) => left.minutes - right.minutes)[0] ?? null;
}
