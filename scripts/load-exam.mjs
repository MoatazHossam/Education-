// Load test: one online exam taken at once by a whole grade from one school network
// (docs/TEST_REPORT.md §5). Not a capacity guarantee; run it on hardware like production's.
//
//   OWNER_EMAIL=… OWNER_PASSWORD=… node scripts/load-exam.mjs <base-url> [students=100] [teachers=3] [minutes=5]
//
// Needs a verified owner whose school has student accounts turned on, with room for the students
// (Platform admin → the organization → students limit). Behind Caddy's local certificate, set
// NODE_EXTRA_CA_CERTS to its root certificate. The script creates a class with new students and a
// published test of 20 questions, then:
//   - every student signs in and starts within the first RAMP_SECONDS (default 60), as at the start
//     of an exam; then answers one question every SAVE_SECONDS on average (default 20), sends a
//     heartbeat every 20 s as the test page does, now and then reports leaving the page, and submits
//     at the end;
//   - each teacher (a separate session of the owner) watches the live monitor, which refreshes every 5 s.
// Every request leaves from this one machine, so the server sees one client address, as it does for
// a school behind one NAT. At the end it prints, per kind of request, the status codes and latency
// percentiles, and checks every acknowledged answer against the teacher's view of the attempts.

import { setTimeout as sleep } from 'node:timers/promises';

const [base = 'http://localhost:3000', studentsArg = '100', teachersArg = '3', minutesArg = '5'] = process.argv.slice(2);
const STUDENTS = Number(studentsArg);
const TEACHERS = Number(teachersArg);
const MINUTES = Number(minutesArg);
const RAMP_MS = Number(process.env.RAMP_SECONDS ?? 60) * 1000;
const SAVE_MS = Number(process.env.SAVE_SECONDS ?? 20) * 1000;
const HEARTBEAT_MS = 20_000;
const MONITOR_MS = 5_000;
const QUESTIONS = 20;
const { OWNER_EMAIL: ownerEmail, OWNER_PASSWORD: ownerPassword } = process.env;
if (!ownerEmail || !ownerPassword) throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD');

// ------------------------------------------------------------ measuring

const stats = new Map();
function record(kind, ms, status) {
  let s = stats.get(kind);
  if (!s) stats.set(kind, (s = { times: [], codes: new Map() }));
  s.times.push(ms);
  s.codes.set(status, (s.codes.get(status) ?? 0) + 1);
}

/** A browser-like client: cookie jar, CSRF header, the app's Origin. */
class Client {
  jar = new Map();
  csrf = null;

  async call(kind, method, path, body) {
    const headers = { origin: base, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const t = performance.now();
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      record(kind, performance.now() - t, 'network');
      return { ok: false, status: 0, json: null };
    }
    const json = await res.json().catch(() => null);
    record(kind, performance.now() - t, res.status);
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { ok: res.ok, status: res.status, json };
  }

  async loadCsrf() {
    const me = await this.call('GET /api/auth/me', 'GET', '/api/auth/me');
    this.csrf = me.json?.csrfToken ?? null;
    return me.json;
  }
}

const jitter = (ms) => ms * (0.5 + Math.random());

async function must(res, what) {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

// ------------------------------------------------------------ setup (as the owner)

const owner = new Client();
await must(await owner.call('setup', 'POST', '/api/auth/login', { email: ownerEmail, password: ownerPassword }), 'owner sign-in');
const me = await owner.loadCsrf();
const orgId = me.organizations[0].id;
const stamp = Date.now().toString(36);
const classId = (await must(await owner.call('setup', 'POST', `/api/orgs/${orgId}/classes`, { name: `Load ${stamp}`, grade: 1 }), 'class')).class.id;

const csv = ['username,name,grade', ...Array.from({ length: STUDENTS }, (_, i) => `load${stamp}s${i},Load Student ${i},1`)].join('\n');
const imported = await must(await owner.call('setup', 'POST', `/api/orgs/${orgId}/students/import`, { csv, apply: true }), 'student import');
const students = imported.created.map((s) => ({ ...s, school: imported.schoolCode }));
await must(await owner.call('setup', 'PUT', `/api/orgs/${orgId}/classes/${classId}/students`, { studentIds: students.map((s) => s.userId) }), 'enrolment');

const SUBJECT = { subjectEn: 'Arabic Language', subjectAr: 'اللغة العربية' };
const now = Date.now();
const test = (
  await must(
    await owner.call('setup', 'POST', `/api/orgs/${orgId}/classes/${classId}/tests`, {
      ...SUBJECT,
      title: `Load exam ${stamp}`,
      kind: 'exam',
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + (MINUTES + 30) * 60_000).toISOString(),
      durationMinutes: MINUTES + 15,
      shuffleQuestions: true,
      shuffleOptions: true,
    }),
    'test',
  )
).test;
for (let q = 0; q < QUESTIONS; q++) {
  const body =
    q % 5 === 4
      ? { type: 'short', prompt: `Question ${q + 1}: write the word.`, points: 1, key: ['word', 'كلمة'] }
      : { type: 'single', prompt: `Question ${q + 1}: choose one.`, options: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }, { id: 'c', text: 'Third' }], points: 1, key: ['b'] };
  await must(await owner.call('setup', 'POST', `/api/orgs/${orgId}/tests/${test.id}/questions`, body), `question ${q + 1}`);
}
await must(await owner.call('setup', 'POST', `/api/orgs/${orgId}/tests/${test.id}/publish`), 'publish');
console.log(`Set up: school ${imported.schoolCode}, class ${classId}, ${students.length} students, test ${test.id} (${QUESTIONS} questions).`);

// ------------------------------------------------------------ the exam

const endAt = Date.now() + MINUTES * 60_000;
/** What each student's page was told was saved: attemptId → questionId → answer. */
const acknowledged = new Map();
const outcome = { signedIn: 0, started: 0, submitted: 0, saveFailures: 0, gaveUp: [] };

async function student(s) {
  await sleep(Math.random() * RAMP_MS);
  const c = new Client();
  const login = await c.call('POST /api/auth/student-login', 'POST', '/api/auth/student-login', { school: s.school, username: s.username, password: s.password });
  if (!login.ok) return outcome.gaveUp.push(`${s.username}: sign-in ${login.status}`);
  outcome.signedIn++;
  await c.loadCsrf();
  await c.call('GET /api/student/home', 'GET', '/api/student/home');
  await c.call('GET /api/student/tests/:id', 'GET', `/api/student/tests/${test.id}`);
  const start = await c.call('POST start', 'POST', `/api/student/tests/${test.id}/start`, {});
  if (!start.ok) return outcome.gaveUp.push(`${s.username}: start ${start.status}`);
  outcome.started++;
  const attemptId = start.json.attemptId;
  const page = await c.call('GET /api/student/attempts/:id', 'GET', `/api/student/attempts/${attemptId}`);
  if (!page.ok) return outcome.gaveUp.push(`${s.username}: attempt page ${page.status}`);
  const questions = page.json.questions;
  const mine = new Map();
  acknowledged.set(attemptId, mine);

  let beating = true;
  const beat = (async () => {
    await sleep(Math.random() * HEARTBEAT_MS);
    while (beating) {
      await c.call('POST heartbeat', 'POST', `/api/student/attempts/${attemptId}/heartbeat`, {});
      await sleep(HEARTBEAT_MS);
    }
  })();

  let next = 0;
  while (Date.now() < endAt) {
    await sleep(jitter(SAVE_MS));
    if (Date.now() >= endAt) break;
    const q = questions[next % questions.length];
    next++;
    const answer = q.type === 'short' ? (next % 2 ? 'word' : 'كلمة') : q.options[next % q.options.length].id;
    const saved = await c.call('PUT answer', 'PUT', `/api/student/attempts/${attemptId}/answers/${q.id}`, { answer });
    if (saved.ok) mine.set(q.id, answer);
    else outcome.saveFailures++;
    if (Math.random() < 0.05) await c.call('POST event', 'POST', `/api/student/attempts/${attemptId}/events`, { kind: 'left_page', seconds: 3 });
  }
  beating = false;
  await beat;
  const done = await c.call('POST submit', 'POST', `/api/student/attempts/${attemptId}/submit`, {});
  if (done.ok) outcome.submitted++;
}

async function teacher() {
  const c = new Client();
  await must(await c.call('setup', 'POST', '/api/auth/login', { email: ownerEmail, password: ownerPassword }), 'teacher sign-in');
  await c.loadCsrf();
  while (Date.now() < endAt + 30_000) {
    await c.call('GET monitor', 'GET', `/api/orgs/${orgId}/tests/${test.id}/monitor`);
    await sleep(MONITOR_MS);
  }
}

const started = performance.now();
await Promise.all([...students.map(student), ...Array.from({ length: TEACHERS }, teacher)]);
const wall = (performance.now() - started) / 1000;

// ------------------------------------------------------------ did every acknowledged answer reach the database?

let checked = 0;
let missing = 0;
const queue = [...acknowledged];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [attemptId, mine] = queue.shift();
      const r = await owner.call('check', 'GET', `/api/orgs/${orgId}/tests/${test.id}/attempts/${attemptId}`);
      if (!r.ok) {
        missing += mine.size;
        continue;
      }
      const stored = new Map(r.json.questions.map((q) => [q.id, q.answer]));
      for (const [qid, answer] of mine) {
        checked++;
        if (stored.get(qid) !== answer) missing++;
      }
    }
  }),
);

// ------------------------------------------------------------ report

const pct = (times, q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
const rows = [...stats].filter(([k]) => k !== 'setup' && k !== 'check');
let total = 0;
console.log(`\n${STUDENTS} students, ${TEACHERS} teachers, ${MINUTES} min of exam, ${wall.toFixed(0)} s wall time\n`);
console.log('Request                         n      2xx    429    other   p50 ms  p95 ms  p99 ms  max ms');
for (const [kind, s] of rows.sort((a, b) => a[0].localeCompare(b[0]))) {
  s.times.sort((a, b) => a - b);
  total += s.times.length;
  let ok = 0;
  let limited = 0;
  let other = 0;
  for (const [code, n] of s.codes) {
    if (typeof code === 'number' && code >= 200 && code < 300) ok += n;
    else if (code === 429) limited += n;
    else other += n;
  }
  const f = (n) => n.toFixed(0).padStart(7);
  console.log(`${kind.padEnd(30)}${String(s.times.length).padStart(5)}${String(ok).padStart(8)}${String(limited).padStart(7)}${String(other).padStart(8)} ${f(pct(s.times, 0.5))} ${f(pct(s.times, 0.95))} ${f(pct(s.times, 0.99))} ${f(s.times.at(-1))}`);
  const odd = [...s.codes].filter(([code]) => !(typeof code === 'number' && code >= 200 && code < 300) && code !== 429);
  if (odd.length) console.log(`${''.padEnd(30)}other codes: ${odd.map(([code, n]) => `${code}×${n}`).join(', ')}`);
}
console.log(`\n${total} requests, ${(total / wall).toFixed(1)} per second on average`);
console.log(`Students signed in ${outcome.signedIn}/${STUDENTS}, started ${outcome.started}, submitted ${outcome.submitted}; answer saves refused ${outcome.saveFailures}`);
console.log(`Acknowledged answers checked against the teacher's view: ${checked}, missing or different: ${missing}`);
if (outcome.gaveUp.length) console.log(`Gave up (${outcome.gaveUp.length}): ${outcome.gaveUp.slice(0, 8).join('; ')}${outcome.gaveUp.length > 8 ? '; …' : ''}`);
process.exitCode = missing || outcome.gaveUp.length || outcome.saveFailures ? 1 : 0;
