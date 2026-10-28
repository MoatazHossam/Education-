// Online tests and exams for teachers (docs/ONLINE_TESTS.md): the class page's
// list, the test page with its questions, the live monitor with the controls
// for single students, and results with marking.
import { del, get, patch, post, put } from '../api.js';
import { append, confirmDialog, dialog, errorMessage, fmtDate, fmtNum, h, link, none, tableCard, th, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { invalidateOrg } from '../state.js';
import { act, localInput, pointsText, settableSubjects, subjectName } from './classroom-common.js';
import { retentionNotes } from './retention.js';
import { pageHead } from './shell.js';

const TYPES = ['single', 'multiple', 'true_false', 'short', 'essay'];
const LETTERS = 'abcdefghij';

export function phasePill(test) {
  const kind = { draft: '', upcoming: 'warn', open: 'ok', closed: '' }[test.phase];
  return h('span', { class: `pill ${kind}` }, t(`tests.phase.${test.phase}`));
}

const windowText = (test) => t('tests.window', { opens: fmtDate(test.opensAt, true), closes: fmtDate(test.closedEarlyAt ?? test.closesAt, true) });

/** "1:05:09" or "4:07"; digits as the interface writes them. */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const nf = new Intl.NumberFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB', { minimumIntegerDigits: 2, useGrouping: false });
  const n1 = new Intl.NumberFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB', { useGrouping: false });
  return hh ? `${n1.format(hh)}:${nf.format(mm)}:${nf.format(ss)}` : `${n1.format(mm)}:${nf.format(ss)}`;
}

// ------------------------------------------------------------ the class page's card

/** Settings of a test: new (in a class) or existing. */
async function settingsDialog(orgId, cls, subjects, initial = null, started = false) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const field = (id, label, input, hint) => h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null);
  const check = (id, label, checked, disabled) => {
    const input = h('input', { type: 'checkbox', id, checked, disabled: disabled || null });
    return { input, el: h('label', { class: 'check', for: id }, input, label) };
  };
  const now = new Date();
  // New tests open now (to the minute) for an hour; a teacher planning ahead changes the times.
  const opens = initial ? new Date(initial.opensAt) : new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const closes = initial ? new Date(initial.closesAt) : new Date(opens.getTime() + 3600_000);
  const lock = started ? true : null;
  const f = {
    subject: h('select', { id: 't-subject', disabled: initial ? true : null }, subjects.map((s, i) => h('option', { value: String(i), selected: initial && s.nameEn === initial.subjectEn ? 'selected' : null }, locale() === 'ar' ? s.nameAr : s.nameEn))),
    title: h('input', { id: 't-title', type: 'text', maxlength: 200, required: true, dir: 'auto', value: initial?.title ?? null }),
    instructions: h('textarea', { id: 't-instr', rows: 3, maxlength: 5000, dir: 'auto', value: initial?.instructions ?? '' }),
    kind: h('select', { id: 't-kind', disabled: lock }, ['quiz', 'exam'].map((k) => h('option', { value: k, selected: (initial?.kind ?? 'quiz') === k ? 'selected' : null }, t(`tests.kind.${k}`)))),
    opens: h('input', { id: 't-opens', type: 'datetime-local', required: true, value: localInput(opens), disabled: lock }),
    closes: h('input', { id: 't-closes', type: 'datetime-local', required: true, value: localInput(closes) }),
    duration: h('input', { id: 't-duration', type: 'number', min: '1', max: '600', inputmode: 'numeric', value: initial ? initial.durationMinutes ?? '' : '30', disabled: lock, 'aria-describedby': 't-duration-hint' }),
    attempts: h('input', { id: 't-attempts', type: 'number', min: '1', max: '10', inputmode: 'numeric', value: String(initial?.maxAttempts ?? 1), disabled: lock }),
    results: h('select', { id: 't-results', 'aria-describedby': 't-results-hint' }, ['after_submit', 'after_close', 'manual'].map((k) => h('option', { value: k, selected: (initial?.results ?? 'after_close') === k ? 'selected' : null }, t(`tests.results.${k}`)))),
  };
  const shuffleQ = check('t-shuffle-q', t('tests.shuffleQuestions'), initial?.shuffleQuestions ?? false, started);
  const shuffleO = check('t-shuffle-o', t('tests.shuffleOptions'), initial?.shuffleOptions ?? false, started);
  const showAnswers = check('t-show', t('tests.showAnswers'), initial?.showAnswers ?? false, false);
  const code = check('t-code', t('tests.requireCode'), initial?.requireCode ?? false, started);
  const oneDevice = check('t-device', t('tests.oneDevice'), initial?.oneDevice ?? false, started);
  // Choosing "exam" turns on the stricter defaults; the teacher can still change each one.
  f.kind.addEventListener('change', () => {
    const exam = f.kind.value === 'exam';
    for (const c of [shuffleQ, shuffleO, code, oneDevice]) if (!c.input.disabled) c.input.checked = exam;
  });
  let saved = null;
  await dialog({
    title: initial ? t('tests.editTitle') : t('tests.newTitle', { name: cls.name }),
    body: h('div', { class: 'stack' }, err,
      started ? h('p', { class: 'notice' }, t('tests.lockedNote')) : null,
      field('t-subject', t('classes.subject'), f.subject),
      field('t-title', t('hw.titleField'), f.title),
      field('t-instr', t('hw.instructions'), f.instructions),
      field('t-kind', t('tests.kindLabel'), f.kind),
      h('div', { class: 'grid2 tight' }, field('t-opens', t('tests.opensAt'), f.opens), field('t-closes', t('tests.closesAt'), f.closes)),
      h('div', { class: 'grid2 tight' }, field('t-duration', t('tests.duration'), f.duration, t('tests.durationHint')), field('t-attempts', t('tests.attempts'), f.attempts)),
      field('t-results', t('tests.resultsLabel'), f.results, t('tests.resultsHint')),
      h('fieldset', { class: 'stack' }, h('legend', {}, t('tests.rules')), shuffleQ.el, shuffleO.el, code.el, oneDevice.el, showAnswers.el)),
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: initial ? t('common.save') : t('tests.create'), value: true, validate: async () => {
        err.textContent = '';
        if (!f.title.value.trim()) { f.title.focus(); return false; }
        const s = subjects[Number(f.subject.value)];
        const payload = {
          title: f.title.value.trim(),
          instructions: f.instructions.value,
          closesAt: new Date(f.closes.value).toISOString(),
          results: f.results.value,
          showAnswers: showAnswers.input.checked,
          ...(started ? {} : {
            kind: f.kind.value,
            opensAt: new Date(f.opens.value).toISOString(),
            durationMinutes: f.duration.value === '' ? null : Number(f.duration.value),
            maxAttempts: Number(f.attempts.value || 1),
            shuffleQuestions: shuffleQ.input.checked,
            shuffleOptions: shuffleO.input.checked,
            requireCode: code.input.checked,
            oneDevice: oneDevice.input.checked,
          }),
        };
        try {
          saved = initial ? await patch(`/api/orgs/${orgId}/tests/${initial.id}`, payload) : await post(`/api/orgs/${orgId}/classes/${cls.id}/tests`, { subjectEn: s.nameEn, subjectAr: s.nameAr, ...payload });
          return true;
        } catch (e) { err.textContent = errorMessage(e); return false; }
      },
    }],
  });
  return saved;
}

export function testsCard(orgId, data, subjects) {
  const cls = data.class;
  const newBtn = subjects.length && !cls.archived
    ? h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
      const r = await settingsDialog(orgId, cls, subjects);
      if (r) navigate(`/org/${orgId}/tests/${r.test.id}`);
    }) }, t('tests.new'))
    : null;
  const rows = (data.tests ?? []).map((x) => h('tr', {},
    h('td', {}, link(`/org/${orgId}/tests/${x.id}`, x.title, { dir: 'auto' }), x.kind === 'exam' ? [' ', h('span', { class: 'pill' }, t('tests.kind.exam'))] : null),
    h('td', {}, subjectName(x)),
    h('td', { class: 'nowrap' }, fmtDate(x.opensAt, true)),
    h('td', {}, phasePill(x)),
    h('td', {}, x.status === 'draft' ? none() : t('hw.handedInOf', { n: x.counts.submitted, total: x.counts.enrolled })),
    h('td', {}, x.counts.toMark && x.mine ? h('span', { class: 'pill warn' }, t('classes.toMark', { n: x.counts.toMark })) : none())));
  return h('section', { class: 'card', 'aria-labelledby': 'tests-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'tests-h' }, t('tests.title')), newBtn),
    rows.length
      ? tableCard(t('tests.title'), h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [t('hw.titleField'), t('classes.subject'), t('tests.opensAt'), t('hw.statusCol'), t('tests.submittedCol'), t('classes.toMarkCol')].map(th))),
        h('tbody', {}, rows)))
      : h('p', { class: 'empty' }, t('tests.none')));
}

// ------------------------------------------------------------ the test page: settings and questions

function keyText(q) {
  if (q.key === undefined) return null; // Only those who can change the test receive the key.
  if (q.type === 'single' || q.type === 'multiple') return q.options.filter((o) => (q.key ?? []).includes(o.id)).map((o) => o.text).join(' · ');
  if (q.type === 'true_false') return q.key ? t('tests.true') : t('tests.false');
  if (q.type === 'short') return (q.key ?? []).join(' · ');
  return q.key?.guide || null;
}

async function questionDialog(orgId, testId, initial = null) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const type = h('select', { id: 'q-type', disabled: initial ? true : null }, TYPES.map((k) => h('option', { value: k, selected: (initial?.type ?? 'single') === k ? 'selected' : null }, t(`tests.type.${k}`))));
  const prompt = h('textarea', { id: 'q-prompt', rows: 3, maxlength: 2000, dir: 'auto', required: true, value: initial?.prompt ?? '' });
  const points = h('input', { id: 'q-points', type: 'number', min: '0.25', step: '0.25', inputmode: 'decimal', value: String(initial?.points ?? 1) });
  const body = h('div', { class: 'stack' });
  let rowsBox;
  let options = initial?.options?.length ? initial.options.map((o) => ({ ...o, correct: (initial.key ?? []).includes(o.id) })) : [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }];
  const tf = h('select', { id: 'q-tf' }, [true, false].map((v) => h('option', { value: String(v), selected: initial?.type === 'true_false' && initial.key === v ? 'selected' : null }, v ? t('tests.true') : t('tests.false'))));
  const accepted = h('textarea', { id: 'q-accepted', rows: 3, dir: 'auto', 'aria-describedby': 'q-accepted-hint', value: initial?.type === 'short' ? (initial.key ?? []).join('\n') : '' });
  const guide = h('textarea', { id: 'q-guide', rows: 3, maxlength: 2000, dir: 'auto', value: initial?.type === 'essay' ? initial.key?.guide ?? '' : '' });
  const drawOptions = () => {
    const multiple = type.value === 'multiple';
    rowsBox.replaceChildren(...options.map((o, i) => {
      const id = `q-opt-${i}`;
      const mark = h('input', { type: multiple ? 'checkbox' : 'radio', name: 'q-correct', id: `${id}-c`, checked: o.correct, onchange: (e) => {
        if (!multiple) options.forEach((x) => { x.correct = false; });
        o.correct = e.target.checked;
      } });
      const text = h('input', { type: 'text', id, maxlength: 500, dir: 'auto', value: o.text, oninput: (e) => { o.text = e.target.value; } });
      return h('div', { class: 'opt-row' },
        h('label', { class: 'check', for: `${id}-c` }, mark, h('span', { class: 'sr-only' }, t('tests.correctFor', { n: LETTERS[i].toUpperCase() })), h('span', { 'aria-hidden': 'true' }, t('tests.correct'))),
        h('label', { for: id, class: 'opt-letter' }, t('tests.choice', { n: LETTERS[i].toUpperCase() })), text,
        options.length > 2 ? h('button', { type: 'button', class: 'btn small danger ghost', 'aria-label': t('tests.removeChoice', { n: LETTERS[i].toUpperCase() }), onclick: () => { options.splice(i, 1); drawOptions(); } }, t('common.delete')) : null);
    }));
  };
  const drawKind = () => {
    const kind = type.value;
    let extra;
    if (kind === 'single' || kind === 'multiple') {
      rowsBox = h('div', { class: 'stack' });
      extra = h('fieldset', { class: 'stack' }, h('legend', {}, kind === 'single' ? t('tests.choicesOne') : t('tests.choicesMany')), rowsBox,
        h('div', {}, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { if (options.length < 10) { options.push({ text: '', correct: false }); drawOptions(); } } }, t('tests.addChoice'))));
      drawOptions();
    } else if (kind === 'true_false') {
      extra = h('div', { class: 'field' }, h('label', { for: 'q-tf' }, t('tests.statementIs')), tf);
    } else if (kind === 'short') {
      extra = h('div', { class: 'field' }, h('label', { for: 'q-accepted' }, t('tests.accepted')), accepted, h('span', { class: 'hint', id: 'q-accepted-hint' }, t('tests.acceptedHint')));
    } else {
      extra = h('div', { class: 'field' }, h('label', { for: 'q-guide' }, t('tests.guide')), guide, h('span', { class: 'hint' }, t('tests.guideHint')));
    }
    body.replaceChildren(err,
      h('div', { class: 'field' }, h('label', { for: 'q-type' }, t('tests.typeLabel')), type),
      h('div', { class: 'field' }, h('label', { for: 'q-prompt' }, t('tests.prompt')), prompt),
      extra,
      h('div', { class: 'field' }, h('label', { for: 'q-points' }, t('tests.points')), points));
  };
  type.addEventListener('change', () => { if (type.value === 'single') { let first = true; options.forEach((o) => { if (o.correct && first) first = false; else o.correct = false; }); } drawKind(); });
  drawKind();
  let saved = false;
  await dialog({
    title: initial ? t('tests.editQuestion') : t('tests.addQuestion'),
    body,
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: t('common.save'), value: true, validate: async () => {
        err.textContent = '';
        const kind = type.value;
        let opts = [];
        let key;
        if (kind === 'single' || kind === 'multiple') {
          opts = options.map((o, i) => ({ id: LETTERS[i], text: o.text.trim() }));
          key = options.map((o, i) => (o.correct ? LETTERS[i] : null)).filter(Boolean);
        } else if (kind === 'true_false') key = tf.value === 'true';
        else if (kind === 'short') key = accepted.value.split('\n').map((x) => x.trim()).filter(Boolean);
        else key = { guide: guide.value.trim() || null };
        const payload = { type: kind, prompt: prompt.value.trim(), options: opts, points: Number(points.value), key };
        try {
          if (initial) await patch(`/api/orgs/${orgId}/tests/${testId}/questions/${initial.id}`, payload);
          else await post(`/api/orgs/${orgId}/tests/${testId}/questions`, payload);
          saved = true;
          return true;
        } catch (e) { err.textContent = errorMessage(e); return false; }
      },
    }],
  });
  return saved;
}

// ------------------------------------------------------------ questions suggested by AI (docs/ONLINE_TESTS.md §14)

const SUGGEST_DEFAULT_TYPES = ['single', 'true_false', 'short'];

/** Asks for suggestions, then lets the teacher choose the ones to add. True when questions were added. */
async function suggestDialog(orgId, testId, ai) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const status = h('p', { class: 'muted', role: 'status' });
  const topic = h('input', { id: 'sg-topic', type: 'text', maxlength: 300, dir: 'auto', required: true, 'aria-describedby': 'sg-topic-hint' });
  const lesson = h('textarea', { id: 'sg-lesson', rows: 6, maxlength: 12000, dir: 'auto', 'aria-describedby': 'sg-lesson-hint' });
  const count = h('input', { id: 'sg-count', type: 'number', min: '1', max: '10', step: '1', inputmode: 'numeric', value: '5' });
  const types = TYPES.map((k) => ({ k, box: h('input', { type: 'checkbox', id: `sg-type-${k}`, checked: SUGGEST_DEFAULT_TYPES.includes(k) }) }));
  const difficulty = h('select', { id: 'sg-difficulty' }, ['mixed', 'easy', 'medium', 'hard'].map((d) => h('option', { value: d }, t(`tests.difficulty.${d}`))));
  const language = h('select', { id: 'sg-language' }, ['ar', 'en'].map((l) => h('option', { value: l, selected: locale() === l ? 'selected' : null }, t(`tests.suggestLang.${l}`))));
  const body = h('div', { class: 'stack' },
    h('p', { class: 'notice' }, t('tests.suggestNote')),
    ai.left !== null ? h('p', { class: 'muted' }, t('tests.suggestLeft', { n: fmtNum(ai.left) })) : null,
    err,
    h('div', { class: 'field' }, h('label', { for: 'sg-topic' }, t('tests.suggestTopic')), topic, h('span', { class: 'hint', id: 'sg-topic-hint' }, t('tests.suggestTopicHint'))),
    h('div', { class: 'field' }, h('label', { for: 'sg-lesson' }, t('tests.suggestLesson')), lesson, h('span', { class: 'hint', id: 'sg-lesson-hint' }, t('tests.suggestLessonHint'))),
    h('fieldset', { class: 'stack' }, h('legend', {}, t('tests.suggestTypes')), types.map(({ k, box }) => h('label', { class: 'check', for: box.id }, box, t(`tests.type.${k}`)))),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'sg-count' }, t('tests.suggestCount')), count),
      h('div', { class: 'field' }, h('label', { for: 'sg-difficulty' }, t('tests.suggestDifficulty')), difficulty)),
    h('div', { class: 'field' }, h('label', { for: 'sg-language' }, t('tests.suggestLanguage')), language),
    status);
  let busy = false;
  let reply = null;
  await dialog({
    title: t('tests.suggestTitle'),
    body,
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: t('tests.suggestGo'), value: true, validate: async () => {
        if (busy) return false;
        err.textContent = '';
        const chosen = types.filter((x) => x.box.checked).map((x) => x.k);
        if (topic.value.trim().length < 3) { err.textContent = t('tests.suggestNeedTopic'); topic.focus(); return false; }
        if (!chosen.length) { err.textContent = t('tests.suggestNeedType'); types[0].box.focus(); return false; }
        busy = true;
        status.textContent = t('tests.suggestWorking');
        try {
          reply = await post(`/api/orgs/${orgId}/tests/${testId}/suggest-questions`, {
            topic: topic.value.trim(), lessonText: lesson.value.trim(), count: Math.min(10, Math.max(1, Math.round(Number(count.value) || 5))),
            types: chosen, difficulty: difficulty.value, language: language.value,
          });
          return true;
        } catch (e) {
          err.textContent = errorMessage(e);
          return false;
        } finally {
          busy = false;
          status.textContent = '';
        }
      },
    }],
  });
  return reply ? reviewSuggestions(orgId, testId, reply) : false;
}

async function reviewSuggestions(orgId, testId, { suggestions, dropped }) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const picks = suggestions.map((q, i) => ({ q, box: h('input', { type: 'checkbox', id: `sg-pick-${i}`, checked: true }) }));
  const body = h('div', { class: 'stack' },
    h('p', { class: 'notice' }, t('tests.suggestReview')),
    dropped ? h('p', { class: 'muted' }, t('tests.suggestionsDropped', { n: fmtNum(dropped) })) : null,
    err,
    suggestions.length
      ? h('ol', { class: 'questions' }, picks.map(({ q, box }, i) => h('li', { class: 'question' },
        h('div', { class: 'row spread' },
          h('label', { class: 'check', for: box.id }, box, t('tests.suggestionAdd', { n: i + 1 })),
          h('span', { class: 'muted' }, t(`tests.type.${q.type}`), ' · ', pointsText(q.points))),
        h('div', { class: 'prompt', dir: 'auto' }, q.prompt),
        q.options.length ? h('ul', { class: 'opts' }, q.options.map((o) => h('li', { class: q.key.includes(o.id) ? 'right' : '' }, h('span', { dir: 'auto' }, o.text), q.key.includes(o.id) ? [' ', h('span', { class: 'pill ok' }, t('tests.correct'))] : null))) : null,
        q.type !== 'single' && q.type !== 'multiple' && keyText(q) ? h('p', { class: 'muted' }, q.type === 'essay' ? t('tests.guide') : t('tests.answerIs'), ': ', h('span', { dir: 'auto' }, keyText(q))) : null,
        q.explanation ? h('p', { class: 'muted' }, t('tests.suggestionWhy'), ': ', h('span', { dir: 'auto' }, q.explanation)) : null)))
      : h('p', { class: 'empty' }, t('tests.suggestionsNone')));
  let added = 0;
  await dialog({
    title: t('tests.suggestions'),
    body,
    actions: suggestions.length
      ? [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
        label: t('tests.addSelected'), value: true, validate: async () => {
          err.textContent = '';
          const chosen = picks.filter((p) => p.box.checked);
          if (!chosen.length) { err.textContent = t('tests.suggestNonePicked'); return false; }
          let failed = 0;
          // In order, so the questions keep the order they were suggested in.
          for (const { q, box } of chosen) {
            try {
              await post(`/api/orgs/${orgId}/tests/${testId}/questions`, { type: q.type, prompt: q.prompt, options: q.options, points: q.points, key: q.key });
              added++;
              box.checked = false;
              box.disabled = true;
            } catch (e) {
              failed++;
              err.textContent = errorMessage(e);
            }
          }
          if (failed) { err.textContent = t('tests.addedSome', { added: fmtNum(added), failed: fmtNum(failed) }); return false; }
          return true;
        },
      }]
      : [{ label: t('common.close'), value: null, kind: 'ghost' }],
  });
  if (added) toast(t('tests.addedN', { n: fmtNum(added) }));
  return added > 0;
}

function crumbs(orgId, cls) {
  return h('p', { class: 'crumbs' }, link(`/org/${orgId}/classes`, t('classes.title')), ' › ', link(`/org/${orgId}/classes/${cls.id}`, cls.name, { dir: 'auto' }));
}

function testTabs(orgId, testId, current) {
  return h('nav', { class: 'row tabs', 'aria-label': t('tests.pages') },
    [['', t('tests.tabQuestions')], ['/monitor', t('tests.tabMonitor')], ['/results', t('tests.tabResults')]].map(([path, label]) =>
      link(`/org/${orgId}/tests/${testId}${path}`, label, { class: `btn small ${path === current ? '' : 'ghost'}`, 'aria-current': path === current ? 'page' : null })));
}

export async function testView(ctx) {
  const { orgId, testId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/tests/${testId}`);
  const test = data.test;
  const refresh = () => { invalidateOrg(orgId); ctx.render(); };
  const editableQuestions = data.canEdit && !data.started;

  const actions = data.canEdit
    ? h('div', { class: 'row' },
      test.status === 'draft'
        ? h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
          if (!(await confirmDialog(t('tests.publishTitle'), t('tests.publishText', { n: data.questions.length }), { confirmLabel: t('tests.publish') }))) return;
          await post(`/api/orgs/${orgId}/tests/${testId}/publish`);
          toast(t('tests.published'));
          refresh();
        }) }, t('tests.publish'))
        : !data.started ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => { await post(`/api/orgs/${orgId}/tests/${testId}/unpublish`); refresh(); }) }, t('tests.unpublish')) : null,
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => {
        const cls = await get(`/api/orgs/${orgId}/classes/${data.class.id}`);
        if (await settingsDialog(orgId, cls.class, settableSubjects(cls), test, data.started)) { toast(t('common.saved')); refresh(); }
      }) }, t('tests.settings')),
      h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => act(async () => {
        if (!(await confirmDialog(t('tests.deleteTitle'), t('tests.deleteText', { title: test.title }), { danger: true, confirmLabel: t('common.delete') }))) return;
        await del(`/api/orgs/${orgId}/tests/${testId}`);
        navigate(`/org/${orgId}/classes/${data.class.id}`);
      }) }, t('common.delete')))
    : null;

  const yes = (v) => (v ? t('admin.yes') : t('admin.no'));
  const facts = h('dl', { class: 'kv' },
    h('dt', {}, t('tests.kindLabel')), h('dd', {}, t(`tests.kind.${test.kind}`)),
    h('dt', {}, t('tests.windowLabel')), h('dd', {}, windowText(test)),
    h('dt', {}, t('tests.duration')), h('dd', {}, test.durationMinutes ? t('tests.minutes', { n: fmtNum(test.durationMinutes) }) : t('tests.noLimit')),
    h('dt', {}, t('tests.attempts')), h('dd', {}, fmtNum(test.maxAttempts)),
    h('dt', {}, t('tests.resultsLabel')), h('dd', {}, t(`tests.results.${test.results}`)),
    h('dt', {}, t('tests.rules')), h('dd', {}, [
      [t('tests.shuffleQuestions'), test.shuffleQuestions], [t('tests.shuffleOptions'), test.shuffleOptions], [t('tests.requireCode'), test.requireCode], [t('tests.oneDevice'), test.oneDevice], [t('tests.showAnswers'), test.showAnswers],
    ].map(([label, v]) => h('div', {}, `${label}: ${yes(v)}`))),
    data.accessCode ? [h('dt', {}, t('tests.code')), h('dd', {}, h('span', { class: 'code-big', dir: 'ltr' }, data.accessCode))] : null);

  const total = data.questions.reduce((s, q) => s + q.points, 0);
  const move = async (i, dir) => {
    const ids = data.questions.map((q) => q.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await put(`/api/orgs/${orgId}/tests/${testId}/questions/order`, { ids });
    refresh();
  };
  const questions = h('section', { class: 'card', 'aria-labelledby': 'q-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'q-h' }, t('tests.questionsCount', { n: data.questions.length, points: pointsText(total) })),
      editableQuestions ? h('div', { class: 'row' },
        // Offered when the school has AI requests (docs/ONLINE_TESTS.md §14).
        data.ai ? h('button', { type: 'button', class: 'btn ghost', onclick: () => act(async () => { if (await suggestDialog(orgId, testId, data.ai)) refresh(); }) }, t('tests.suggest')) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => act(async () => { if (await questionDialog(orgId, testId)) refresh(); }) }, t('tests.addQuestion'))) : null),
    data.started && data.canEdit ? h('p', { class: 'muted' }, t('tests.lockedQuestions')) : null,
    data.questions.length
      ? h('ol', { class: 'questions' }, data.questions.map((q, i) => h('li', { class: 'question' },
        h('div', { class: 'row spread' },
          h('span', { class: 'muted' }, t(`tests.type.${q.type}`), ' · ', pointsText(q.points)),
          editableQuestions ? h('div', { class: 'row' },
            i > 0 ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('tests.moveUp', { n: i + 1 }), onclick: () => act(() => move(i, -1)) }, '↑') : null,
            i < data.questions.length - 1 ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('tests.moveDown', { n: i + 1 }), onclick: () => act(() => move(i, 1)) }, '↓') : null,
            h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('tests.editN', { n: i + 1 }), onclick: () => act(async () => { if (await questionDialog(orgId, testId, q)) refresh(); }) }, t('common.edit')),
            h('button', { type: 'button', class: 'btn small danger ghost', 'aria-label': t('tests.deleteN', { n: i + 1 }), onclick: () => act(async () => {
              if (!(await confirmDialog(t('tests.deleteQuestion'), t('tests.deleteQuestionText', { n: i + 1 }), { danger: true, confirmLabel: t('common.delete') }))) return;
              await del(`/api/orgs/${orgId}/tests/${testId}/questions/${q.id}`);
              refresh();
            }) }, t('common.delete'))) : null),
        h('div', { class: 'prompt', dir: 'auto' }, q.prompt),
        q.options.length ? h('ul', { class: 'opts' }, q.options.map((o) => h('li', { class: (q.key ?? []).includes?.(o.id) ? 'right' : '' }, h('span', { dir: 'auto' }, o.text), data.canEdit && (q.key ?? []).includes?.(o.id) ? [' ', h('span', { class: 'pill ok' }, t('tests.correct'))] : null))) : null,
        data.canEdit && q.type !== 'single' && q.type !== 'multiple' && keyText(q) ? h('p', { class: 'muted' }, q.type === 'essay' ? t('tests.guide') : t('tests.answerIs'), ': ', h('span', { dir: 'auto' }, keyText(q))) : null)))
      : h('p', { class: 'empty' }, t('tests.noQuestions')));

  return h('div', {},
    crumbs(orgId, data.class),
    pageHead(test.title, t('tests.headLine', { class: data.class.name, subject: subjectName(test), closes: fmtDate(test.closesAt, true) }), h('p', {}, phasePill(test)), actions),
    testTabs(orgId, testId, ''),
    retentionNotes('test', test, data.retention),
    h('section', { class: 'card', 'aria-labelledby': 's-h' }, h('h2', { id: 's-h' }, t('tests.settings')), facts, test.instructions ? h('div', { class: 'answer', dir: 'auto' }, test.instructions) : null),
    questions);
}

// ------------------------------------------------------------ the live monitor

function statusText(row, offset) {
  const c = row.current;
  if (!c) return h('span', { class: 'muted' }, t('tests.notStarted'));
  if (c.status === 'submitted') return h('span', { class: 'pill ok' }, t(`tests.submitted.${c.submitReason ?? 'student'}`));
  const left = new Date(c.deadlineAt).getTime() - (Date.now() + offset);
  return h('div', {},
    h('span', { class: `dot ${c.online ? 'on' : 'off'}`, 'aria-hidden': 'true' }),
    h('span', {}, c.online ? t('tests.working') : t('tests.away')),
    h('div', { class: 'muted' }, t('tests.progress', { n: fmtNum(c.answered), total: fmtNum(c.total) }), ' · ', h('span', { class: 'timer', 'data-deadline': c.deadlineAt }, t('tests.left', { time: clock(left) }))));
}

function flags(row) {
  const c = row.current;
  if (!c) return none();
  const list = [];
  if (c.leftPage) list.push(h('span', { class: 'pill warn' }, t('tests.flag.left', { n: fmtNum(c.leftPage), s: fmtNum(c.awaySeconds) })));
  if (c.pastes) list.push(h('span', { class: 'pill warn' }, t('tests.flag.paste', { n: fmtNum(c.pastes) })));
  if (c.otherDevice) list.push(h('span', { class: 'pill bad' }, t('tests.flag.device', { n: fmtNum(c.otherDevice) })));
  if (c.offline) list.push(h('span', { class: 'pill' }, t('tests.flag.offline', { n: fmtNum(c.offline) })));
  return list.length ? h('div', { class: 'row' }, list) : none();
}

async function eventsDialog(orgId, test, row) {
  const testId = test.id;
  const { events } = await get(`/api/orgs/${orgId}/tests/${testId}/attempts/${row.current.attemptId}/events`);
  const detail = (e) => (e.detail?.seconds !== undefined ? t('tests.ev.seconds', { s: fmtNum(e.detail.seconds) }) : e.detail?.length !== undefined ? t('tests.ev.chars', { n: fmtNum(e.detail.length) }) : e.detail?.minutes !== undefined ? t('tests.ev.minutes', { n: fmtNum(e.detail.minutes) }) : '');
  await dialog({
    title: t('tests.activityOf', { name: row.name }),
    body: test.monitoringRemovedAt
      ? h('p', { class: 'muted' }, t('ret.removed.monitoring', { date: fmtDate(test.monitoringRemovedAt) }))
      : h('ol', { class: 'events' }, events.map((e) => h('li', {}, h('span', { class: 'mono muted' }, fmtDate(e.at, true)), ' ', t(`tests.ev.${e.kind}`), ' ', detail(e)))),
    actions: [{ label: t('common.close'), value: true, kind: 'ghost' }],
  });
}

async function extraTimeDialog(orgId, testId, row) {
  const input = h('select', { id: 'xt-min' }, [5, 10, 15, 30, 60].map((m) => h('option', { value: String(m) }, t('tests.minutes', { n: fmtNum(m) }))));
  const ok = await dialog({
    title: t('tests.extraTimeFor', { name: row.name }),
    body: h('div', { class: 'stack' }, h('p', {}, t('tests.extraTimeHelp')), h('div', { class: 'field' }, h('label', { for: 'xt-min' }, t('tests.extraTime')), input)),
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: t('tests.giveTime'), value: true }],
  });
  if (!ok) return false;
  await post(`/api/orgs/${orgId}/tests/${testId}/students/${row.studentId}/extra-time`, { minutes: Number(input.value) });
  toast(t('tests.timeGiven', { name: row.name }));
  return true;
}

export async function monitorView(ctx) {
  const { orgId, testId } = ctx.params;
  let data = await get(`/api/orgs/${orgId}/tests/${testId}/monitor`);
  let offset = new Date(data.now).getTime() - Date.now();
  const root = h('div', {});
  const summary = h('p', { class: 'summary', role: 'status' });
  const tbody = h('tbody', {});
  const head = h('div', {});
  const refreshNow = async () => {
    data = await get(`/api/orgs/${orgId}/tests/${testId}/monitor`);
    offset = new Date(data.now).getTime() - Date.now();
    draw();
  };
  const rowActions = (r) => {
    const key = (name) => `${r.studentId}:${name}`;
    // A row's buttons can outlive a refresh (only changed cells are redrawn): read the row as it is now.
    const now = () => data.students.find((x) => x.studentId === r.studentId) ?? r;
    if (!data.canEdit) return r.current ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('activity'), 'aria-label': t('tests.activityOf', { name: r.name }), onclick: () => act(() => eventsDialog(orgId, data.test, now())) }, t('tests.activity')) : null;
    const c = r.current;
    return h('div', { class: 'row' },
      c ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('activity'), 'aria-label': t('tests.activityOf', { name: r.name }), onclick: () => act(() => eventsDialog(orgId, data.test, now())) }, t('tests.activity')) : null,
      h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('time'), 'aria-label': t('tests.extraTimeFor', { name: r.name }), onclick: () => act(async () => { if (await extraTimeDialog(orgId, testId, now())) await refreshNow(); }) }, t('tests.extraTime')),
      c?.status === 'in_progress' ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('submit'), 'aria-label': t('tests.submitFor', { name: r.name }), onclick: () => act(async () => {
        if (!(await confirmDialog(t('tests.submitTitle'), t('tests.submitText', { name: r.name }), { confirmLabel: t('tests.submitNow') }))) return;
        await post(`/api/orgs/${orgId}/tests/${testId}/attempts/${c.attemptId}/submit`);
        await refreshNow();
      }) }, t('tests.submitNow')) : null,
      c?.status === 'in_progress' && c.deviceLocked && c.otherDevice ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('device'), 'aria-label': t('tests.allowDeviceFor', { name: r.name }), onclick: () => act(async () => {
        await post(`/api/orgs/${orgId}/tests/${testId}/attempts/${c.attemptId}/allow-device`);
        toast(t('tests.deviceAllowed', { name: r.name }));
        await refreshNow();
      }) }, t('tests.allowDevice')) : null,
      c?.status === 'submitted' && r.attemptsUsed >= r.attemptsAllowed ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': key('retake'), 'aria-label': t('tests.retakeFor', { name: r.name }), onclick: () => act(async () => {
        await post(`/api/orgs/${orgId}/tests/${testId}/students/${r.studentId}/extra-attempt`);
        toast(t('tests.retakeAllowed', { name: r.name }));
        await refreshNow();
      }) }, t('tests.allowRetake')) : null);
  };
  const draw = () => {
    const test = data.test;
    const counts = { working: 0, submitted: 0, notStarted: 0, online: 0 };
    for (const r of data.students) {
      if (!r.current) counts.notStarted++;
      else if (r.current.status === 'submitted') counts.submitted++;
      else { counts.working++; if (r.current.online) counts.online++; }
    }
    const text = t('tests.summary', { working: fmtNum(counts.working), online: fmtNum(counts.online), submitted: fmtNum(counts.submitted), notStarted: fmtNum(counts.notStarted) });
    if (summary.textContent !== text) summary.textContent = text;
    head.replaceChildren();
    append(head, [
      h('div', { class: 'row' }, phasePill(test), h('span', { class: 'muted' }, windowText(test))),
      data.accessCode && test.phase !== 'closed' ? h('p', {}, t('tests.code'), ': ', h('span', { class: 'code-big', dir: 'ltr' }, data.accessCode), ' ',
        data.canEdit ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => { await post(`/api/orgs/${orgId}/tests/${testId}/new-code`); await refreshNow(); }) }, t('tests.newCode')) : null) : null,
      data.canEdit && test.phase === 'open' ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small danger', onclick: () => act(async () => {
          if (!(await confirmDialog(t('tests.closeTitle'), t('tests.closeText', { n: counts.working }), { danger: true, confirmLabel: t('tests.closeNow') }))) return;
          await post(`/api/orgs/${orgId}/tests/${testId}/close`);
          await refreshNow();
        }) }, t('tests.closeNow'))) : null]);
    // Only cells that changed are replaced, so a control that keeps focus (and a screen reader's
    // place) is left alone while the board refreshes. If the focused control itself had to go,
    // focus moves to its new copy (each row's buttons carry a key), or to the table.
    const focused = tbody.contains(document.activeElement) ? document.activeElement.dataset?.key ?? '' : null;
    const sameRows = tbody.children.length === data.students.length && data.students.every((r, i) => tbody.children[i].dataset.student === r.studentId);
    if (!sameRows) tbody.replaceChildren(...data.students.map((r) => h('tr', { 'data-student': r.studentId }, rowCells(r))));
    else data.students.forEach((r, i) => rowCells(r).forEach((cell, j) => {
      const old = tbody.children[i].children[j];
      if (old.outerHTML !== cell.outerHTML) old.replaceWith(cell);
    }));
    if (focused !== null && !tbody.contains(document.activeElement)) {
      const again = focused && tbody.querySelector(`[data-key="${CSS.escape(focused)}"]`);
      (again || tbody.closest('.table-wrap'))?.focus({ preventScroll: true });
    }
  };
  const rowCells = (r) => [
    h('td', {}, h('b', { dir: 'auto' }, r.name), h('div', { class: 'mono muted', dir: 'ltr' }, r.username)),
    h('td', {}, statusText(r, offset)),
    h('td', {}, flags(r)),
    h('td', {}, r.best && !r.best.needsMarking ? t('hw.markOf', { points: fmtNum(r.best.score), max: fmtNum(r.best.maxPoints) }) : none()),
    h('td', {}, t('tests.attemptsOf', { n: fmtNum(r.attemptsUsed), total: fmtNum(r.attemptsAllowed) }), r.extraMinutes ? h('div', { class: 'muted' }, t('tests.extraMinutes', { n: fmtNum(r.extraMinutes) })) : null),
    // The attempt is part of the markup, so buttons acting on an attempt are rebuilt when it changes.
    h('td', { 'data-attempt': r.current?.attemptId ?? '' }, rowActions(r)),
  ];
  draw();
  // Live: the board every 5 seconds, the countdowns every second, while this page is shown.
  const tick = setInterval(() => {
    if (!root.isConnected) { clearInterval(tick); clearInterval(poll); return; }
    for (const el of root.querySelectorAll('.timer')) el.textContent = t('tests.left', { time: clock(new Date(el.dataset.deadline).getTime() - (Date.now() + offset)) });
  }, 1000);
  const poll = setInterval(() => {
    if (!root.isConnected) { clearInterval(tick); clearInterval(poll); return; }
    if (document.querySelector('dialog[open]')) return;
    refreshNow().catch(() => {});
  }, 5000);
  root.append(
    crumbs(orgId, data.class),
    pageHead(data.test.title, t('tests.monitorSub'), head),
    testTabs(orgId, testId, '/monitor'),
    summary,
    h('p', { class: 'muted' }, t('tests.monitorHelp')),
    tableCard(t('tests.tabMonitor'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('students.student'), t('hw.statusCol'), t('tests.noticed'), t('tests.best'), t('tests.attempts'), ''].map(th))),
      tbody)));
  return root;
}

// ------------------------------------------------------------ results and marking

export async function resultsView(ctx) {
  const { orgId, testId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/tests/${testId}/results`);
  const test = data.test;
  const release = data.canEdit && test.results === 'manual'
    ? test.resultsReleasedAt
      ? h('p', { class: 'notice' }, t('tests.releasedAt', { when: fmtDate(test.resultsReleasedAt, true) }))
      : h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
        if (!(await confirmDialog(t('tests.releaseTitle'), t('tests.releaseText'), { confirmLabel: t('tests.release') }))) return;
        await post(`/api/orgs/${orgId}/tests/${testId}/release`);
        toast(t('tests.releasedToast'));
        ctx.render();
      }) }, t('tests.release'))
    : h('p', { class: 'muted' }, t(`tests.resultsNote.${test.results}`));
  const rows = data.students.map((r) => h('tr', {},
    h('td', {}, h('b', { dir: 'auto' }, r.name)),
    h('td', {}, r.best ? (r.best.needsMarking ? h('span', { class: 'pill warn' }, t('tests.toMark')) : t('hw.markOf', { points: fmtNum(r.best.score), max: fmtNum(r.best.maxPoints) })) : none()),
    h('td', {}, r.attempts.length
      ? h('ul', { class: 'plain' }, r.attempts.map((a) => h('li', {},
        link(`/org/${orgId}/tests/${testId}/attempts/${a.id}`, t('tests.attemptN', { n: fmtNum(a.number) }), { 'aria-label': t('tests.attemptOf', { n: a.number, name: r.name }) }), ' · ',
        a.status === 'in_progress' ? t('tests.working') : a.needsMarking ? h('span', { class: 'pill warn' }, t('tests.toMark')) : t('hw.markOf', { points: fmtNum(a.score), max: fmtNum(a.maxPoints) }))))
      : h('span', { class: 'muted' }, t('tests.notStarted')))));
  return h('div', {},
    crumbs(orgId, data.class),
    pageHead(test.title, t('tests.resultsSub')),
    testTabs(orgId, testId, '/results'),
    retentionNotes('test', test, data.retention),
    release,
    tableCard(t('tests.tabResults'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('students.student'), t('tests.best'), t('tests.attemptsCol')].map(th))),
      h('tbody', {}, rows))));
}

/** A student's answer as text: the chosen choices, true or false, or what they wrote. */
export function answerText(q, answer) {
  if (answer === null || answer === undefined || answer === '') return null;
  if (q.type === 'single') return q.options.find((o) => o.id === answer)?.text ?? '';
  if (q.type === 'multiple') return q.options.filter((o) => answer.includes(o.id)).map((o) => o.text).join(' · ');
  if (q.type === 'true_false') return answer ? t('tests.true') : t('tests.false');
  return String(answer);
}

export async function attemptView(ctx) {
  const { orgId, testId, attemptId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/tests/${testId}/attempts/${attemptId}`);
  const a = data.attempt;
  const items = data.questions.map((q, i) => {
    const given = answerText(q, q.answer);
    const earned = q.manualPoints ?? q.autoPoints;
    const pts = h('input', { type: 'number', id: `m-${q.id}`, min: '0', max: String(q.points), step: '0.25', inputmode: 'decimal', value: q.manualPoints ?? '' });
    const fb = h('textarea', { id: `f-${q.id}`, rows: 2, maxlength: 2000, dir: 'auto', value: q.feedback ?? '' });
    const status = h('span', { class: 'muted', role: 'status' });
    return h('li', { class: 'question' },
      h('div', { class: 'row spread' }, h('span', { class: 'muted' }, t(`tests.type.${q.type}`)),
        h('span', {}, earned === null ? h('span', { class: 'pill warn' }, t('tests.toMark')) : t('hw.markOf', { points: fmtNum(earned), max: fmtNum(q.points) }))),
      h('div', { class: 'prompt', dir: 'auto' }, q.prompt),
      h('p', {}, h('b', {}, t('tests.theirAnswer')), ' ', given ? h('span', { class: 'answer-inline', dir: 'auto' }, given) : h('span', { class: 'muted' }, data.test.workRemovedAt ? t('ret.answerGone') : t('tests.noAnswer'))),
      q.type !== 'essay' && keyText(q) ? h('p', { class: 'muted' }, t('tests.answerIs'), ': ', h('span', { dir: 'auto' }, keyText(q))) : null,
      q.type === 'essay' && keyText(q) ? h('p', { class: 'muted' }, t('tests.guide'), ': ', h('span', { dir: 'auto' }, keyText(q))) : null,
      data.canMark && a.status === 'submitted' ? h('div', { class: 'mark-row' },
        // Every question has the same two fields: their names say which question they belong to.
        h('div', { class: 'field' }, h('label', { for: `m-${q.id}` }, h('span', { class: 'sr-only' }, t('tests.questionNPrefix', { n: fmtNum(i + 1) })), q.type === 'essay' ? t('tests.markOutOf', { max: fmtNum(q.points) }) : t('tests.overrideOutOf', { max: fmtNum(q.points) })), pts),
        h('div', { class: 'field' }, h('label', { for: `f-${q.id}` }, h('span', { class: 'sr-only' }, t('tests.questionNPrefix', { n: fmtNum(i + 1) })), t('hw.feedback')), fb),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', 'aria-label': t('tests.saveMarkN', { n: i + 1 }), onclick: () => act(async () => {
          const r = await patch(`/api/orgs/${orgId}/tests/${testId}/attempts/${attemptId}/answers/${q.id}`, { points: pts.value === '' ? null : Number(pts.value), feedback: fb.value.trim() || null });
          status.textContent = t('tests.savedScore', { score: fmtNum(r.score), max: fmtNum(a.maxPoints) });
        }) }, t('tests.saveMark')), status)) : null);
  });
  return h('div', {},
    h('p', { class: 'crumbs' }, link(`/org/${orgId}/tests/${testId}/results`, t('tests.tabResults'))),
    pageHead(t('tests.attemptTitle', { name: a.student.name, n: a.number }), data.test.title,
      h('p', {}, a.status === 'in_progress' ? t('tests.working') : a.needsMarking ? h('span', { class: 'pill warn' }, t('tests.toMark')) : t('hw.markOf', { points: fmtNum(a.score), max: fmtNum(a.maxPoints) }),
        ' · ', a.submittedAt ? t(`tests.submitted.${a.submitReason ?? 'student'}`) : null, a.submittedAt ? ` ${fmtDate(a.submittedAt, true)}` : null)),
    h('ol', { class: 'questions card' }, items));
}
