// Types for the unit tests (tests/unit/countdown.test.ts); the browser loads countdown.js as it is.
export const ANNOUNCE_AT_MINUTES: number[];
export function countdownAnnouncer(marks?: number[]): (leftMs: number) => number | null;
