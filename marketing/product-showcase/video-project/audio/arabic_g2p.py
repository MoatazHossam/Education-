"""Fully diacritized Modern Standard Arabic to phonemes, in espeak-ng's notation for Arabic (the notation the
voices were trained on). The reading rules are applied by rule, not guessed:

- every short vowel, tanween, sukun and shadda as written; long vowels from alif, waw and ya after their vowel;
  diphthongs ai / au; alif maqsura; the dagger alif, also where it is not written (هٰذَا، ذٰلِكَ، لٰكِنَّ، هٰكَذَا);
- hamzat al-wasl: silent in connected speech (بِالْمَنْهَجِ → bilmanhadʒi, وَاخْتِبَارَاتٌ → waχtibaːraːtun), a long
  vowel before it is shortened (فِي الْمَدَارِسِ → fi lmadaːrisi), a final consonant takes a helping vowel, and it
  is read ʔa / ʔi after a pause;
- the lam of the article assimilates to a sun letter (الشَّمْسُ → ʔaʃʃamsu);
- pausal form (الوقف) before punctuation and at the end of a line: no final short vowel or tanween, tanween
  al-fath is read aː, ta marbuta is not read as t, a final doubled ya after kasra is read iː;
- iqlab: a nun without vowel (or tanween) before ب is read m (تَنْبِيهٌ → tambiːhun);
- stress: the final syllable if superheavy, else the penult if heavy, else the antepenult.

Emphatic consonants are written as espeak writes them (s̪, dˤ, t̪, ð), with its "." after the following vowel.
"""

import re

FATHATAN, DAMMATAN, KASRATAN = '\u064B', '\u064C', '\u064D'
FATHA, DAMMA, KASRA = '\u064E', '\u064F', '\u0650'
SHADDA, SUKUN, DAGGER = '\u0651', '\u0652', '\u0670'
MARKS = {FATHATAN, DAMMATAN, KASRATAN, FATHA, DAMMA, KASRA, SHADDA, SUKUN, DAGGER, '\u0653', '\u0654', '\u0655'}
SHORT = {FATHA: 'a', DAMMA: 'u', KASRA: 'i'}
TANWEEN = {FATHATAN: 'a', DAMMATAN: 'u', KASRATAN: 'i'}

CONSONANT = {
    'ء': 'ʔ', 'أ': 'ʔ', 'إ': 'ʔ', 'ؤ': 'ʔ', 'ئ': 'ʔ', 'ب': 'b', 'ت': 't', 'ث': 'θ', 'ج': 'dʒ', 'ح': 'ħ',
    'خ': 'χ', 'د': 'd', 'ذ': 'ð', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ʃ', 'ص': 's̪', 'ض': 'dˤ', 'ط': 't̪',
    'ظ': 'ð', 'ع': 'ʕ', 'غ': 'ɣ', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
    'و': 'w', 'ي': 'j', 'ة': 't',
}
EMPHATIC = set('صضطظ')
SUN = set('تثدذرزسشصضطظلن')
# Geminate stops are written with a length mark, other geminates by doubling, as espeak does.
STOPS = {'b', 't', 'd', 'k', 'q', 'ʔ', 's̪', 't̪', 'dˤ', 'dʒ'}
PROCLITICS = set('وفبكل')
PUNCT = {'،': ',', ',': ',', '.': '.', '؛': ';', ';': ';', ':': ':', '؟': '?', '?': '?', '!': '!'}
ALIF = 'اٱ'
# The long aa of these words is not written (the dagger alif is usually left out).
HIDDEN_ALIF = re.compile('^((?:[وفبكل][\u064E\u0650]){0,2}?)(ه|ذ|ل)\u064E(?=[ذكل])')
HIDDEN_ALIF_WORDS = re.compile('^[وفبكل]{0,2}?(هذا|هذه|هذان|هذين|ذلك|لكن|هكذا)')


def hidden_alif(word):
    """هَذَا → هٰذَا، ذَلِكَ → ذٰلِكَ، لَكِنَّ → لٰكِنَّ، هَكَذَا → هٰكَذَا (with any proclitics)."""
    bare = re.sub('[\u064B-\u0652\u0670]', '', word)
    if not HIDDEN_ALIF_WORDS.match(bare):
        return word
    return HIDDEN_ALIF.sub(lambda m: m.group(1) + m.group(2) + DAGGER, word, count=1)


def letters(word):
    """[(letter, marks)] — the marks of each letter as a string; tatweel and other signs are dropped."""
    out = []
    for ch in word:
        if ch in MARKS and out:
            out[-1][1].append(ch)
        elif 'ء' <= ch <= 'ي' or ch == 'ٱ':
            out.append((ch, []))
    return [(c, ''.join(m)) for c, m in out]


def tokens(text):
    """Words and pauses: [('w', word) | ('p', mark)]. A dash is a pause; quotation marks are not read."""
    text = re.sub(r'\s*—\s*', '، ', text).replace('«', '').replace('»', '').replace('"', '')
    out = []
    for part in text.split():
        m = re.match(r'^(.*?)([،,.؛;:؟?!]*)$', part)
        if m.group(1):
            out.append(('w', m.group(1)))
        out += [('p', PUNCT[p]) for p in m.group(2)]
    return out


class Seg:
    """One sound: a consonant 'C', a vowel 'V' (long or short) or the second half of a diphthong 'G'."""

    def __init__(self, kind, ph, long=False, emphatic=False, tanween=False):
        self.kind, self.ph, self.long, self.emphatic, self.tanween = kind, ph, long, emphatic, tanween

    def __repr__(self):
        return self.ph + ('ː' if self.long else '')


def is_wasl(ls, i):
    """Is the bare alif at i a hamzat al-wasl? At the start of the word, or after proclitics (وَ، فَ، بِ، كَ، لِ)
    when the next letter has sukun, or is the article's lam before a sun letter with shadda, or before another
    hamzat al-wasl (وَالِاشْتِرَاكَاتُ)."""
    if ls[i][0] == 'ٱ':
        return True
    if ls[i][0] != 'ا' or any(c not in PROCLITICS or not any(v in m for v in SHORT) for c, m in ls[:i]):
        return False
    if i == 0:
        return True
    if i + 1 >= len(ls):
        return False
    nxt, marks = ls[i + 1]
    if SUKUN in marks:
        return True
    if nxt != 'ل' or i + 2 >= len(ls):
        return False
    return (not marks and SHADDA in ls[i + 2][1]) or (KASRA in marks and ls[i + 2] == ('ا', ''))


def word_segments(word, after_pause):
    """Segments of one word in connected form, and whether it starts with hamzat al-wasl."""
    ls = letters(hidden_alif(word))
    segs = []
    wasl_start = False
    for i, (c, m) in enumerate(ls):
        prev_marks = ls[i - 1][1] if i else ''
        last = i == len(ls) - 1
        if c in ALIF and is_wasl(ls, i):
            if i == 0:
                wasl_start = True
                if after_pause:  # ال → ʔa; اخْتِبَار، اثْنَا → ʔi
                    segs += [Seg('C', 'ʔ'), Seg('V', 'a' if i + 1 < len(ls) and ls[i + 1][0] == 'ل' else 'i')]
            continue
        if c == 'ا':
            if FATHATAN in m:  # tanween al-fath written on the alif
                segs += [Seg('V', 'a', tanween=True), Seg('C', 'n')]
            elif FATHATAN in prev_marks:
                pass  # the alif that carries tanween al-fath
            elif segs and segs[-1].kind == 'V' and segs[-1].ph == 'u' and segs[-1].long and last:
                pass  # the silent alif after the plural waw (تَوَاصَلُوا)
            elif segs and segs[-1].kind == 'V':
                if segs[-1].ph == 'a':
                    segs[-1].long = True
            elif segs:
                segs.append(Seg('V', 'a', long=True, emphatic=segs[-1].emphatic))
            continue
        if c == 'آ':
            segs += [Seg('C', 'ʔ'), Seg('V', 'a', long=True)]
            continue
        if c == 'ى':
            if FATHATAN in prev_marks:
                continue  # the alif maqsura that carries tanween al-fath (مُحْتَوًى)
            if segs and segs[-1].kind == 'V':
                segs[-1].long = True
            else:
                segs.append(Seg('V', 'a', long=True))
            continue
        vowel = next((SHORT[v] for v in m if v in SHORT), None)
        tan = next((TANWEEN[v] for v in m if v in TANWEEN), None)
        bare = vowel is None and tan is None and SHADDA not in m and DAGGER not in m
        if c in 'وي' and bare and segs and segs[-1].kind == 'V' and not segs[-1].long:
            if (c, segs[-1].ph) in (('و', 'u'), ('ي', 'i')):
                segs[-1].long = True  # damma + waw, kasra + ya
                continue
            if segs[-1].ph == 'a':
                segs.append(Seg('G', 'u' if c == 'و' else 'i'))  # diphthong, written au / ai as espeak does
                continue
        if c == 'ل' and not m and i + 1 < len(ls) and ls[i + 1][0] in SUN and SHADDA in ls[i + 1][1]:
            continue  # the article's lam before a sun letter: the shadda doubles the sun letter
        ph = CONSONANT.get(c)
        if ph is None:
            continue
        emph = c in EMPHATIC
        segs.append(Seg('C', ph, emphatic=emph))
        if SHADDA in m:
            segs.append(Seg('C', ph, emphatic=emph))
        if DAGGER in m:
            segs.append(Seg('V', 'a', long=True, emphatic=emph))
        elif vowel:
            segs.append(Seg('V', vowel, emphatic=emph))
        elif tan:
            segs += [Seg('V', tan, emphatic=emph, tanween=True), Seg('C', 'n')]
        elif c in 'أإ' and not m:
            segs.append(Seg('V', 'i' if c == 'إ' else 'a'))  # a hamza written without its vowel
    return segs, wasl_start


def pausal(word, segs):
    """Pausal form: no final short vowel or tanween; tanween al-fath becomes aː; ta marbuta is not read as t;
    a final doubled ya after kasra (دِرَاسِيّ) is read as iː."""
    ls = letters(word)
    if ls and ls[-1][0] == 'ة':
        while segs and not (segs[-1].kind == 'C' and segs[-1].ph == 't'):
            segs.pop()
        if segs:
            segs.pop()  # the t of ta marbuta, with its vowel and tanween
        return segs
    if len(segs) >= 2 and segs[-1].ph == 'n' and segs[-2].tanween:
        segs.pop()
        if segs[-1].ph == 'a':
            segs[-1].long, segs[-1].tanween = True, False
            return segs
        segs.pop()
    elif segs and segs[-1].kind == 'V' and not segs[-1].long:
        segs.pop()
    if len(segs) >= 3 and segs[-1].ph == segs[-2].ph == 'j' and segs[-3].ph == 'i':
        del segs[-2:]
        segs[-1].long = True
    elif len(segs) >= 2 and segs[-1].kind == 'C' and (segs[-2].ph, segs[-1].ph) in (('i', 'j'), ('u', 'w')):
        segs.pop()  # الْمُتَبَقِّيَ → ...qqiː
        segs[-1].long = True
    return segs


def stressed_vowel(segs):
    """Index of the stressed vowel: final if superheavy, else penult if heavy, else antepenult."""
    vowels = [k for k, s in enumerate(segs) if s.kind == 'V']
    if not vowels:
        return None
    weights = []
    for n, v in enumerate(vowels):
        end = vowels[n + 1] - 1 if n + 1 < len(vowels) else len(segs)
        coda = sum(1 for s in segs[v + 1:end] if s.kind in 'CG')
        weights.append(min(1 + segs[v].long + min(coda, 2), 3))
    if len(vowels) == 1 or weights[-1] == 3:
        return vowels[-1]
    if weights[-2] >= 2 or len(vowels) == 2:
        return vowels[-2]
    return vowels[-3]


def render(segs):
    """espeak-style string: stress mark before the stressed vowel, length marks, emphatic '.' after the vowel."""
    sv = stressed_vowel(segs)
    out = []
    for k, s in enumerate(segs):
        if s.kind == 'V':
            out += (['ˈ'] if k == sv else []) + [s.ph] + (['.'] if s.emphatic else []) + (['ː'] if s.long else [])
        elif s.kind == 'C' and k > 0 and segs[k - 1].kind == 'C' and segs[k - 1].ph == s.ph:
            out.append('ː' if s.ph in STOPS else s.ph)
        else:
            out.append(s.ph)
    return ''.join(out)


def phonemize(text):
    """[(word, phonemes) | (None, punctuation)] for one line."""
    toks = tokens(text)
    words = []
    after_pause = True
    for n, (kind, val) in enumerate(toks):
        if kind == 'p':
            words.append([None, val, False])
            after_pause = True
            continue
        segs, wasl = word_segments(val, after_pause)
        if n + 1 >= len(toks) or toks[n + 1][0] == 'p':
            segs = pausal(val, segs)
        words.append([val, segs, wasl])
        after_pause = False
    # Before a word with hamzat al-wasl: a final long vowel is shortened, a final consonant takes a helping vowel
    # (مِنْ → mina, a pronoun in -m → -mu, otherwise i). The script writes most of these already.
    for k in range(len(words) - 1):
        w, segs, _ = words[k]
        nw, _, nwasl = words[k + 1]
        if w is None or nw is None or not nwasl or not segs:
            continue
        if segs[-1].kind == 'V':
            segs[-1].long = False
        else:
            ls = letters(w)
            helper = 'a' if [c for c, _ in ls] == ['م', 'ن'] else 'u' if len(ls) > 1 and ls[-1][0] == 'م' and DAMMA in ls[-2][1] else 'i'
            segs.append(Seg('V', helper))
    # Iqlab, inside a word and across words in connected speech.
    flat = [s for w, segs, _ in words if w is not None for s in segs]
    for a, b in zip(flat, flat[1:]):
        if a.kind == 'C' and a.ph == 'n' and b.kind == 'C' and b.ph == 'b':
            a.ph = 'm'
    return [(w, render(segs) if w is not None else segs) for w, segs, _ in words]


def line(text):
    """Phonemes for a whole line: words separated by spaces, punctuation kept."""
    out = ''
    for w, ph in phonemize(text):
        out = out.rstrip() + ph + ' ' if w is None else out + ph + ' '
    return out.strip()


if __name__ == '__main__':
    import sys
    for t in sys.argv[1:]:
        print(t, '→', line(t))
