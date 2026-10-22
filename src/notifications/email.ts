import type { Executor } from '../db/index.js';
import type { Locale } from '../db/types.js';

type Params = Record<string, string>;
type Template = (p: Params) => { subject: string; text: string };

const SIGN_EN = '\n\n— Curriculum Scope';
const SIGN_AR = '\n\n— منصة نطاق المناهج';

// Plain-text bodies only: no HTML rendering, so no template-injection surface.
const TEMPLATES: Record<string, Record<Locale, Template>> = {
  verify_email: {
    en: (p) => ({ subject: 'Confirm your email address', text: `Hello ${p.name},\n\nConfirm your email address to activate your account:\n${p.link}\n\nThe link expires in 48 hours. If you did not sign up, ignore this message.${SIGN_EN}` }),
    ar: (p) => ({ subject: 'تأكيد البريد الإلكتروني', text: `مرحبًا ${p.name}،\n\nيرجى تأكيد بريدك الإلكتروني لتفعيل حسابك:\n${p.link}\n\nتنتهي صلاحية الرابط خلال 48 ساعة. إذا لم تقم بالتسجيل فتجاهل هذه الرسالة.${SIGN_AR}` }),
  },
  account_exists: {
    en: (p) => ({ subject: 'Sign-up attempt for your account', text: `Someone tried to create an account with this email address, which is already registered.\n\nSign in: ${p.loginLink}\nForgot your password? ${p.resetLink}\n\nIf this was not you, no action is needed.${SIGN_EN}` }),
    ar: (p) => ({ subject: 'محاولة تسجيل بحسابك', text: `حاول شخص إنشاء حساب بهذا البريد الإلكتروني المسجل بالفعل.\n\nتسجيل الدخول: ${p.loginLink}\nنسيت كلمة المرور؟ ${p.resetLink}\n\nإذا لم تكن أنت فلا حاجة لأي إجراء.${SIGN_AR}` }),
  },
  reset_password: {
    en: (p) => ({ subject: 'Reset your password', text: `Hello ${p.name},\n\nUse this link to choose a new password:\n${p.link}\n\nThe link expires in 1 hour and can be used once. If you did not request it, ignore this message.${SIGN_EN}` }),
    ar: (p) => ({ subject: 'إعادة تعيين كلمة المرور', text: `مرحبًا ${p.name}،\n\nاستخدم هذا الرابط لاختيار كلمة مرور جديدة:\n${p.link}\n\nتنتهي صلاحية الرابط خلال ساعة ويُستخدم مرة واحدة.${SIGN_AR}` }),
  },
  password_changed: {
    en: (p) => ({ subject: 'Your password was changed', text: `Hello ${p.name},\n\nThe password for your account was just changed and other sessions were signed out. If this was not you, reset your password immediately: ${p.resetLink}${SIGN_EN}` }),
    ar: (p) => ({ subject: 'تم تغيير كلمة المرور', text: `مرحبًا ${p.name}،\n\nتم تغيير كلمة مرور حسابك وتسجيل الخروج من الجلسات الأخرى. إذا لم تكن أنت فأعد تعيينها فورًا: ${p.resetLink}${SIGN_AR}` }),
  },
  invitation: {
    en: (p) => ({ subject: `You are invited to ${p.orgName}`, text: `${p.inviterName} invited you to join ${p.orgName} as ${p.role}.\n\nAccept the invitation:\n${p.link}\n\nThe invitation expires in 7 days.${SIGN_EN}` }),
    ar: (p) => ({ subject: `دعوة للانضمام إلى ${p.orgName}`, text: `دعاك ${p.inviterName} للانضمام إلى ${p.orgName} بدور ${p.role}.\n\nلقبول الدعوة:\n${p.link}\n\nتنتهي صلاحية الدعوة خلال 7 أيام.${SIGN_AR}` }),
  },
  ownership_transferred: {
    en: (p) => ({ subject: `You now own ${p.orgName}`, text: `Ownership of ${p.orgName} was transferred to you by ${p.fromName}. You are now responsible for billing and organization settings.${SIGN_EN}` }),
    ar: (p) => ({ subject: `أصبحت مالك ${p.orgName}`, text: `نقل ${p.fromName} ملكية ${p.orgName} إليك. أصبحت مسؤولًا عن الفوترة وإعدادات المؤسسة.${SIGN_AR}` }),
  },
  trial_ending: {
    en: (p) => ({ subject: `Your trial for ${p.orgName} ends in ${p.days} days`, text: `The free trial for ${p.orgName} ends on ${p.date}. Choose a plan to keep your limits; otherwise the organization moves to the Free plan. Your data is kept.\n\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `تنتهي الفترة التجريبية لـ ${p.orgName} خلال ${p.days} أيام`, text: `تنتهي الفترة التجريبية لـ ${p.orgName} في ${p.date}. اختر خطة للاحتفاظ بالحدود الحالية، وإلا ستنتقل المؤسسة إلى الخطة المجانية مع الاحتفاظ ببياناتك.\n\n${p.link}${SIGN_AR}` }),
  },
  trial_expired: {
    en: (p) => ({ subject: `${p.orgName} moved to the Free plan`, text: `The trial for ${p.orgName} has ended and the organization is now on the Free plan. Nothing was deleted; items over the Free limits are read-only until you upgrade.\n\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `انتقلت ${p.orgName} إلى الخطة المجانية`, text: `انتهت الفترة التجريبية لـ ${p.orgName} وانتقلت إلى الخطة المجانية. لم يُحذف شيء، والعناصر التي تتجاوز الحدود تصبح للقراءة فقط حتى الترقية.\n\n${p.link}${SIGN_AR}` }),
  },
  renewal_due: {
    en: (p) => ({ subject: `Invoice ${p.invoiceNumber} for ${p.orgName}`, text: `Your ${p.planName} subscription renews on ${p.date}. Invoice ${p.invoiceNumber} for ${p.amount} is ready to pay:\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `فاتورة ${p.invoiceNumber} لـ ${p.orgName}`, text: `يتجدد اشتراك ${p.planName} في ${p.date}. الفاتورة ${p.invoiceNumber} بقيمة ${p.amount} جاهزة للدفع:\n${p.link}${SIGN_AR}` }),
  },
  payment_succeeded: {
    en: (p) => ({ subject: `Payment received — ${p.invoiceNumber}`, text: `We received ${p.amount} for invoice ${p.invoiceNumber} (${p.orgName}). Thank you.${SIGN_EN}` }),
    ar: (p) => ({ subject: `تم استلام الدفع — ${p.invoiceNumber}`, text: `استلمنا ${p.amount} للفاتورة ${p.invoiceNumber} (${p.orgName}). شكرًا لك.${SIGN_AR}` }),
  },
  payment_failed: {
    en: (p) => ({ subject: `Payment failed — ${p.invoiceNumber}`, text: `A payment of ${p.amount} for invoice ${p.invoiceNumber} (${p.orgName}) failed. Please try again:\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `فشل الدفع — ${p.invoiceNumber}`, text: `فشلت عملية دفع ${p.amount} للفاتورة ${p.invoiceNumber} (${p.orgName}). يرجى المحاولة مرة أخرى:\n${p.link}${SIGN_AR}` }),
  },
  past_due: {
    en: (p) => ({ subject: `Action needed: ${p.orgName} subscription is past due`, text: `Invoice ${p.invoiceNumber} is unpaid. Your plan stays active until ${p.date}; after that the organization moves to the Free plan.\n\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `مطلوب إجراء: اشتراك ${p.orgName} متأخر السداد`, text: `الفاتورة ${p.invoiceNumber} غير مدفوعة. تظل خطتك فعالة حتى ${p.date}، وبعدها تنتقل المؤسسة إلى الخطة المجانية.\n\n${p.link}${SIGN_AR}` }),
  },
  subscription_ended: {
    en: (p) => ({ subject: `${p.orgName} moved to the Free plan`, text: `The ${p.planName} subscription for ${p.orgName} ended (${p.reason}). Your data is kept; items over the Free limits are read-only until you subscribe again.\n\n${p.link}${SIGN_EN}` }),
    ar: (p) => ({ subject: `انتقلت ${p.orgName} إلى الخطة المجانية`, text: `انتهى اشتراك ${p.planName} لـ ${p.orgName} (${p.reason}). بياناتك محفوظة، والعناصر التي تتجاوز الحدود تصبح للقراءة فقط حتى تشترك مجددًا.\n\n${p.link}${SIGN_AR}` }),
  },
};

export type EmailTemplate = keyof typeof TEMPLATES;

export function renderEmail(template: string, locale: Locale, params: Params): { subject: string; text: string } {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`Unknown email template ${template}`);
  return t[locale](params);
}

/**
 * Queues an email in the transactional outbox. It is sent by the worker only
 * if the surrounding transaction commits, so no email goes out for a failed operation.
 */
export async function enqueueEmail(
  exec: Executor,
  to: string,
  template: EmailTemplate,
  locale: Locale,
  params: Params,
): Promise<void> {
  const { subject, text } = renderEmail(template, locale, params);
  await exec.insertInto('email_outbox').values({ to_email: to, template, subject, text_body: text }).execute();
}

export async function notify(
  exec: Executor,
  n: { userId: string; orgId?: string | null; kind: string; title: string; body: string; link?: string | null },
): Promise<void> {
  await exec
    .insertInto('notifications')
    .values({ user_id: n.userId, org_id: n.orgId ?? null, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null })
    .execute();
}
