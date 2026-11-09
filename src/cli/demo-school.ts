import { randomBytes } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../app.js';
import { recordAudit } from '../audit/audit.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createAppDatabase, withSystemContext, type Database } from '../db/index.js';

// Usage (in the app container): node dist/cli/demo-school.js --email you@example.com [--lang ar|en]
//                                node dist/cli/demo-school.js --email you@example.com --remove
//
// Builds a complete demo school on an installation, for showing Midad to schools: an owner and two
// teachers, a Primary 4 content scope with notes, twelve invented students in two classes, homework
// (marked and returned, handed in, still open), a marked quiz with released results, an upcoming exam
// and two teaching plans. Everything except the accounts and the plan goes through the application's
// own API, run in this process, with the same checks as the web interface.
//
// The staff accounts use the operator's address with a "+midad-demo-…" tag, so their emails reach the
// operator. The passwords are random and printed once, here only. --remove deletes the school, its
// students and the demo staff accounts, through the same API.

const TAGS = { owner: 'midad-demo-owner', arabic: 'midad-demo-teacher1', maths: 'midad-demo-teacher2' } as const;
type Lang = 'ar' | 'en';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DemoAccount { role: string; name: string; email: string; password: string }
export interface DemoStudent { name: string; username: string; password: string; className: string }
export interface DemoResult { orgId: string; schoolName: string; schoolCode: string; staff: DemoAccount[]; students: DemoStudent[] }

/** The operator's address with a tag: owner@gmail.com → owner+midad-demo-owner@gmail.com. */
export function taggedEmail(email: string, tag: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@') as [string, string];
  return `${local.split('+')[0]}+${tag}@${domain}`;
}

const newPassword = () => randomBytes(12).toString('base64url');
const inDays = (d: number, hour?: number) => {
  const t = new Date(Date.now() + d * 86_400_000);
  if (hour !== undefined) t.setUTCHours(hour - 2, 0, 0, 0); // Cairo (UTC+2) at that hour
  return t;
};
const date = (d: number) => inDays(d).toISOString().slice(0, 10);

/** A browser-like client of the app in this process: cookies, CSRF token, one address. */
class Client {
  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  constructor(private readonly app: FastifyInstance, readonly label: string) {}

  async call(method: InjectOptions['method'], url: string, body?: unknown, ok: number[] = [200, 201, 202, 204]): Promise<Json> {
    const res = await this.app.inject({
      method,
      url,
      remoteAddress: '127.0.0.1',
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of res.cookies as { name: string; value: string; expires?: Date }[]) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    if (!ok.includes(res.statusCode)) throw new Error(`${this.label}: ${method} ${url} answered ${res.statusCode}: ${res.body.slice(0, 300)}`);
    return res.body ? (res.json() as Json) : {};
  }
  get = (url: string) => this.call('GET', url);
  post = (url: string, body: unknown = {}) => this.call('POST', url, body);
  patch = (url: string, body: unknown) => this.call('PATCH', url, body);
  put = (url: string, body: unknown) => this.call('PUT', url, body);
  del = (url: string, body?: unknown) => this.call('DELETE', url, body);

  async signIn(path: string, body: unknown): Promise<Json> {
    await this.post(path, body);
    const me = await this.get('/api/auth/me');
    this.csrf = me.csrfToken;
    return me;
  }
}

// ---------------------------------------------------------------- the demo's content
const TEXT = {
  ar: {
    school: 'مدرسة النور النموذجية (عرض تجريبي)',
    owner: 'منى حسن', arabic: 'كريم عادل', maths: 'سلمى فتحي',
    scope: 'الصف الرابع الابتدائي — الكتب الأساسية', scopeDescription: 'كتب الوزارة لكل مواد الصف الرابع الابتدائي (بيانات عرض تجريبي).',
    notes: {
      ar: 'راجعوا الطبعة الجديدة قبل بداية الترم الثاني.', ma: 'اطلبوا 60 نسخة إضافية من كراسة التدريبات.',
      sc: 'جهّزوا أدوات تجربة الدورة المائية في المعمل.', en: 'استلمنا نسخ المعلم.',
    },
    students: ['أحمد علي', 'مريم حسن', 'عمر خالد', 'ليلى مصطفى', 'يوسف سمير', 'نور أحمد', 'هنا طارق', 'آدم فتحي', 'سلمى إبراهيم', 'كريم نبيل', 'فريدة عادل', 'زياد محمود'],
    classes: ['الرابع أ', 'الرابع ب'],
    hw1: { title: 'اقرأ قصة «البذرة الصغيرة»', instructions: 'اقرأ الصفحات من 12 إلى 15 في كتاب اللغة العربية، ثم أجب عن الأسئلة الثلاثة في آخر القصة.' },
    hw1Answers: [
      '1) بذرة صغيرة. 2) الماء والشمس. 3) صارت شجرة كبيرة.', '1) بذرة. 2) تحتاج إلى الماء. 3) كبرت.', '1) بذرة صغيرة في الحديقة. 2) الماء والشمس والتربة. 3) صارت شجرة تعطي ثمارًا.',
      '1) بذرة. 2) الماء والشمس. 3) صارت شجرة.', '1) شجرة. 2) الماء. 3) لا أعرف.', '1) بذرة صغيرة. 2) الماء والضوء. 3) نمت وصارت شجرة.',
    ],
    hw1Marks: [[9, 'أحسنت. اكتب جملًا كاملة في المرة القادمة.'], [7, 'إجابة جيدة، لكن السؤال الثالث يحتاج تفصيلًا.'], [10, 'ممتاز! إجابات كاملة وواضحة.'], [8, 'جيد جدًا.'], [5, 'راجع القصة مرة أخرى وحاول السؤال الثالث.']] as [number, string][],
    hw2: { title: 'تمارين الضرب في عدد من رقمين', instructions: 'حل التمارين من 1 إلى 8 في صفحة 34، واكتب خطوات الحل لكل تمرين.' },
    hw2Answers: ['حللت التمارين كلها في الكراسة: 1) 276 2) 504 3) 1,232 …', 'التمارين من 1 إلى 6. لم أفهم التمرين 7.', 'كل التمارين محلولة مع الخطوات.'],
    hw3: { title: 'ارسم الدورة المائية', instructions: 'ارسم مراحل الدورة المائية في كراستك، واكتب اسم كل مرحلة وجملة تشرحها.' },
    quiz: { title: 'اختبار قصير: الضرب والقسمة', instructions: 'أجب عن جميع الأسئلة. لديك 20 دقيقة.' },
    quizQuestions: [
      { type: 'single', prompt: 'ناتج 12 × 4 =', options: [{ id: 'a', text: '36' }, { id: 'b', text: '48' }, { id: 'c', text: '52' }], points: 2, key: ['b'] },
      { type: 'multiple', prompt: 'أيّ الأعداد التالية تقبل القسمة على 3؟', options: [{ id: 'a', text: '12' }, { id: 'b', text: '14' }, { id: 'c', text: '21' }, { id: 'd', text: '25' }], points: 2, key: ['a', 'c'] },
      { type: 'true_false', prompt: 'ناتج 100 ÷ 4 يساوي 25.', options: [], points: 1, key: true },
      { type: 'short', prompt: 'اكتب ناتج 9 × 7 بالأرقام.', options: [], points: 1, key: ['63', '٦٣'] },
      { type: 'essay', prompt: 'اشرح بخطواتك كيف تحسب 24 × 15.', options: [], points: 4, key: { guide: '24 × 10 = 240 و24 × 5 = 120، والمجموع 360' } },
    ],
    essays: [
      ['24 × 10 = 240، ثم 24 × 5 = 120، ثم أجمع: 240 + 120 = 360.', 4, 'شرح ممتاز.'],
      ['ضربت 24 في 15 فكان الناتج 360.', 2, 'الناتج صحيح، لكن اكتب الخطوات.'],
      ['20 × 15 = 300 و4 × 15 = 60، والمجموع 360.', 4, 'طريقة ذكية!'],
      ['24 + 15 = 39.', 0, 'السؤال عن الضرب لا الجمع؛ راجع الدرس.'],
      ['24 × 10 = 240 و24 × 5 = 120، والمجموع 350.', 3, 'الخطوات صحيحة؛ راجع الجمع في آخرها.'],
      ['15 × 24 = 360 لأن 15 × 20 = 300 و15 × 4 = 60.', 4, 'أحسنت.'],
    ] as [string, number, string][],
    exam: { title: 'امتحان شهر نوفمبر — اللغة العربية', instructions: 'اقرأ كل سؤال جيدًا قبل الإجابة. سيعطيك المعلم رمز البدء في الفصل.' },
    examQuestions: [
      { type: 'single', prompt: 'ما جمع كلمة «كتاب»؟', options: [{ id: 'a', text: 'كتب' }, { id: 'b', text: 'كاتب' }, { id: 'c', text: 'مكتبة' }], points: 2, key: ['a'] },
      { type: 'true_false', prompt: 'كلمة «شجرة» اسم.', options: [], points: 1, key: true },
      { type: 'essay', prompt: 'اكتب ثلاث جمل عن فصل الشتاء.', options: [], points: 5, key: { guide: 'ثلاث جمل صحيحة عن الشتاء' } },
    ],
    lesson: {
      title: 'درس: قصة البذرة الصغيرة',
      content: {
        topic: 'قصة «البذرة الصغيرة»', durationMinutes: 45,
        objectives: ['أن يقرأ التلميذ القصة قراءة جهرية صحيحة', 'أن يذكر ما تحتاج إليه النبتة لتنمو', 'أن يرتب أحداث القصة'],
        activities: [
          { title: 'تمهيد: أسئلة عن النباتات من حولنا', minutes: 5 },
          { title: 'قراءة جهرية للقصة', minutes: 15, description: 'يقرأ المعلم ثم يتناوب التلاميذ على القراءة.' },
          { title: 'عمل في مجموعات', minutes: 20, description: 'ترتب كل مجموعة صور أحداث القصة وتعرضها.' },
          { title: 'تقويم ختامي', minutes: 5 },
        ],
        homework: 'اقرأ الصفحات من 12 إلى 15 وأجب عن الأسئلة في آخر القصة.',
      },
    },
    pacing: {
      title: 'خطة الرياضيات — الترم الأول',
      weeks: [
        { topics: 'الوحدة الأولى: الأعداد حتى المليون', objectives: 'قراءة الأعداد الكبيرة وكتابتها' },
        { topics: 'الوحدة الأولى: مقارنة الأعداد وترتيبها', objectives: 'استخدام < و > و =' },
        { topics: 'الوحدة الثانية: الضرب في عدد من رقمين', objectives: 'الضرب بخطوات منظمة' },
        { topics: 'الوحدة الثانية: القسمة', objectives: 'القسمة على عدد من رقم واحد' },
        { topics: '', notes: 'مراجعة واختبار شهري' },
      ],
    },
  },
  en: {
    school: 'Al Noor Model School (demo)',
    owner: 'Mona Hassan', arabic: 'Karim Adel', maths: 'Salma Fathy',
    scope: 'Primary 4 — core books', scopeDescription: 'The ministry books for every Primary 4 subject (demo data).',
    notes: {
      ar: 'Check the new edition before the second term starts.', ma: 'Order 60 more copies of the workbook.',
      sc: 'Prepare the water-cycle experiment in the lab.', en: 'Teacher copies received.',
    },
    students: ['Ahmed Ali', 'Mariam Hassan', 'Omar Khaled', 'Laila Mostafa', 'Youssef Samir', 'Nour Ahmed', 'Hana Tarek', 'Adam Fathy', 'Salma Ibrahim', 'Karim Nabil', 'Farida Adel', 'Ziad Mahmoud'],
    classes: ['4A', '4B'],
    hw1: { title: 'Read the story “The Little Seed”', instructions: 'Read pages 12 to 15 of the Arabic book, then answer the three questions at the end of the story.' },
    hw1Answers: [
      '1) A little seed. 2) Water and sun. 3) It became a big tree.', '1) A seed. 2) It needs water. 3) It grew.', '1) A little seed in the garden. 2) Water, sun and soil. 3) It became a tree with fruit.',
      '1) A seed. 2) Water and sun. 3) It became a tree.', '1) A tree. 2) Water. 3) I don’t know.', '1) A little seed. 2) Water and light. 3) It grew into a tree.',
    ],
    hw1Marks: [[9, 'Well done. Write full sentences next time.'], [7, 'Good, but question 3 needs more detail.'], [10, 'Excellent! Complete, clear answers.'], [8, 'Very good.'], [5, 'Read the story again and try question 3.']] as [number, string][],
    hw2: { title: 'Multiplying by a two-digit number', instructions: 'Solve exercises 1 to 8 on page 34 and write the steps for each.' },
    hw2Answers: ['All exercises solved in my notebook: 1) 276 2) 504 3) 1,232 …', 'Exercises 1 to 6. I did not understand exercise 7.', 'All exercises solved with the steps.'],
    hw3: { title: 'Draw the water cycle', instructions: 'Draw the stages of the water cycle in your notebook; name each stage and explain it in one sentence.' },
    quiz: { title: 'Quiz: multiplication and division', instructions: 'Answer every question. You have 20 minutes.' },
    quizQuestions: [
      { type: 'single', prompt: '12 × 4 =', options: [{ id: 'a', text: '36' }, { id: 'b', text: '48' }, { id: 'c', text: '52' }], points: 2, key: ['b'] },
      { type: 'multiple', prompt: 'Which numbers can be divided by 3?', options: [{ id: 'a', text: '12' }, { id: 'b', text: '14' }, { id: 'c', text: '21' }, { id: 'd', text: '25' }], points: 2, key: ['a', 'c'] },
      { type: 'true_false', prompt: '100 ÷ 4 equals 25.', options: [], points: 1, key: true },
      { type: 'short', prompt: 'Write the answer to 9 × 7 in digits.', options: [], points: 1, key: ['63'] },
      { type: 'essay', prompt: 'Explain, step by step, how you work out 24 × 15.', options: [], points: 4, key: { guide: '24 × 10 = 240 and 24 × 5 = 120; together 360' } },
    ],
    essays: [
      ['24 × 10 = 240, then 24 × 5 = 120, then 240 + 120 = 360.', 4, 'Excellent explanation.'],
      ['I multiplied 24 by 15 and got 360.', 2, 'Right answer, but write the steps.'],
      ['20 × 15 = 300 and 4 × 15 = 60, so 360.', 4, 'Clever method!'],
      ['24 + 15 = 39.', 0, 'The question asks for multiplication, not addition; read the lesson again.'],
      ['24 × 10 = 240 and 24 × 5 = 120, so 350.', 3, 'Right steps; check the last addition.'],
      ['15 × 24 = 360 because 15 × 20 = 300 and 15 × 4 = 60.', 4, 'Well done.'],
    ] as [string, number, string][],
    exam: { title: 'November exam — Arabic', instructions: 'Read each question carefully. Your teacher gives you the start code in class.' },
    examQuestions: [
      { type: 'single', prompt: 'What is the plural of «كتاب»?', options: [{ id: 'a', text: 'كتب' }, { id: 'b', text: 'كاتب' }, { id: 'c', text: 'مكتبة' }], points: 2, key: ['a'] },
      { type: 'true_false', prompt: 'The word «شجرة» is a noun.', options: [], points: 1, key: true },
      { type: 'essay', prompt: 'Write three sentences about winter.', options: [], points: 5, key: { guide: 'Three correct sentences about winter' } },
    ],
    lesson: {
      title: 'Lesson: The Little Seed',
      content: {
        topic: 'The story “The Little Seed”', durationMinutes: 45,
        objectives: ['Read the story aloud correctly', 'Name what a plant needs to grow', 'Put the events of the story in order'],
        activities: [
          { title: 'Warm-up: questions about plants around us', minutes: 5 },
          { title: 'Reading the story aloud', minutes: 15, description: 'The teacher reads, then pupils take turns.' },
          { title: 'Group work', minutes: 20, description: 'Each group orders pictures of the story’s events and presents them.' },
          { title: 'Closing check', minutes: 5 },
        ],
        homework: 'Read pages 12 to 15 and answer the questions at the end of the story.',
      },
    },
    pacing: {
      title: 'Mathematics — first term',
      weeks: [
        { topics: 'Unit 1: numbers up to a million', objectives: 'Read and write large numbers' },
        { topics: 'Unit 1: comparing and ordering numbers', objectives: 'Use <, > and =' },
        { topics: 'Unit 2: multiplying by a two-digit number', objectives: 'Multiply in organised steps' },
        { topics: 'Unit 2: division', objectives: 'Divide by a one-digit number' },
        { topics: '', notes: 'Revision and monthly test' },
      ],
    },
  },
} as const;

const USERNAMES = ['ahmed.ali', 'mariam.hassan', 'omar.khaled', 'laila.mostafa', 'youssef.samir', 'nour.ahmed', 'hana.tarek', 'adam.fathy', 'salma.ibrahim', 'karim.nabil', 'farida.adel', 'ziad.mahmoud'];
/** Each quiz taker's answers to the first four questions (the essay comes from TEXT.essays). */
const QUIZ_ANSWERS: unknown[][] = [
  ['b', ['a', 'c'], true, '63'], ['b', ['a'], true, '63'], ['b', ['a', 'c'], true, '63'],
  ['a', ['b', 'c'], false, '56'], ['b', ['a', 'c'], true, '63'], ['b', ['a', 'c'], false, '63'],
];

// ---------------------------------------------------------------- accounts
async function createStaffUser(db: Database, email: string, name: string, lang: Lang): Promise<string> {
  const password = newPassword();
  await db.insertInto('users').values({ email, name, password_hash: await hashPassword(password), email_verified_at: new Date(), locale: lang }).execute();
  return password;
}

/** The link token of the newest email of a kind to an address (read at once, before the worker sends and redacts it). */
async function emailToken(db: Database, to: string, template: string): Promise<string> {
  const row = await withSystemContext(db, (trx) =>
    trx.selectFrom('email_outbox').select('text_body').where('to_email', '=', to).where('template', '=', template).orderBy('created_at', 'desc').executeTakeFirst(),
  );
  const m = row?.text_body.match(/[?&]token=([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error(`no ${template} link found for ${to}`);
  return m[1];
}

async function quietEmails(c: Client) {
  await c.patch('/api/auth/profile', { assignmentEmails: false, dueReminderEmails: false, catalogEmails: false });
}

// ---------------------------------------------------------------- create
export async function createDemoSchool(app: FastifyInstance, db: Database, opts: { email: string; lang: Lang }): Promise<DemoResult> {
  const t = TEXT[opts.lang];
  const emails = { owner: taggedEmail(opts.email, TAGS.owner), arabic: taggedEmail(opts.email, TAGS.arabic), maths: taggedEmail(opts.email, TAGS.maths) };
  const taken = await db.selectFrom('users').select('email').where('email', 'in', Object.values(emails)).execute();
  if (taken.length) throw new Error(`A demo school already exists for ${opts.email} (${taken.map((r) => r.email).join(', ')}). Remove it first with --remove.`);

  // Staff accounts: verified addresses, random passwords.
  const passwords = {
    owner: await createStaffUser(db, emails.owner, t.owner, opts.lang),
    arabic: await createStaffUser(db, emails.arabic, t.arabic, opts.lang),
    maths: await createStaffUser(db, emails.maths, t.maths, opts.lang),
  };
  const owner = new Client(app, 'owner');
  await owner.signIn('/api/auth/login', { email: emails.owner, password: passwords.owner });
  await quietEmails(owner);

  // The school, with a free Professional plan that does not end and room for 40 students.
  const orgId = (await owner.post('/api/orgs', { name: t.school })).organization.id as string;
  await owner.patch(`/api/orgs/${orgId}`, { locale: opts.lang, timeZone: 'Africa/Cairo', country: 'EG' });
  await withSystemContext(db, async (trx) => {
    const sub = await trx.selectFrom('subscriptions').select(['id', 'plan_id', 'status']).where('org_id', '=', orgId).executeTakeFirstOrThrow();
    const overrides = { max_students: 40 };
    await trx.updateTable('subscriptions')
      .set({ plan_id: 'professional', status: 'active', current_period_end: null, current_period_start: null, grace_until: null, limit_overrides: JSON.stringify(overrides) })
      .where('id', '=', sub.id).execute();
    await recordAudit(trx, { type: 'system', email: 'demo-school command' }, {
      orgId, action: 'admin.subscription_changed', targetType: 'subscription', targetId: sub.id,
      metadata: { before: { planId: sub.plan_id, status: sub.status }, change: { planId: 'professional', status: 'active', currentPeriodEnd: null, limitOverrides: overrides } },
    });
  });

  // Two teachers, invited by the owner and accepting like anyone else.
  const teachers: Record<'arabic' | 'maths', { client: Client; userId: string }> = {} as never;
  for (const [key, role] of [['arabic', 'editor'], ['maths', 'viewer']] as const) {
    await owner.post(`/api/orgs/${orgId}/invitations`, { email: emails[key], role });
    const token = await emailToken(db, emails[key], 'invitation');
    const client = new Client(app, key);
    const me = await client.signIn('/api/auth/login', { email: emails[key], password: passwords[key] });
    await client.post('/api/invitations/accept', { token });
    await quietEmails(client);
    teachers[key] = { client, userId: me.user.id as string };
  }

  // The content scope: every ministry book of Primary 4.
  const version = ((await owner.get('/api/catalog/versions')).versions as Json[]).find((v) => v.status === 'published');
  if (!version) throw new Error('No published catalogue version on this installation');
  const tree = await owner.get(`/api/catalog/versions/${version.id}`);
  const subjects = (tree.subjects as Json[]).filter((s) => s.grade === 4 && s.track === 'moe');
  const subject = (code: string) => {
    const s = subjects.find((x) => x.code === code);
    if (!s?.materials?.length) throw new Error(`The catalogue has no Primary 4 "${code}" books`);
    return s;
  };
  const [arabic, maths, science, english] = [subject('ar'), subject('ma'), subject('sc'), subject('en')];
  const scopeId = (await owner.post(`/api/orgs/${orgId}/scopes`, { name: t.scope, description: t.scopeDescription, catalogVersionId: version.id })).scope.id as string;
  await owner.post(`/api/orgs/${orgId}/scopes/${scopeId}/items`, { add: subjects.flatMap((s) => (s.materials as Json[]).map((m) => m.id)) });
  const note = (s: Json, body: Json) => owner.patch(`/api/orgs/${orgId}/scopes/${scopeId}/items/${s.materials[0].id}`, body);
  await note(arabic, { note: t.notes.ar, assigneeId: teachers.arabic.userId, status: 'in_progress', dueOn: date(10) });
  await note(maths, { note: t.notes.ma, assigneeId: teachers.maths.userId, status: 'todo', dueOn: date(-3) });
  await note(science, { note: t.notes.sc, assigneeId: teachers.maths.userId, status: 'todo', dueOn: date(1) });
  await note(english, { note: t.notes.en, assigneeId: teachers.arabic.userId, status: 'done' });

  // Students and classes: eight in the first class, four in the second.
  const students: (DemoStudent & { userId: string; client?: Client })[] = [];
  for (const [i, username] of USERNAMES.entries()) {
    const res = await owner.post(`/api/orgs/${orgId}/students`, { username, name: t.students[i], grade: 4, scopeId });
    students.push({ name: t.students[i]!, username, password: res.password, userId: res.student.userId, className: t.classes[i < 8 ? 0 : 1] });
  }
  const schoolCode = (await owner.get(`/api/orgs/${orgId}/students`)).schoolCode as string;
  const classIds: string[] = [];
  for (const [i, name] of t.classes.entries()) {
    const classId = (await owner.post(`/api/orgs/${orgId}/classes`, { name, grade: 4, scopeId })).class.id as string;
    await owner.put(`/api/orgs/${orgId}/classes/${classId}/students`, { studentIds: students.filter((s) => s.className === name).map((s) => s.userId) });
    await owner.post(`/api/orgs/${orgId}/classes/${classId}/teachers`, { userId: teachers.arabic.userId, subjectEn: arabic.nameEn, subjectAr: arabic.nameAr });
    await owner.post(`/api/orgs/${orgId}/classes/${classId}/teachers`, { userId: teachers.maths.userId, subjectEn: maths.nameEn, subjectAr: maths.nameAr });
    if (i === 0) await owner.post(`/api/orgs/${orgId}/classes/${classId}/teachers`, { userId: teachers.maths.userId, subjectEn: science.nameEn, subjectAr: science.nameAr });
    classIds.push(classId);
  }
  const classA = classIds[0]!;
  const studentClient = async (s: (typeof students)[number]) => {
    if (!s.client) {
      s.client = new Client(app, s.username);
      await s.client.signIn('/api/auth/student-login', { school: schoolCode, username: s.username, password: s.password });
    }
    return s.client;
  };
  const subjectOf = (s: Json) => ({ subjectEn: s.nameEn, subjectAr: s.nameAr });

  // Homework: Arabic marked and returned (one still to mark, two not handed in), maths handed in, science still open.
  const hw1 = (await teachers.arabic.client.post(`/api/orgs/${orgId}/classes/${classA}/homework`, {
    ...subjectOf(arabic), ...t.hw1, materialIds: [arabic.materials[0].id], dueAt: inDays(1, 20).toISOString(), maxPoints: 10,
  })).homework.id as string;
  for (const [i, answer] of t.hw1Answers.entries()) await (await studentClient(students[i]!)).post(`/api/student/homework/${hw1}/hand-in`, { body: answer });
  for (const [i, [points, feedback]] of t.hw1Marks.entries()) {
    await teachers.arabic.client.patch(`/api/orgs/${orgId}/homework/${hw1}/submissions/${students[i]!.userId}`, { points, feedback, return: true });
  }
  const hw2 = (await teachers.maths.client.post(`/api/orgs/${orgId}/classes/${classA}/homework`, {
    ...subjectOf(maths), ...t.hw2, materialIds: [maths.materials[0].id], dueAt: inDays(3, 20).toISOString(), maxPoints: 20,
  })).homework.id as string;
  for (const [i, answer] of t.hw2Answers.entries()) await (await studentClient(students[i]!)).post(`/api/student/homework/${hw2}/hand-in`, { body: answer });
  await teachers.maths.client.post(`/api/orgs/${orgId}/classes/${classA}/homework`, {
    ...subjectOf(science), ...t.hw3, materialIds: [science.materials[0].id], dueAt: inDays(7, 20).toISOString(), maxPoints: 10,
  });

  // A maths quiz, open for a week: six students took it, the teacher marked the essays and released the results.
  const quiz = (await teachers.maths.client.post(`/api/orgs/${orgId}/classes/${classA}/tests`, {
    ...subjectOf(maths), ...t.quiz, kind: 'quiz', opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: inDays(7, 20).toISOString(),
    durationMinutes: 20, results: 'manual', showAnswers: true,
  })).test.id as string;
  const quizQuestions: string[] = [];
  for (const q of t.quizQuestions) quizQuestions.push((await teachers.maths.client.post(`/api/orgs/${orgId}/tests/${quiz}/questions`, q)).question.id);
  await teachers.maths.client.post(`/api/orgs/${orgId}/tests/${quiz}/publish`);
  for (const [i, answers] of QUIZ_ANSWERS.entries()) {
    const c = await studentClient(students[i]!);
    const attemptId = (await c.post(`/api/student/tests/${quiz}/start`, {})).attemptId as string;
    for (const [j, answer] of [...answers, t.essays[i]![0]].entries()) await c.put(`/api/student/attempts/${attemptId}/answers/${quizQuestions[j]}`, { answer });
    await c.post(`/api/student/attempts/${attemptId}/submit`);
    const [, points, feedback] = t.essays[i]!;
    await teachers.maths.client.patch(`/api/orgs/${orgId}/tests/${quiz}/attempts/${attemptId}/answers/${quizQuestions[4]}`, { points, feedback });
  }
  await teachers.maths.client.post(`/api/orgs/${orgId}/tests/${quiz}/release`);

  // An Arabic exam in two days, with a start code given in class.
  const exam = (await teachers.arabic.client.post(`/api/orgs/${orgId}/classes/${classA}/tests`, {
    ...subjectOf(arabic), ...t.exam, kind: 'exam', opensAt: inDays(2, 9).toISOString(), closesAt: inDays(2, 10).toISOString(),
    durationMinutes: 45, requireCode: true, results: 'after_close',
  })).test.id as string;
  for (const q of t.examQuestions) await teachers.arabic.client.post(`/api/orgs/${orgId}/tests/${exam}/questions`, q);
  await teachers.arabic.client.post(`/api/orgs/${orgId}/tests/${exam}/publish`);

  // Teaching plans: a lesson plan and a term's pacing plan.
  const plans = `/api/orgs/${orgId}/scopes/${scopeId}/plans`;
  await teachers.arabic.client.post(plans, { kind: 'lesson', grade: 4, subjectEn: arabic.nameEn, language: opts.lang, ...t.lesson });
  await teachers.maths.client.post(plans, {
    kind: 'pacing', grade: 4, subjectEn: maths.nameEn, language: opts.lang, title: t.pacing.title,
    content: { startDate: date(-14), periodsPerWeek: 5, weeks: t.pacing.weeks },
  });

  return {
    orgId,
    schoolName: t.school,
    schoolCode,
    staff: [
      { role: 'owner', name: t.owner, email: emails.owner, password: passwords.owner },
      { role: 'teacher (Arabic, editor)', name: t.arabic, email: emails.arabic, password: passwords.arabic },
      { role: 'teacher (Mathematics and Science, viewer)', name: t.maths, email: emails.maths, password: passwords.maths },
    ],
    students: students.map(({ name, username, password, className }) => ({ name, username, password, className })),
  };
}

// ---------------------------------------------------------------- remove
export async function removeDemoSchool(app: FastifyInstance, db: Database, opts: { email: string }): Promise<{ schools: string[]; accounts: string[] }> {
  const emails = Object.values(TAGS).map((tag) => taggedEmail(opts.email, tag));
  const users = (await db.selectFrom('users').select(['id', 'email']).where('email', 'in', emails).execute()).flatMap((u) => (u.email ? [{ id: u.id, email: u.email }] : []));
  if (!users.length) throw new Error(`No demo school found for ${opts.email}`);
  // The demo accounts get new random passwords so this command can sign in as them and use the
  // application's own deletion (organization, its students and files, then each account).
  const signIn = async (u: { id: string; email: string }) => {
    const password = newPassword();
    await db.updateTable('users').set({ password_hash: await hashPassword(password) }).where('id', '=', u.id).execute();
    const client = new Client(app, u.email);
    const me = await client.signIn('/api/auth/login', { email: u.email, password });
    return { client, me, password };
  };
  const schools: string[] = [];
  const owner = users.find((u) => u.email === taggedEmail(opts.email, TAGS.owner));
  if (owner) {
    const { client, me, password } = await signIn(owner);
    for (const org of me.organizations as Json[]) {
      if (org.role !== 'owner') continue;
      await client.del(`/api/orgs/${org.id}`, { password, confirmName: org.name });
      schools.push(org.name);
    }
  }
  const accounts: string[] = [];
  for (const u of users) {
    const { client, password } = await signIn(u);
    await client.del('/api/auth/account', { password });
    accounts.push(u.email);
  }
  return { schools, accounts };
}

// ---------------------------------------------------------------- command line
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  if (!email || !/^[^@\s+]+(\+[^@\s]*)?@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Pass --email <your address>: the demo staff accounts use it with a "+midad-demo-…" tag');
  const lang = (arg('lang') ?? 'ar') as Lang;
  if (lang !== 'ar' && lang !== 'en') throw new Error('--lang must be ar or en');
  const config = loadConfig();
  const db = createAppDatabase(config, 2);
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  try {
    if (process.argv.includes('--remove')) {
      const removed = await removeDemoSchool(app, db, { email });
      console.log(`Removed the demo school${removed.schools.length === 1 ? '' : 's'} ${removed.schools.map((s) => `"${s}"`).join(', ') || '(none)'} and the accounts ${removed.accounts.join(', ')}.`);
      return;
    }
    const r = await createDemoSchool(app, db, { email, lang });
    const lines = [
      `Demo school created: ${r.schoolName}`,
      `Sign in at ${config.APP_URL}/login (staff) and ${config.APP_URL}/student-login (students, school code ${r.schoolCode}).`,
      '',
      'Staff (emails reach your inbox; passwords shown only now):',
      ...r.staff.map((s) => `  ${s.role.padEnd(42)} ${s.email.padEnd(44)} ${s.password}`),
      '',
      `Students (school code ${r.schoolCode}):`,
      ...r.students.map((s) => `  ${s.className.padEnd(10)} ${s.username.padEnd(15)} ${s.password}  ${s.name}`),
      '',
      'Invented people only. To delete everything: node dist/cli/demo-school.js --email <the same address> --remove',
    ];
    console.log(lines.join('\n'));
  } finally {
    await app.close();
    await db.destroy();
  }
}

if (process.argv[1] && /demo-school\.(js|ts)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
