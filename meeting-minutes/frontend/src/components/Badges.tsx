import { MEETING_STATUS, MINUTES_STATUS, SEVERITY, VERIFICATION } from '../labels';
import type { MeetingStatus, MinutesStatus, Verification } from '../types';

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const cls = status === 'review' ? 'ok' : status === 'failed' ? 'bad' : status === 'awaiting_authorization' ? 'warn' : 'info';
  return <span className={`badge ${cls}`}>{MEETING_STATUS[status]}</span>;
}

export function MinutesBadge({ status }: { status: MinutesStatus }) {
  const cls = status === 'approved' ? 'ok' : status === 'reviewed' ? 'info' : status === 'draft' ? 'plain' : 'bad';
  return <span className={`badge ${cls}`}>{MINUTES_STATUS[status]}</span>;
}

export function VerificationBadge({ status }: { status: Verification['status'] }) {
  const cls = status === 'verified' ? 'ok' : status === 'verified_rules_only' ? 'info'
    : status === 'partially_supported' ? 'warn' : 'bad';
  return <span className={`badge ${cls}`} title="حالة التحقق من الأدلة">{VERIFICATION[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'bad' : severity === 'major' ? 'warn' : 'plain';
  return <span className={`badge ${cls}`}>{SEVERITY[severity] ?? severity}</span>;
}
