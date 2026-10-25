// Editorial verification marks on catalogue subjects and materials, shown to
// customers in the picker and to platform admins in the catalogue editor.
import { fmtDate, h } from './dom.js';
import { t } from './i18n.js';

/** Small ✓ / ! mark inside a material button; the label is for screen readers. */
export function materialMark(m) {
  const v = m.verification;
  if (!v) return null;
  const ok = v.status === 'verified';
  return [h('span', { class: `mv ${ok ? 'ok' : 'warn'}`, 'aria-hidden': 'true' }, ok ? '✓' : '!'), h('span', { class: 'sr-only' }, ` (${ok ? t('verify.verified') : t('verify.needsReview')})`)];
}

function markLine(label, v) {
  const date = fmtDate(v.reviewedAt);
  const source = v.url ? h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', dir: 'auto' }, v.source || v.url) : h('span', { dir: 'auto' }, v.source);
  return h('li', {},
    h('b', { dir: 'auto' }, label), ': ',
    v.status === 'verified'
      ? [t('verify.verifiedOn', { date }), ' ', source, v.note ? [' — ', h('span', { dir: 'auto' }, v.note)] : null]
      : [t('verify.reviewSince', { date }), ' ', h('span', { dir: 'auto' }, v.note)]);
}

const sameMark = (a, b) => a.status === b.status && a.source === b.source && a.url === b.url && a.note === b.note && a.reviewedAt === b.reviewedAt;

/** Expandable badge summarising a subject's marks and those of its materials; null when nothing is marked. */
export function verificationDetails(subject) {
  const marked = subject.materials.filter((m) => m.verification);
  if (!subject.verification && !marked.length) return null;
  const review = subject.verification?.status === 'needs_review' || marked.some((m) => m.verification.status === 'needs_review');
  const kind = review ? 'warn' : subject.verification ? 'ok' : 'part';
  const label = review
    ? t('verify.needsReview')
    : subject.verification
      ? t('verify.verified')
      : t('verify.partial', { k: marked.length, n: subject.materials.length });
  return h('details', { class: `verif ${kind}` },
    h('summary', {}, label),
    h('ul', {}, lines(subject, marked)));
}

// Materials marked together with their subject (same review) share its line.
function lines(subject, marked) {
  const sv = subject.verification;
  const shared = sv ? marked.filter((m) => sameMark(m.verification, sv)) : [];
  const own = marked.filter((m) => !shared.includes(m));
  const n = subject.materials.length;
  const subjectLabel = !shared.length ? t('verify.subjectLabel') : shared.length === n ? t('verify.subjectAndAll', { n }) : t('verify.subjectAndSome', { k: shared.length, n });
  return [sv ? markLine(subjectLabel, sv) : null, own.map((m) => markLine(m.title, m.verification))];
}

/** One line of catalogue-wide coverage for the picker header. */
export function coverageLine(tree) {
  const c = tree.counts.verification;
  if (!c || (!c.subjectsVerified && !c.materialsVerified && !c.subjectsNeedReview && !c.materialsNeedReview)) {
    return h('p', { class: 'vcoverage' }, t('verify.coverageNone'));
  }
  return h('p', { class: 'vcoverage' }, h('span', { 'aria-hidden': 'true' }, '✓ '), t('verify.coverage', { v: c.subjectsVerified, n: tree.counts.subjects }));
}
