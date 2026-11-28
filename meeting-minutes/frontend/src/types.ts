export type Role = 'viewer' | 'editor' | 'approver' | 'admin';
export interface Me { id: string; name: string; email: string; role: Role; org_id: string; org_name: string }

export type MinutesStatus = 'draft_requires_review' | 'draft' | 'reviewed' | 'approved';
export type MeetingStatus = 'uploaded' | 'processing' | 'review' | 'failed' | 'awaiting_authorization';

export interface StageEntry { stage: string; label_ar?: string; status?: string; message_ar?: string; at?: string }
export interface Job { status: string; stage: string | null; progress: number; stages: StageEntry[]; attempts: number; error: string | null }

export interface MeetingSummary {
  id: string; title: string; date: string | null; location: string | null; classification: string; status: MeetingStatus;
  stage: string | null; progress: number; minutes_status: MinutesStatus; critical_open: number; duration_seconds: number | null;
  error_code: string | null; created_at: string; approved_at: string | null; job: Job | null;
}

export interface Issue {
  code: string; severity: 'critical' | 'major' | 'minor' | 'info'; message_ar: string; start: number | null; end: number | null;
  item_id: string | null; segment_ids: string[]; key?: string; resolution?: { resolution: string; note: string; by_name: string } | null;
}

export interface Gate { gate: string; label_ar: string; value: number | string; threshold: number | string; passed: boolean }
export interface Quality { gates: Gate[]; all_passed: boolean; open_critical: number; open_major: number; items_by_status: Record<string, number> }

export interface MeetingDetail extends MeetingSummary {
  meta: Record<string, unknown>;
  audio_quality: AudioQuality | null;
  documents: { available: string[]; checks: Record<string, { ok: boolean; problems: string[] }>; quality: Quality; generated_at: string; minutes_version: number } | null;
  versions: { kind: string; version: number; created_at: string; created_by_agent: string | null; created_by_user: string | null; note: string | null }[];
}

export interface AudioQuality {
  duration_seconds: number; original_format: string; original_codec: string | null; original_sample_rate: number | null;
  loudness_lufs: number | null; clipping_ratio: number; speech_ratio: number; estimated_snr_db: number | null;
  long_silences: { start: number; end: number }[]; overlap_regions: { start: number; end: number }[]; chunks: { index: number; start: number; end: number }[];
  issues: Issue[]; overall: 'good' | 'fair' | 'poor';
}

export interface Segment {
  id: string; start: number; end: number; speaker_id: string | null; speaker_confidence: 'high' | 'medium' | 'low' | 'unknown';
  text_verbatim: string; text_readable: string; flags: string[]; uncertain_terms: string[]; excluded: boolean; readable_source: string;
}
export interface Speaker { id: string; label: string; display_name: string | null; title: string | null; confirmed: boolean; speaking_seconds: number }
export interface Evidence { segment_id: string; quote: string }
export interface NameHint { speaker_id: string; name: string; evidence: Evidence[] }
export interface TranscriptData {
  version: number; segments: Segment[]; speakers: Speaker[]; asr_provider: string; asr_model: string; diarization_provider: string;
  speaker_name_hints: NameHint[];
}

export interface Check { name: string; passed: boolean; severity: Issue['severity']; detail_ar: string }
export interface ResolvedEvidence {
  segment_id: string; speaker_id: string | null; speaker_confidence: string; start: number; end: number; original_text: string;
  quote: string; quote_found: boolean; match_score: number;
}
export interface Verification {
  item_id: string; status: 'verified' | 'verified_rules_only' | 'partially_supported' | 'needs_review' | 'unsupported' | 'contradicted';
  original_type: string; final_type: string; checks: Check[]; evidence: ResolvedEvidence[];
  llm: { verdict: string; classification_correct: boolean; suggested_type: string | null; rationale_ar: string; missing_qualifications: string[]; model: string } | null;
  issues: Issue[];
}
export interface ItemReview { decision: 'accepted' | 'rejected'; type: string | null; edits: Record<string, string>; note: string | null; by_name: string; at: string }
export interface Item {
  id: string; type: string; type_ar: string; topic_id: string | null; statement: string; speaker_ids: string[];
  owner: { name_as_spoken: string | null; speaker_id: string | null; status: string };
  due: { text_as_spoken: string | null; date_iso: string | null; status: string };
  qualifications: string[]; evidence: Evidence[]; approval_evidence: Evidence[]; requires_confirmation: boolean; confidence: string;
  notes: string | null; verification: Verification | null; final_type_ar: string | null; review: ItemReview | null;
}
export interface ItemsData {
  purpose: string | null; topics: { id: string; title: string; summary: string; segment_ids: string[] }[]; items: Item[];
  document_issues: Issue[]; coverage: Record<string, number>; llm_used: boolean; llm_model: string | null; analysis_model: string;
  types_ar: Record<string, string>; reviewed_by: string | null; reviewed_at: string | null;
}

export interface Block { id: string; kind: 'paragraph' | 'bullet'; text: string; item_ids: string[]; segment_ids: string[] }
export interface TableRow { id: string; cells: Record<string, string>; item_ids: string[] }
export interface Section { key: string; title: string; blocks: Block[]; table_columns: string[]; rows: TableRow[] }
export interface Minutes {
  version: number; title: string; status_label: string; classification_label: string; meeting_info: Record<string, string>;
  sections: Section[]; issues: Issue[]; language_review: { reviewer?: string; accepted?: unknown[]; refused?: unknown[]; notes?: unknown[] };
  generated_by: Record<string, string>;
}

export interface AuditEntry { id: number; at: string; actor_name: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown> | null }
export interface GlossaryTerm { id: string; term: string; variants: string[]; category: string; note: string | null }
export interface OrgSettings {
  privacy: { audio: string[]; transcript: string[]; max_classification_external: string };
  retention: { audio_days: number | null; transcript_days: number | null; documents_days: number | null };
  quality_gates: Record<string, number>;
  branding: { org_name_ar: string | null; footer_text: string | null; logo_blob_id: string | null };
}
export interface SystemInfo {
  asr_provider: string; whisper_model: string | null; diarization_provider: string; llm_provider: string; llm_model: string;
  allowed_external_providers: string[]; known_external_providers: string[]; max_upload_mb: number; max_duration_minutes: number;
}
export interface User { id: string; email: string; name: string; role: Role; active: boolean; last_login_at: string | null }
