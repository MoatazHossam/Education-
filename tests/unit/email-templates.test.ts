import { describe, expect, it } from 'vitest';
import { renderEmail } from '../../src/notifications/email.js';

describe('Arabic emails', () => {
  it('name the invited role as the Arabic interface does', () => {
    const ar = renderEmail('invitation', 'ar', { inviterName: 'منى حسن', orgName: 'مدرسة وادي النيل', role: 'editor', link: 'https://x/invite' });
    expect(ar.text).toContain('بدور محرر.');
    expect(ar.text).not.toContain('editor');
    // The English email keeps the role's own name.
    expect(renderEmail('invitation', 'en', { inviterName: 'Mona', orgName: 'Nile', role: 'editor', link: 'https://x/invite' }).text).toContain('as editor.');
  });

  it('say "a book" for one assigned book and "books" for more', () => {
    const base = { by: 'منى حسن', scope: 'الكتب', orgName: 'المدرسة', items: '• Gem', link: 'https://x', settingsLink: 'https://x/account' };
    const one = renderEmail('items_assigned', 'ar', { ...base, count: '1' });
    expect(one.subject).toBe('أسند إليك منى حسن كتابًا في «الكتب» (1)');
    expect(one.text).toContain('أسند إليك منى حسن كتابًا للمتابعة');
    expect(renderEmail('items_assigned', 'ar', { ...base, count: '2' }).subject).toBe('أسند إليك منى حسن كتبًا في «الكتب» (2)');
  });
});
