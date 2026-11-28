import type { MeetingStatus, MinutesStatus, Role, Verification } from './types';

export const MINUTES_STATUS: Record<MinutesStatus, string> = {
  draft_requires_review: 'مسودة تتطلب المراجعة',
  draft: 'مسودة',
  reviewed: 'تمت مراجعته',
  approved: 'معتمد',
};

export const MEETING_STATUS: Record<MeetingStatus, string> = {
  uploaded: 'بانتظار المعالجة',
  processing: 'قيد المعالجة',
  review: 'جاهز للمراجعة',
  failed: 'تعذرت المعالجة',
  awaiting_authorization: 'بانتظار إذن المعالجة',
};

export const CLASSIFICATION: Record<string, string> = { public: 'عام', internal: 'داخلي', confidential: 'سري', secret: 'سري للغاية' };
export const ROLE: Record<Role, string> = { viewer: 'اطلاع فقط', editor: 'محرر ومراجع', approver: 'معتمِد', admin: 'مدير النظام' };

export const VERIFICATION: Record<Verification['status'], string> = {
  verified: 'تم التحقق',
  verified_rules_only: 'تحقق بالقواعد فقط',
  partially_supported: 'مدعوم جزئياً',
  needs_review: 'يتطلب المراجعة',
  unsupported: 'غير مدعوم',
  contradicted: 'متعارض مع التسجيل',
};

export const SEVERITY: Record<string, string> = { critical: 'حرج', major: 'مهم', minor: 'ثانوي', info: 'معلومة' };

export const FLAGS: Record<string, string> = {
  low_confidence: 'ثقة تعرف منخفضة',
  possible_hallucination: 'يُرجَّح أنه نص مُختلَق',
  repetition: 'تكرار مريب',
  overlap: 'تداخل أصوات',
  uncertain_speaker: 'المتحدث غير مؤكد',
  uncertain_term: 'مصطلح غير مؤكد',
  inaudible: 'غير مسموع',
  edited: 'عُدِّل يدوياً',
  short_turn: 'مداخلة قصيرة',
  no_speech: 'بلا كلام',
};

export const STAGES: [string, string][] = [
  ['intake', 'استلام التسجيل وفحص الجودة'],
  ['transcribe', 'تفريغ الكلام'],
  ['diarize', 'تمييز المتحدثين'],
  ['align', 'نسبة الكلام إلى المتحدثين'],
  ['readable', 'إعداد النسخة المقروءة'],
  ['analyse', 'التحليل الدلالي'],
  ['verify', 'التحقق من الأدلة'],
  ['write', 'صياغة المحضر'],
  ['review_language', 'المراجعة اللغوية'],
  ['render', 'إنشاء المستندات'],
];

export const DOCUMENTS: [string, string][] = [
  ['minutes_docx', 'المحضر الرسمي (Word)'],
  ['minutes_pdf', 'المحضر الرسمي (PDF)'],
  ['summary_pdf', 'الملخص التنفيذي (PDF)'],
  ['actions_csv', 'جدول التكليفات (CSV)'],
  ['transcript_pdf', 'النص الكامل بالتوقيتات (PDF)'],
  ['transcript_txt', 'النص الحرفي (TXT)'],
  ['evidence_pdf', 'تقرير الأدلة وعدم اليقين (PDF)'],
  ['export_json', 'البيانات المهيكلة (JSON)'],
];

export const ITEM_GROUPS: { key: string; title: string; types: string[] }[] = [
  { key: 'decisions', title: 'القرارات', types: ['decision_approved', 'decision_rejected', 'agreement_tentative'] },
  { key: 'actions', title: 'التكليفات والإجراءات', types: ['action_assigned', 'action_suggested'] },
  { key: 'proposals', title: 'المقترحات والتوصيات', types: ['proposal', 'recommendation'] },
  { key: 'risks', title: 'المخاطر والتحفظات', types: ['risk', 'blocker', 'dependency', 'concern', 'objection'] },
  { key: 'pending', title: 'المعلق والمتعارض', types: ['open_question', 'deferred', 'contradiction'] },
  { key: 'discussion', title: 'النقاش', types: ['discussion', 'question', 'answer'] },
];

export function fmtTime(t: number): string {
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.round(seconds / 60);
  return m < 1 ? `${Math.round(seconds)} ثانية` : `${m} دقيقة`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}
