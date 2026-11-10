import { recordPlatformAudit } from '../audit/audit.js';
import { loadConfig } from '../config.js';
import { createAppDatabase } from '../db/index.js';
import { createMailer } from '../notifications/mailer.js';
import { buildReport, collectActivity, parseHostFacts, type Activity, type Lang } from '../ops/report.js';

// Usage (in the app container; ops/report.sh runs it with what it measured on the host on stdin):
//   node dist/cli/ops-report.js [--to a@example.com,b@example.com] [--hours 24] [--lang ar|en] [--time-zone Africa/Cairo]
// Prints the report and, with --to, emails it through the app's SMTP settings. docs/DEPLOYMENT_GUIDE.md §8.11.

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const lang = (option('lang') ?? 'ar') as Lang;
  if (lang !== 'ar' && lang !== 'en') throw new Error('--lang must be ar or en');
  const hours = Number(option('hours') ?? 24);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 31) throw new Error('--hours must be a whole number from 1 to 744');
  const timeZone = option('time-zone') ?? 'Africa/Cairo';
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error(`unknown time zone ${timeZone}`); }
  const to = (option('to') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const a of to) if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(a)) throw new Error(`not an email address: ${a}`);

  const facts = parseHostFacts(await readStdin());
  const config = loadConfig();
  facts.site ??= config.APP_URL;
  const now = new Date();
  const db = createAppDatabase(config, 2);
  try {
    let activity: Activity | null = null;
    let activityError: string | undefined;
    try {
      activity = await collectActivity(db, new Date(now.getTime() - hours * 3600_000));
    } catch (err) {
      activityError = `database: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
    }
    const report = buildReport({ facts, activity, activityError, hours, lang, now, timeZone });
    console.log(`Subject: ${report.subject}\n\n${report.text}`);
    if (!to.length) return;
    const mailer = createMailer(config, { info: () => undefined });
    if (!mailer) throw new Error('EMAIL_TRANSPORT is none: no email can be sent (the report is above)');
    await mailer.send({ to: to.join(', '), subject: report.subject, text: report.text });
    console.log(`\nEmailed to ${to.join(', ')}.`);
    await recordPlatformAudit(db, { type: 'system', email: 'cli' }, {
      action: 'ops.report_sent',
      metadata: { recipients: to.length, problems: report.problems.length, hours, lang },
    }).catch(() => undefined);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
