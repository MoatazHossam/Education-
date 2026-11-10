import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { collectActivity } from '../../src/ops/report.js';
import { Client, createHarness, createStudent, enableStudents, resetData, signUp, type Harness } from '../helpers/harness.js';
import { TEST_ENV } from '../helpers/env.js';

// The daily operations report (docs/DEPLOYMENT_GUIDE.md §8.11): what it counts in the database across schools,
// and the command the server's script runs, emailing through a stand-in SMTP server.
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetData(h.ownerDb);
});
afterAll(async () => h.close());

/** A minimal SMTP server that keeps every message it is given. */
async function smtpSink(): Promise<{ port: number; messages: { to: string[]; data: string }[]; close: () => Promise<void> }> {
  const messages: { to: string[]; data: string }[] = [];
  const server: Server = createServer((socket) => {
    let buf = '';
    let inData = false;
    let to: string[] = [];
    let data = '';
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { messages.push({ to, data }); inData = false; to = []; data = ''; socket.write('250 queued\r\n'); } else data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 sink\r\n');
        else if (cmd === 'MAIL') socket.write('250 ok\r\n');
        else if (cmd === 'RCPT') { to.push(/<([^>]+)>/.exec(line)?.[1] ?? ''); socket.write('250 ok\r\n'); } else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); } else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); } else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { port, messages, close: () => new Promise((r) => server.close(() => r())) };
}

/** The text of a message as nodemailer encodes it (quoted-printable or base64). */
function bodyOf(raw: string): string {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  if (/Content-Transfer-Encoding: base64/i.test(head!)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(head!)) {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, x: string) => String.fromCharCode(parseInt(x, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

function runCli(args: string[], stdin: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/ops-report.ts', ...args], { env: { ...process.env, ...TEST_ENV, LOG_LEVEL: 'warn', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe('ops report', () => {
  it('counts what is new across schools, without anyone\'s data but the new school\'s name', async () => {
    const before = new Date(Date.now() - 60_000);
    const owner = await signUp(h, { org: 'مدرسة التقرير' });
    await enableStudents(h, owner.orgId);
    await createStudent(h, owner.client, owner.orgId, { username: 'report.student' });
    const failed = await new Client(h.app).post('/api/auth/login', { email: owner.email, password: 'not-the-password-at-all' });
    expect(failed.statusCode).toBe(401);
    const a = await collectActivity(h.db, before);
    expect(a.schools.newCount).toBe(1);
    expect(a.schools.new.map((s) => s.name)).toEqual(['مدرسة التقرير']);
    expect(a.staff.newCount).toBe(1);
    expect(a.students).toEqual({ total: 1, newCount: 1 });
    expect(a.signIns.ok).toBeGreaterThanOrEqual(1);
    expect(a.signIns.failed).toBe(1);
    expect(a.databaseBytes).toBeGreaterThan(0);
    // Nothing from before the window.
    expect((await collectActivity(h.db, new Date(Date.now() + 60_000))).schools.newCount).toBe(0);
  });

  it('the command prints the report, emails it and records that it did', async () => {
    const sink = await smtpSink();
    try {
      const facts = ['site=https://midad.example.com', 'service=app|running|healthy|0', 'ready=app|yes', 'disk=/|41%|60000000000',
        `backup_latest=midad-backup-prod-20261110T021500Z.tar.enc|${Math.floor(Date.now() / 1000) - 3600}|337977|ok`, 'verify_last_ok=none'].join('\n');
      const r = await runCli(['--to', 'owner@example.com,ops@example.com', '--lang', 'ar'], facts, { EMAIL_TRANSPORT: 'smtp', SMTP_URL: `smtp://127.0.0.1:${sink.port}` });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('Subject: تقرير مِداد اليومي — midad.example.com');
      expect(r.stdout).toContain('مدرسة جديدة: مدرسة التقرير');
      expect(r.stdout).toContain('Emailed to owner@example.com, ops@example.com.');
      expect(sink.messages).toHaveLength(1);
      expect(sink.messages[0]!.to.sort()).toEqual(['ops@example.com', 'owner@example.com']);
      const text = bodyOf(sink.messages[0]!.data);
      expect(text).toContain('آخر نسخة: midad-backup-prod-20261110T021500Z.tar.enc');
      expect(text).toContain('⚠️ لا يوجد اختبار استعادة ناجح في سجل النسخ');
      const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['metadata']).where('action', '=', 'ops.report_sent').execute());
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ recipients: 2, lang: 'ar', hours: 24 });
    } finally {
      await sink.close();
    }
  }, 60_000);

  it('refuses a bad address or language, and says when email is off', async () => {
    const bad = await runCli(['--to', 'not-an-address'], '', {});
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('not an email address: not-an-address');
    expect((await runCli(['--lang', 'fr'], '', {})).stderr).toContain('--lang must be ar or en');
    const off = await runCli(['--to', 'owner@example.com', '--lang', 'en'], 'site=https://midad.example.com', { EMAIL_TRANSPORT: 'none' });
    expect(off.code).toBe(1);
    expect(off.stdout).toContain('Subject: Midad daily report');
    expect(off.stderr).toContain('EMAIL_TRANSPORT is none');
  }, 60_000);
});
