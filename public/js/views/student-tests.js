// Online tests in the student portal (docs/ONLINE_TESTS.md §5): the list, a
// test's start page, taking it (the server keeps the time; answers save as the
// student goes), and the results the teacher allows.
import { get, post, put } from '../api.js';
import { append, confirmDialog, errorMessage, fmtDate, fmtNum, h, link, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { pointsText, subjectName } from './classroom-common.js';
import { pageHead } from './shell.js';
import { frame } from './student.js';
import { answerText, clock } from './tests.js';

const HEARTBEAT_MS = 20_000;
const TEXT_SAVE_DELAY_MS = 800;
// An answer that could not be saved (connection lost, server busy) is tried again after 5 s,
// then 10, 20 and every 30 s, for as long as the page is open.
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 30_000;

/** One test in a list: what it is, when, and what the student can do now. */
export function testItem(test) {
  let state;
  if (test.phase === 'upcoming') state = h('span', { class: 'due' }, t('ptests.opens', { when: fmtDate(test.opensAt, true) }));
  else if (test.phase === 'open') {
    state = [h('span', { class: 'due' }, t('ptests.openUntil', { when: fmtDate(test.endsAt, true) })),
      test.inProgressAttemptId
        ? link(`/student/attempts/${test.inProgressAttemptId}`, t('ptests.continue'), { class: 'btn small', 'aria-label': t('ptests.continueTest', { title: test.title }) })
        : test.attemptsUsed < test.attemptsAllowed
          ? link(`/student/tests/${test.id}`, t('ptests.start'), { class: 'btn small', 'aria-label': t('ptests.startTest', { title: test.title }) })
          : h('span', { class: 'pill' }, t('ptests.done'))];
  } else {
    state = test.best
      ? h('span', { class: 'pill ok' }, t('hw.markOf', { points: fmtNum(test.best.score), max: fmtNum(test.best.maxPoints) }))
      : test.submitted ? h('span', { class: 'pill' }, test.waitingForMarks ? t('ptests.waiting') : t('ptests.done')) : h('span', { class: 'pill bad' }, t('ptests.missed'));
  }
  return h('li', { class: 'hw-item' },
    h('div', {}, link(`/student/tests/${test.id}`, test.title, { dir: 'auto', class: 'hw-title' }), test.kind === 'exam' ? [' ', h('span', { class: 'pill' }, t('tests.kind.exam'))] : null,
      h('div', { class: 'muted' }, subjectName(test), ' · ', h('span', { dir: 'auto' }, test.className))),
    h('div', { class: 'hw-side' }, state));
}

export async function testsListView(ctx) {
  let data;
  try { data = await get('/api/student/tests'); } catch (err) { return frame(ctx, pageHead(t('portal.tests'), null), h('div', { class: 'alert error', role: 'alert' }, errorMessage(err))); }
  const groups = [['open', t('portal.testsOpen')], ['upcoming', t('portal.testsUpcoming')], ['closed', t('ptests.past')]];
  const sections = groups.map(([phase, title]) => {
    const list = data.tests.filter((x) => x.phase === phase);
    return list.length ? h('section', { class: 'card', 'aria-labelledby': `t-${phase}` }, h('h2', { id: `t-${phase}` }, title), h('ul', { class: 'hw-list' }, list.map(testItem))) : null;
  });
  return frame(ctx, pageHead(t('portal.tests'), t('ptests.sub')), data.tests.length ? sections : h('p', { class: 'empty' }, t('ptests.none')));
}

// ------------------------------------------------------------ a test's start page

export async function testIntroView(ctx) {
  const { testId } = ctx.params;
  let data;
  try { data = await get(`/api/student/tests/${testId}`); } catch (err) { return frame(ctx, pageHead(t('portal.tests'), null), h('div', { class: 'alert error', role: 'alert' }, errorMessage(err))); }
  const test = data.test;
  const err = h('div', { class: 'alert error', role: 'alert' });
  const code = test.requireCode ? h('input', { id: 'start-code', type: 'text', maxlength: 12, autocomplete: 'off', autocapitalize: 'characters', dir: 'ltr', class: 'code-input', 'aria-describedby': 'start-code-hint' }) : null;
  const canStart = test.phase === 'open' && (test.inProgressAttemptId || test.attemptsUsed < test.attemptsAllowed);
  const start = async () => {
    err.textContent = '';
    if (!test.inProgressAttemptId && !(await confirmDialog(t('ptests.startTitle'), test.durationMinutes ? t('ptests.startTextTimed', { n: fmtNum(test.durationMinutes) }) : t('ptests.startText', { when: fmtDate(test.endsAt, true) }), { confirmLabel: t('ptests.start') }))) return;
    try {
      const r = await post(`/api/student/tests/${testId}/start`, code ? { code: code.value } : {});
      navigate(`/student/attempts/${r.attemptId}`);
    } catch (e) {
      err.textContent = errorMessage(e);
      if (e.code === 'WRONG_START_CODE') code?.focus();
    }
  };
  const facts = h('dl', { class: 'kv' },
    h('dt', {}, t('classes.subject')), h('dd', {}, subjectName(test), ' · ', h('span', { dir: 'auto' }, test.className)),
    h('dt', {}, t('tests.windowLabel')), h('dd', {}, t('tests.window', { opens: fmtDate(test.opensAt, true), closes: fmtDate(test.endsAt, true) })),
    h('dt', {}, t('tests.duration')), h('dd', {}, test.durationMinutes ? t('tests.minutes', { n: fmtNum(test.durationMinutes) }) : t('ptests.untilClose')),
    h('dt', {}, t('tests.attempts')), h('dd', {}, t('tests.attemptsOf', { n: fmtNum(test.attemptsUsed), total: fmtNum(test.attemptsAllowed) })),
    h('dt', {}, t('tests.resultsLabel')), h('dd', {}, t(`ptests.results.${test.results}`)));
  const attempts = data.attempts.length
    ? h('section', { class: 'card', 'aria-labelledby': 'att-h' }, h('h2', { id: 'att-h' }, t('ptests.yourAttempts')),
      h('ul', { class: 'plain' }, data.attempts.map((a) => h('li', {},
        t('tests.attemptN', { n: fmtNum(a.number) }), ' · ',
        a.status === 'in_progress' ? link(`/student/attempts/${a.id}`, t('ptests.continue'))
          : a.resultsVisible ? [a.score !== null ? t('hw.markOf', { points: fmtNum(a.score), max: fmtNum(a.maxPoints) }) : t('ptests.waiting'), ' · ', link(`/student/attempts/${a.id}/result`, t('ptests.review'), { 'aria-label': t('ptests.reviewN', { n: a.number }) })]
            : t('ptests.submittedAt', { when: fmtDate(a.submittedAt, true) })))))
    : null;
  return frame(ctx,
    h('p', { class: 'crumbs' }, link('/student/tests', t('portal.tests'))),
    pageHead(test.title, test.kind === 'exam' ? t('tests.kind.exam') : t('tests.kind.quiz')),
    h('section', { class: 'card', 'aria-labelledby': 'about-h' }, h('h2', { id: 'about-h' }, t('ptests.about')), facts,
      test.instructions ? h('div', { class: 'answer', dir: 'auto' }, test.instructions) : null,
      h('p', { class: 'notice' }, t('ptests.watched'))),
    canStart ? h('section', { class: 'card', 'aria-labelledby': 'go-h' }, h('h2', { id: 'go-h' }, test.inProgressAttemptId ? t('ptests.continue') : t('ptests.ready')), err,
      code ? h('div', { class: 'field' }, h('label', { for: 'start-code' }, t('tests.code')), code, h('span', { class: 'hint', id: 'start-code-hint' }, t('ptests.codeHint'))) : null,
      h('div', {}, h('button', { type: 'button', class: 'btn', onclick: start }, test.inProgressAttemptId ? t('ptests.continue') : t('ptests.start'))))
      : h('p', { class: 'notice' }, test.phase === 'upcoming' ? t('ptests.opens', { when: fmtDate(test.opensAt, true) }) : test.phase === 'closed' ? t('ptests.closed') : t('ptests.noAttempts')),
    attempts);
}

// ------------------------------------------------------------ taking the test

function questionInput(q, value, onChange) {
  const name = `a-${q.id}`;
  if (q.type === 'single' || q.type === 'true_false') {
    const choices = q.type === 'single' ? q.options.map((o) => [o.id, o.text]) : [[true, t('tests.true')], [false, t('tests.false')]];
    return h('div', { class: 'stack choices' }, choices.map(([v, text], i) => {
      const id = `${name}-${i}`;
      return h('label', { class: 'check', for: id }, h('input', { type: 'radio', name, id, checked: value === v, onchange: () => onChange(v, true) }), h('span', { dir: 'auto' }, text));
    }));
  }
  if (q.type === 'multiple') {
    const chosen = new Set(Array.isArray(value) ? value : []);
    return h('div', { class: 'stack choices' }, q.options.map((o, i) => {
      const id = `${name}-${i}`;
      return h('label', { class: 'check', for: id }, h('input', { type: 'checkbox', id, checked: chosen.has(o.id), onchange: (e) => {
        if (e.target.checked) chosen.add(o.id); else chosen.delete(o.id);
        onChange(q.options.map((x) => x.id).filter((x) => chosen.has(x)), true);
      } }), h('span', { dir: 'auto' }, o.text));
    }));
  }
  const field = q.type === 'short'
    ? h('input', { type: 'text', id: name, maxlength: 500, dir: 'auto', value: typeof value === 'string' ? value : '', autocomplete: 'off' })
    : h('textarea', { id: name, rows: 6, maxlength: 10000, dir: 'auto', value: typeof value === 'string' ? value : '' });
  field.addEventListener('input', () => onChange(field.value, false));
  field.addEventListener('blur', () => onChange(field.value, true));
  return h('div', { class: 'field' }, h('label', { for: name }, t('ptests.yourAnswer')), field);
}

export async function takeView(ctx) {
  const { attemptId } = ctx.params;
  let data;
  try {
    data = await get(`/api/student/attempts/${attemptId}`);
  } catch (err) {
    return frame(ctx, pageHead(t('portal.tests'), null), h('div', { class: 'alert error', role: 'alert' }, errorMessage(err)), h('p', {}, link('/student/tests', t('portal.tests'))));
  }
  if (data.attempt.status !== 'in_progress') {
    navigate(`/student/attempts/${attemptId}/result`, { replace: true });
    return null;
  }
  const root = h('div', {});
  let offset = new Date(data.serverNow).getTime() - Date.now();
  let deadline = new Date(data.attempt.deadlineAt).getTime();
  const answers = { ...data.answers };
  const timers = {};
  let finished = false;

  const timerText = h('span', { class: 'clock' });
  const announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const saveState = h('span', { class: 'muted' });
  const announced = new Set();
  const finish = async (why) => {
    if (finished) return;
    finished = true;
    if (why === 'time') {
      try { await post(`/api/student/attempts/${attemptId}/submit`); } catch { /* already submitted by the server */ }
      toast(t('ptests.timeUp'));
    } else if (why === 'teacher') toast(t('ptests.endedByTeacher'));
    navigate(`/student/attempts/${attemptId}/result`, { replace: true });
  };

  // Answers the server has not confirmed yet, and the timer that tries them again.
  const unsaved = new Set();
  let retryTimer = null;
  let retryDelay = RETRY_FIRST_MS;
  const retryUnsaved = () => {
    if (retryTimer || finished) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      for (const qid of [...unsaved]) if (!(await save(qid))) return;
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  };
  /** Saves one answer; true when the server has it. */
  const save = async (qid) => {
    clearTimeout(timers[qid]);
    saveState.textContent = t('ptests.saving');
    try {
      await put(`/api/student/attempts/${attemptId}/answers/${qid}`, { answer: answers[qid] ?? null });
      unsaved.delete(qid);
      if (unsaved.size) saveState.textContent = t('ptests.notSaved', { n: fmtNum(unsaved.size) });
      else {
        retryDelay = RETRY_FIRST_MS;
        saveState.textContent = t('ptests.savedAt', { when: new Intl.DateTimeFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB', { timeStyle: 'short' }).format(new Date()) });
      }
      return true;
    } catch (err) {
      if (err.code === 'TIME_UP' || err.code === 'ATTEMPT_SUBMITTED') {
        finish(err.code === 'TIME_UP' ? 'time' : 'teacher');
        return false;
      }
      if (err.code === 'OTHER_DEVICE') {
        finished = true;
        cleanup();
        toast(errorMessage(err), 'error');
        navigate(`/student/tests/${data.test.id}`, { replace: true });
        return false;
      }
      // Kept, and said once while answers are waiting, not on every failure. A lost connection,
      // a busy server or "too many requests" is tried again; any other refusal would only repeat.
      if (!unsaved.size) announce.textContent = t('ptests.notSavedAnnounce');
      unsaved.add(qid);
      saveState.textContent = t('ptests.notSaved', { n: fmtNum(unsaved.size) });
      if (!err.status || err.status === 408 || err.status === 429 || err.status >= 500) retryUnsaved();
      else toast(errorMessage(err), 'error');
      return false;
    }
  };
  const changed = (qid) => (value, now) => {
    answers[qid] = value === '' ? null : value;
    clearTimeout(timers[qid]);
    if (now) save(qid);
    else timers[qid] = setTimeout(() => save(qid), TEXT_SAVE_DELAY_MS);
  };

  const questions = h('ol', { class: 'questions take' }, data.questions.map((q, i) => h('li', {},
    h('fieldset', { class: 'question', 'aria-describedby': `p-${q.id}` },
      h('legend', {}, t('ptests.questionN', { n: fmtNum(i + 1), total: fmtNum(data.questions.length) }), ' · ', pointsText(q.points)),
      h('div', { class: 'prompt', id: `p-${q.id}`, dir: 'auto' }, q.prompt),
      q.type === 'multiple' ? h('p', { class: 'muted' }, t('ptests.chooseAll')) : null,
      questionInput(q, answers[q.id], changed(q.id))))));

  const submit = h('button', { type: 'button', class: 'btn', onclick: async () => {
    for (const qid of new Set([...Object.keys(timers), ...unsaved])) await save(qid);
    if (unsaved.size && !(await confirmDialog(t('ptests.unsavedTitle'), t('ptests.unsavedText', { n: fmtNum(unsaved.size) }), { danger: true, confirmLabel: t('ptests.submitAnyway') }))) return;
    const blank = data.questions.filter((q) => answers[q.id] === undefined || answers[q.id] === null || (Array.isArray(answers[q.id]) && !answers[q.id].length)).length;
    if (!(await confirmDialog(t('ptests.submitTitle'), blank ? t('ptests.submitBlank', { n: fmtNum(blank) }) : t('ptests.submitText'), { confirmLabel: t('ptests.submit') }))) return;
    try {
      await post(`/api/student/attempts/${attemptId}/submit`);
      toast(t('ptests.submittedToast'));
      finished = true;
      navigate(`/student/attempts/${attemptId}/result`, { replace: true });
    } catch (err) {
      if (err.code === 'ATTEMPT_SUBMITTED') return finish('teacher');
      toast(errorMessage(err), 'error');
    }
  } }, t('ptests.submit'));

  const bar = h('div', { class: 'testbar', role: 'region', 'aria-label': t('ptests.timeLeftLabel') },
    h('span', { role: 'timer', 'aria-label': t('ptests.timeLeftLabel') }, t('ptests.timeLeft'), ' ', timerText),
    saveState);

  // What the teacher's monitor shows: time away from this page, pasting, losing the connection.
  let awaySince = null;
  const sendEvent = (body) => post(`/api/student/attempts/${attemptId}/events`, body).catch(() => {});
  const away = () => { if (awaySince === null && !finished) awaySince = Date.now(); };
  const back = () => {
    if (awaySince === null || finished) return;
    const seconds = Math.round((Date.now() - awaySince) / 1000);
    awaySince = null;
    if (seconds >= 1) sendEvent({ kind: 'left_page', seconds });
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back());
  const onPaste = (e) => { if (root.contains(e.target)) sendEvent({ kind: 'paste', length: (e.clipboardData?.getData('text') ?? '').length }); };
  let offlineSince = null;
  const onOffline = () => { offlineSince = Date.now(); };
  const onOnline = () => {
    if (offlineSince === null) return;
    sendEvent({ kind: 'offline', seconds: Math.round((Date.now() - offlineSince) / 1000) });
    offlineSince = null;
    for (const qid of Object.keys(answers)) save(qid);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', away);
  window.addEventListener('focus', back);
  document.addEventListener('paste', onPaste);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  const cleanup = () => {
    clearInterval(tick);
    clearInterval(beat);
    clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', away);
    window.removeEventListener('focus', back);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
  };

  const drawClock = () => {
    const left = deadline - (Date.now() + offset);
    timerText.textContent = clock(left);
    bar.classList.toggle('urgent', left < 5 * 60_000);
    for (const m of [5, 1]) {
      if (left <= m * 60_000 && left > 0 && !announced.has(m)) {
        announced.add(m);
        announce.textContent = t('ptests.minutesLeft', { n: fmtNum(m) });
      }
    }
    if (left <= 0) finish('time');
  };
  const tick = setInterval(() => {
    if (!root.isConnected) return cleanup();
    drawClock();
  }, 1000);
  const beat = setInterval(async () => {
    if (!root.isConnected) return cleanup();
    try {
      const r = await post(`/api/student/attempts/${attemptId}/heartbeat`);
      offset = new Date(r.serverNow).getTime() - Date.now();
      if (new Date(r.deadlineAt).getTime() > deadline) toast(t('ptests.moreTime'));
      deadline = new Date(r.deadlineAt).getTime();
      if (r.status !== 'in_progress') finish('teacher');
    } catch (err) {
      if (err.code === 'OTHER_DEVICE') { finished = true; cleanup(); toast(errorMessage(err), 'error'); navigate(`/student/tests/${data.test.id}`, { replace: true }); }
    }
  }, HEARTBEAT_MS);
  drawClock();

  append(root, [
    pageHead(data.test.title, t('ptests.attemptLine', { n: fmtNum(data.attempt.number), subject: subjectName(data.test) })),
    bar,
    announce,
    h('p', { class: 'notice' }, t('ptests.watched')),
    data.test.instructions ? h('div', { class: 'answer', dir: 'auto' }, data.test.instructions) : null,
    questions,
    h('div', { class: 'row submit-row' }, submit, h('span', { class: 'muted' }, t('ptests.autosave')))]);
  return frame(ctx, root);
}

// ------------------------------------------------------------ results

export async function resultView(ctx) {
  const { attemptId } = ctx.params;
  let data;
  try {
    data = await get(`/api/student/attempts/${attemptId}/result`);
  } catch (err) {
    if (err.code === 'RESULTS_NOT_YET') {
      return frame(ctx, pageHead(t('ptests.submittedTitle'), null), h('p', { class: 'notice', role: 'status' }, t('ptests.resultsLater')), h('p', {}, link('/student/tests', t('portal.tests'))));
    }
    return frame(ctx, pageHead(t('portal.tests'), null), h('div', { class: 'alert error', role: 'alert' }, errorMessage(err)));
  }
  const a = data.attempt;
  const items = data.questions.map((q, i) => {
    const given = answerText(q, q.answer);
    const correct = q.correct === null ? null : answerText(q, q.type === 'single' ? q.correct[0] : q.type === 'short' ? q.correct.join(' · ') : q.correct);
    return h('li', { class: 'question' },
      h('div', { class: 'row spread' }, h('span', { class: 'muted' }, t('ptests.questionN', { n: fmtNum(i + 1), total: fmtNum(data.questions.length) })),
        q.waiting ? h('span', { class: 'pill warn' }, t('ptests.waiting')) : h('span', { class: q.earned === q.points ? 'pill ok' : 'pill' }, t('hw.markOf', { points: fmtNum(q.earned ?? 0), max: fmtNum(q.points) }))),
      h('div', { class: 'prompt', dir: 'auto' }, q.prompt),
      h('p', {}, h('b', {}, t('ptests.yourAnswer')), ': ', given ? h('span', { dir: 'auto' }, given) : h('span', { class: 'muted' }, data.test.workRemovedAt ? t('ret.student.answerGone') : t('tests.noAnswer'))),
      correct ? h('p', { class: 'muted' }, t('tests.answerIs'), ': ', h('span', { dir: 'auto' }, correct)) : null,
      q.feedback ? h('div', { class: 'answer', dir: 'auto' }, q.feedback) : null);
  });
  return frame(ctx,
    h('p', { class: 'crumbs' }, link(`/student/tests/${data.test.id}`, data.test.title, { dir: 'auto' })),
    pageHead(t('ptests.resultTitle'), data.test.title),
    h('section', { class: 'card', 'aria-labelledby': 'score-h' }, h('h2', { id: 'score-h' }, t('portal.yourMark')),
      a.score !== null ? h('p', { class: 'mark-big' }, t('hw.markOf', { points: fmtNum(a.score), max: fmtNum(a.maxPoints) })) : h('p', { class: 'notice' }, t('ptests.partlyMarked')),
      data.answersShown ? null : h('p', { class: 'muted' }, t('ptests.answersHidden'))),
    h('ol', { class: 'questions card' }, items));
}
