import { useRef, useState } from 'react';

// Plays one excerpt of the recording (decrypted and cut on the server; nothing is cached).
export default function AudioClip({ meetingId, start, end, label = 'استماع' }: { meetingId: string; start: number; end: number; label?: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const pad = 0.6;
  const src = `/api/meetings/${meetingId}/audio?start=${Math.max(0, start - pad).toFixed(2)}&end=${(end + pad).toFixed(2)}`;

  const toggle = () => {
    if (!ref.current) {
      const a = new Audio(src);
      ref.current = a;
      a.onplaying = () => setState('playing');
      a.onended = () => setState('idle');
      a.onpause = () => setState('idle');
      a.onerror = () => setState('error');
    }
    const a = ref.current;
    if (state === 'playing') { a.pause(); return; }
    setState('loading');
    a.currentTime = 0;
    a.play().catch(() => setState('error'));
  };

  return (
    <button className="btn small" type="button" onClick={toggle} aria-label={`${label} من التسجيل`}>
      {state === 'playing' ? '■ إيقاف' : state === 'loading' ? '… تحميل' : state === 'error' ? '⚠ تعذر التشغيل' : `▶ ${label}`}
    </button>
  );
}
