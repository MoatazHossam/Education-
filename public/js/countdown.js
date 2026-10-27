// When a timed test tells a screen reader how much time is left (docs/ONLINE_TESTS.md §5).
// No imports, so the unit tests load it as it is.

/** Minutes before the end at which the time left is announced. */
export const ANNOUNCE_AT_MINUTES = [5, 1];

/**
 * Returns a function to call with the time left (ms) on every tick; it answers the minutes to
 * announce, or null. A mark is said once, when the time left crosses it. Marks already behind
 * when the page opens are not said (the timer itself can be read), and when the teacher gives
 * more time, the marks ahead again are said again when they come.
 */
export function countdownAnnouncer(marks = ANNOUNCE_AT_MINUTES) {
  let said = null;
  return (leftMs) => {
    const behind = (m) => leftMs <= m * 60_000;
    if (said === null) {
      said = new Set(marks.filter(behind));
      return null;
    }
    for (const m of marks) if (!behind(m)) said.delete(m);
    if (leftMs <= 0) return null;
    const due = marks.filter((m) => behind(m) && !said.has(m));
    for (const m of due) said.add(m);
    return due.length ? Math.min(...due) : null;
  };
}
