import type { Executor } from '../db/index.js';
import type { Locale } from '../db/types.js';

type Params = Record<string, string>;
type Template = (p: Params) => { subject: string; text: string };

const SIGN_EN = '\n\n— Midad';
const SIGN_AR = '\n\n— منصة مِداد';
/** Role names as the Arabic interface shows them (the English email keeps the role's own name). */
const ROLE_AR: Record<string, string> = { owner: 'المالك', admin: 'مسؤول', editor: 'محرر', viewer: 'مشاهد' };

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
    ar: (p) => ({ subject: `دعوة للانضمام إلى ${p.orgName}`, text: `دعاك ${p.inviterName} للانضمام إلى ${p.orgName} بدور ${ROLE_AR[p.role!] ?? p.role}.\n\nلقبول الدعوة:\n${p.link}\n\nتنتهي صلاحية الدعوة خلال 7 أيام.${SIGN_AR}` }),
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
  catalog_published: {
    en: (p) => ({ subject: `The ${p.year} curriculum catalogue is published`, text: `The ${p.year} catalogue (${p.label}) is now available in Midad. These content scopes of ${p.orgName} still use an older catalogue:\n${p.scopes}\n\nReview what changed for each scope (missing books, new editions, subject changes) and carry it forward:\n${p.link}\n\nYou receive this because you can edit scopes in ${p.orgName}. Turn these emails off in your account settings: ${p.settingsLink}${SIGN_EN}` }),
    ar: (p) => ({ subject: `نُشر دليل المناهج لعام ${p.year}`, text: `أصبح دليل عام ${p.year} (${p.label}) متاحًا في منصة مِداد. ما زالت نطاقات المحتوى التالية في ${p.orgName} تستخدم دليلًا أقدم:\n${p.scopes}\n\nراجع التغييرات لكل نطاق (كتب غير موجودة، طبعات جديدة، تغييرات في المواد) وانقله إلى الدليل الجديد:\n${p.link}\n\nتصلك هذه الرسالة لأنك تستطيع تعديل النطاقات في ${p.orgName}. يمكنك إيقاف هذه الرسائل من إعدادات حسابك: ${p.settingsLink}${SIGN_AR}` }),
  },
  items_assigned: {
    en: (p) => ({ subject: `${p.by} assigned you ${p.count} ${p.count === '1' ? 'book' : 'books'} in “${p.scope}”`, text: `${p.by} assigned you ${p.count === '1' ? 'a book' : `${p.count} books`} to follow up in the scope “${p.scope}” (${p.orgName}):\n${p.items}\n\nSee your books, their notes and due dates:\n${p.link}\n\nYou receive this because books were assigned to you. Turn these emails off in your account settings: ${p.settingsLink}${SIGN_EN}` }),
    ar: (p) => ({ subject: `أسند إليك ${p.by} ${p.count === '1' ? 'كتابًا' : 'كتبًا'} في «${p.scope}» (${p.count})`, text: `أسند إليك ${p.by} ${p.count === '1' ? 'كتابًا' : 'كتبًا'} للمتابعة في النطاق «${p.scope}» (${p.orgName}):\n${p.items}\n\nاطّلع على كتبك وملاحظاتها ومواعيدها:\n${p.link}\n\nتصلك هذه الرسالة لأن كتبًا أُسندت إليك. يمكنك إيقاف هذه الرسائل من إعدادات حسابك: ${p.settingsLink}${SIGN_AR}` }),
  },
  items_assigned_daily: {
    en: (p) => ({
      subject: `Your daily summary: ${p.count} ${p.count === '1' ? 'book' : 'books'} assigned to you`,
      text: `Hello ${p.name},\n\nBooks assigned to you since your last summary:\n\n${p.sections}\n\nYou receive one summary a day instead of an email for each assignment, as chosen in your account settings, where you can change it: ${p.settingsLink}${SIGN_EN}`,
    }),
    ar: (p) => ({
      subject: `ملخصك اليومي: كتب أُسندت إليك (${p.count})`,
      text: `مرحبًا ${p.name}،\n\nالكتب التي أُسندت إليك منذ آخر ملخص:\n\n${p.sections}\n\nيصلك ملخص واحد يوميًا بدلًا من رسالة لكل إسناد، كما اخترت في إعدادات حسابك، ويمكنك تغيير ذلك من هناك: ${p.settingsLink}${SIGN_AR}`,
    }),
  },
  items_due: {
    en: (p) => ({
      subject:
        p.overdue !== '0' && p.soon !== '0'
          ? `Reminder: ${p.overdue} overdue and ${p.soon} due soon in ${p.orgName}`
          : p.overdue !== '0'
            ? `Reminder: ${p.overdue} ${p.overdue === '1' ? 'book is' : 'books are'} overdue in ${p.orgName}`
            : `Reminder: ${p.soon} ${p.soon === '1' ? 'book is' : 'books are'} due soon in ${p.orgName}`,
      text: `Hello ${p.name},\n\nThese books assigned to you in ${p.orgName} need attention:\n\n${p.sections}\n\nUpdate their status or see all your books:\n${p.link}\n\nYou receive this because books with a due date are assigned to you. Each book is reminded once when it is due soon and once when it is overdue. Turn these emails off in your account settings: ${p.settingsLink}${SIGN_EN}`,
    }),
    ar: (p) => ({
      subject:
        p.overdue !== '0' && p.soon !== '0'
          ? `تذكير: كتب متأخرة (${p.overdue}) وكتب يحين موعدها قريبًا (${p.soon}) في ${p.orgName}`
          : p.overdue !== '0'
            ? `تذكير: كتب متأخرة عن موعدها (${p.overdue}) في ${p.orgName}`
            : `تذكير: كتب يحين موعدها قريبًا (${p.soon}) في ${p.orgName}`,
      text: `مرحبًا ${p.name}،\n\nتحتاج هذه الكتب المسندة إليك في ${p.orgName} إلى متابعة:\n\n${p.sections}\n\nحدّث حالتها أو اطّلع على كل كتبك:\n${p.link}\n\nتصلك هذه الرسالة لأن كتبًا لها مواعيد أُسندت إليك. يصلك تذكير واحد لكل كتاب عند اقتراب موعده وآخر عند تأخره. يمكنك إيقاف هذه الرسائل من إعدادات حسابك: ${p.settingsLink}${SIGN_AR}`,
    }),
  },
  classroom_retention: {
    en: (p) => ({
      subject: `Classroom data in ${p.orgName} will be deleted from ${p.date}`,
      text: `Hello ${p.name},\n\nUnder the retention periods set for ${p.orgName}, this classroom data will be deleted on or after the date shown:\n\n${p.items}\n\nBefore then you can download the gradebooks you need, keep an item longer, or change the periods:\n${p.link}\n\nYou receive this because you are an owner or admin of ${p.orgName}.${SIGN_EN}`,
    }),
    ar: (p) => ({
      subject: `ستُحذف بيانات من الفصول في ${p.orgName} بدءًا من ${p.date}`,
      text: `مرحبًا ${p.name}،\n\nوفق مدد الاحتفاظ المحددة لـ ${p.orgName}، ستُحذف بيانات الفصول التالية في التاريخ المبيّن أو بعده:\n\n${p.items}\n\nقبل ذلك يمكنك تنزيل دفاتر الدرجات التي تحتاجها، أو الاحتفاظ بعنصر مدة أطول، أو تغيير المدد:\n${p.link}\n\nتصلك هذه الرسالة لأنك مالك أو مسؤول في ${p.orgName}.${SIGN_AR}`,
    }),
  },
  catalog_review: {
    en: (p) => ({ subject: `${p.count} ${p.count === '1' ? 'item' : 'items'} in your scopes ${p.count === '1' ? 'is' : 'are'} under review`, text: `Our curriculum team flagged ${p.count} catalogue items that ${p.orgName} has selected:\n${p.items}\n\nNote: ${p.note}\n\nAffected scopes:\n${p.scopes}\n\nOpen: ${p.link}\n\nTurn these emails off in your account settings: ${p.settingsLink}${SIGN_EN}` }),
    ar: (p) => ({ subject: `${p.count} من العناصر في نطاقاتك قيد المراجعة`, text: `أشار فريق المناهج إلى ${p.count} من عناصر الدليل التي اختارتها ${p.orgName}:\n${p.items}\n\nالملاحظة: ${p.note}\n\nالنطاقات المتأثرة:\n${p.scopes}\n\nفتح: ${p.link}\n\nيمكنك إيقاف هذه الرسائل من إعدادات حسابك: ${p.settingsLink}${SIGN_AR}` }),
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
