import { describe, expect, it } from 'vitest';
import { countdownAnnouncer } from '../../public/js/countdown.js';

const min = (m: number, s = 0) => (m * 60 + s) * 1000;

describe('the time left announced in a timed test', () => {
  it('says 5 minutes and 1 minute once each, when the time left crosses them', () => {
    const say = countdownAnnouncer();
    expect(say(min(20))).toBeNull(); // the page opens
    expect(say(min(5, 1))).toBeNull();
    expect(say(min(5))).toBe(5);
    expect(say(min(4, 59))).toBeNull();
    expect(say(min(1))).toBe(1);
    expect(say(min(0, 30))).toBeNull();
    expect(say(0)).toBeNull();
  });

  it('does not say a mark already behind when the page opens', () => {
    const say = countdownAnnouncer();
    expect(say(min(3))).toBeNull(); // opened with 3 minutes left: no "5 minutes left"
    expect(say(min(2))).toBeNull();
    expect(say(min(0, 59))).toBe(1);
    const late = countdownAnnouncer();
    expect(late(min(0, 40))).toBeNull();
    expect(late(min(0, 39))).toBeNull();
  });

  it('says the marks again after the teacher gives more time', () => {
    const say = countdownAnnouncer();
    say(min(10));
    expect(say(min(4))).toBe(5);
    expect(say(min(14))).toBeNull(); // ten more minutes
    expect(say(min(5))).toBe(5);
    expect(say(min(0, 50))).toBe(1);
  });

  it('says only the nearer mark when a tick jumps past both', () => {
    const say = countdownAnnouncer();
    say(min(6));
    expect(say(min(0, 45))).toBe(1); // the tab was in the background
    expect(say(min(0, 44))).toBeNull();
  });
});
