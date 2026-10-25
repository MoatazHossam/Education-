import { describe, expect, it } from 'vitest';
import { describeDue, reminderSections, reminderTitle } from '../../src/scopes/reminders.js';

describe('due-date reminder wording', () => {
  it('says today, tomorrow, or the date, across month and year ends', () => {
    expect(describeDue('en', '2026-12-31', '2026-12-31')).toBe('due today');
    expect(describeDue('en', '2027-01-01', '2026-12-31')).toBe('due tomorrow');
    expect(describeDue('en', '2026-03-02', '2026-02-28')).toBe('due 2 Mar 2026');
    expect(describeDue('en', '2026-02-27', '2026-03-01')).toBe('was due 27 Feb 2026');
    expect(describeDue('ar', '2026-11-10', '2026-11-10')).toBe('موعده اليوم');
    expect(describeDue('ar', '2026-11-11', '2026-11-10')).toBe('موعده غدًا');
    expect(describeDue('ar', '2026-11-08', '2026-11-10')).toBe('كان موعده ٨ نوفمبر ٢٠٢٦');
    expect(describeDue('ar', '2026-11-08', '2026-11-10')).not.toMatch(/[\u200e\u200f]/);
  });

  it('lists overdue books first, each section by due date, and shortens long lists', () => {
    const items = [
      { scopeName: 'Plan', title: 'B', dueOn: '2026-11-12', kind: 'due_soon' as const },
      { scopeName: 'Plan', title: 'A', dueOn: '2026-11-10', kind: 'due_soon' as const },
      { scopeName: 'Plan', title: 'C', dueOn: '2026-11-09', kind: 'overdue' as const },
    ];
    expect(reminderSections('en', items, '2026-11-10')).toBe(
      'Overdue (1):\n• C — “Plan”, was due 9 Nov 2026\n\nDue soon (2):\n• A — “Plan”, due today\n• B — “Plan”, due 12 Nov 2026',
    );
    const many = Array.from({ length: 25 }, (_, i) => ({ scopeName: 'Plan', title: `Book ${String(i).padStart(2, '0')}`, dueOn: '2026-11-11', kind: 'due_soon' as const }));
    const ar = reminderSections('ar', many, '2026-11-10');
    expect(ar.startsWith('يحين موعدها قريبًا (25):\n• Book 00 — «Plan»، موعده غدًا')).toBe(true);
    expect(ar.endsWith('• و5 غيرها')).toBe(true);
    expect(ar.match(/^• /gm)).toHaveLength(21);
  });

  it('titles the in-app notice by what is due', () => {
    expect(reminderTitle('en', 0, 1)).toBe('1 book is due soon');
    expect(reminderTitle('en', 3, 0)).toBe('3 books are overdue');
    expect(reminderTitle('en', 2, 4)).toBe('2 overdue and 4 due soon');
    expect(reminderTitle('ar', 1, 0)).toBe('كتب متأخرة عن موعدها (1)');
  });
});
