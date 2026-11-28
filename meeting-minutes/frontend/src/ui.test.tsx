import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fmtDuration, fmtTime } from './labels';
import { MinutesBadge, VerificationBadge } from './components/Badges';
import ItemsTab from './components/ItemsTab';
import type { ItemsData, TranscriptData } from './types';

vi.mock('./App', () => ({ useSession: () => ({ me: null, setMe: () => {}, can: () => true }) }));
afterEach(cleanup);

describe('labels', () => {
  it('formats times and durations', () => {
    expect(fmtTime(67.6)).toBe('01:07');
    expect(fmtTime(3725)).toBe('1:02:05');
    expect(fmtDuration(135)).toBe('2 دقيقة');
    expect(fmtDuration(null)).toBe('—');
  });
});

describe('badges', () => {
  it('never shows an unreviewed draft as approved', () => {
    render(<MinutesBadge status="draft_requires_review" />);
    expect(screen.getByText('مسودة تتطلب المراجعة').className).toContain('bad');
  });
  it('labels verification statuses in Arabic', () => {
    render(<VerificationBadge status="unsupported" />);
    expect(screen.getByText('غير مدعوم')).toBeTruthy();
  });
});

const transcript: TranscriptData = {
  version: 1, asr_provider: 'faster_whisper', asr_model: 'large-v3', diarization_provider: 'sherpa_onnx', speaker_name_hints: [],
  speakers: [{ id: 'SPK_1', label: 'المتحدث 1', display_name: null, title: null, confirmed: false, speaking_seconds: 10 }],
  segments: [{ id: 'S0001', start: 0, end: 6, speaker_id: 'SPK_1', speaker_confidence: 'high', text_verbatim: 'إحنا شايفين إن النظام ده ممكن يوفر وقت',
    text_readable: 'إحنا شايفين إن النظام ده ممكن يوفر وقت', flags: [], uncertain_terms: [], excluded: false, readable_source: 'rules' }],
};

const items: ItemsData = {
  purpose: null, topics: [], document_issues: [], coverage: { evidence_coverage: 1 }, llm_used: false, llm_model: null, analysis_model: 'x',
  types_ar: { decision_approved: 'قرار معتمد', proposal: 'مقترح' }, reviewed_by: null, reviewed_at: null,
  items: [{
    id: 'I001', type: 'decision_approved', type_ar: 'قرار معتمد', topic_id: null, statement: 'تقرر اعتماد النظام.', speaker_ids: ['SPK_1'],
    owner: { name_as_spoken: null, speaker_id: null, status: 'unspecified' }, due: { text_as_spoken: null, date_iso: null, status: 'unspecified' },
    qualifications: [], evidence: [{ segment_id: 'S0001', quote: 'النظام ده ممكن يوفر وقت' }], approval_evidence: [], requires_confirmation: true,
    confidence: 'low', notes: null, final_type_ar: 'مقترح', review: null,
    verification: {
      item_id: 'I001', status: 'needs_review', original_type: 'decision_approved', final_type: 'proposal', llm: null, issues: [],
      checks: [{ name: 'approval_words', passed: false, severity: 'critical', detail_ar: 'لا يتضمن الدليل عبارة اعتماد أو موافقة صريحة' }],
      evidence: [{ segment_id: 'S0001', speaker_id: 'SPK_1', speaker_confidence: 'high', start: 0, end: 6, original_text: 'إحنا شايفين إن النظام ده ممكن يوفر وقت',
        quote: 'النظام ده ممكن يوفر وقت', quote_found: true, match_score: 100 }],
    },
  }],
};

describe('items review', () => {
  it('shows a downgraded decision under proposals with its evidence and failed check', () => {
    render(<ItemsTab meetingId="m1" data={items} transcript={transcript} reload={() => {}} goSegment={() => {}} />);
    expect(screen.getByText(/المقترحات والتوصيات/)).toBeTruthy();
    expect(screen.getByText(/أُعيد تصنيفه من «قرار معتمد»/)).toBeTruthy();
    expect(screen.getByText('يتطلب المراجعة')).toBeTruthy();
    expect(screen.getByText(/لا يتضمن الدليل عبارة اعتماد/)).toBeTruthy();
    expect(screen.getByText(/اقتباس مطابق/)).toBeTruthy();
    expect(screen.queryByText(/^القرارات والتوافقات المبدئية \(/)).toBeNull();
  });
});

describe('items kept out of the minutes', () => {
  it('says an unsupported item is not in the minutes, and shows a speaker owner', () => {
    const it0 = items.items[0]!;
    const data: ItemsData = {
      ...items,
      items: [{
        ...it0, id: 'I002', type: 'action_assigned', type_ar: 'تكليف', final_type_ar: null, statement: 'سأتولى إعداد الخطة.',
        owner: { name_as_spoken: null, speaker_id: 'SPK_1', status: 'explicit' },
        verification: { ...it0.verification!, item_id: 'I002', status: 'unsupported', original_type: 'action_assigned', final_type: 'action_assigned', checks: [] },
      }],
    };
    render(<ItemsTab meetingId="m1" data={data} transcript={transcript} reload={() => {}} goSegment={() => {}} />);
    expect(screen.getByText(/لا يُدرج هذا البند في المحضر/)).toBeTruthy();
    expect(screen.getByText(/المسؤول: المتحدث 1 \(القائل نفسه\)/)).toBeTruthy();
  });
});
