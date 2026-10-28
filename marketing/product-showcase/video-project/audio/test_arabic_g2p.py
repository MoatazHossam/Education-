"""Reading rules of arabic_g2p: python3 -m unittest discover -s audio -p 'test_*.py' (from video-project/)."""
import re
import unittest

from arabic_g2p import line


def plain(p):
    """Phonemes without stress marks and without the '.' written after an emphatic vowel (a full stop is
    always followed by a space or the end of the line), to test the sounds."""
    return re.sub(r'(?<=[aiu])\.(?=\S)', '', p.replace('ˈ', '').replace('ˌ', ''))


class Rules(unittest.TestCase):
    def check(self, text, expected):
        self.assertEqual(plain(line(text)), expected, text)

    def test_shadda_keeps_its_vowel(self):
        self.check('سَنُدَرِّسُ الْيَوْمَ', 'sanudarrisu ljaum')
        self.check('الَّذِي يُدَرِّسُ', 'ʔallaðiː judarris')
        self.check('أَيَّ الْكُتُبِ', 'ʔajja lkutub')

    def test_long_vowels_and_diphthongs(self):
        self.check('كِتَابٌ', 'kitaːb')
        self.check('يَقُولُونَ', 'jaquːluːn')
        self.check('بَيْتٌ وَيَوْمٌ', 'baitun wajaum')
        self.check('عَلَى', 'ʕalaː')

    def test_consonantal_waw_and_ya(self):
        self.check('هِيَ وَهُوَ', 'hija wahuː')  # pausal: huː
        self.check('بَيَانَاتٌ مَبْنِيَّةٌ', 'bajaːnaːtun mabnijja')

    def test_hidden_alif(self):
        self.check('ذَلِكَ', 'ðaːlik')
        self.check('هَذَا', 'haːðaː')
        self.check('لَكِنَّ الطَّالِبَ', 'laːkinna t̪ːaːlib')
        self.check('لِذَلِكَ', 'liðaːlik')

    def test_hamzat_al_wasl(self):
        self.check('الْمَنْهَجُ', 'ʔalmanhadʒ')  # after a pause
        self.check('فِي الْمَدَارِسِ', 'fi lmadaːris')  # long vowel shortened, alif silent
        self.check('بِالْمَنْهَجِ', 'bilmanhadʒ')
        self.check('وَاخْتِبَارَاتٌ', 'waχtibaːraːt')
        self.check('وَالِاشْتِرَاكَاتُ', 'waliʃtiraːkaːt')
        self.check('مِنَ الْكُتُبِ', 'mina lkutub')
        self.check('اثْنَا عَشَرَ', 'ʔiθnaː ʕaʃar')

    def test_wasl_alif_is_not_a_long_vowel(self):
        self.check('وَاجِبَاتٌ', 'waːdʒibaːt')  # a root waw: the alif is long
        self.check('وَالِدٌ', 'waːlid')

    def test_sun_letters(self):
        self.check('الشَّمْسُ', 'ʔaʃʃams')
        self.check('لِلطُّلَّابِ', 'lit̪ːullaːb')

    def test_pausal_forms(self):
        self.check('مَدْرَسَةٌ.', 'madrasa.')
        self.check('كِتَابًا.', 'kitaːbaː.')
        self.check('دِرَاسِيٍّ،', 'diraːsiː,')
        self.check('مُحْتَوًى.', 'muħtawaː.')
        self.check('الْمُتَبَقِّيَ.', 'ʔalmutabaqːiː.')

    def test_tanween_in_connected_speech(self):
        self.check('مَادَّةً دِرَاسِيَّةً', 'maːdːatan diraːsijja')
        self.check('مُحْتَوًى جَدِيدٌ', 'muħtawan dʒadiːd')

    def test_hamza(self):
        self.check('لِتَأْكِيدِ', 'litaʔkiːd')
        self.check('الْمُسْتَأْجِرِينَ', 'ʔalmustaʔdʒiriːn')
        self.check('مِئَتَانِ وَإِحْدَى', 'miʔataːni waʔiħdaː')

    def test_plural_alif_is_silent(self):
        self.check('تَوَاصَلُوا', 'tawaːs̪aluː')

    def test_iqlab(self):
        self.check('تَنْبِيهٌ', 'tambiːh')
        self.check('كِتَابٌ بَسِيطٌ', 'kitaːbum basiːt̪')

    def test_emphatics(self):
        self.check('صَفًّا', 's̪affaː')
        self.check('ضَرَبَ طَالِبٌ', 'dˤaraba t̪aːlib')

    def test_stress(self):
        self.assertEqual(line('مَدْرَسَةٌ.'), 'mˈadrasa.')
        self.assertEqual(line('كِتَابٌ'), 'kitˈaːb')
        self.assertEqual(line('الطَّالِبُ'), 'ʔat̪ːˈa.ːlib')

    def test_punctuation_and_quotes(self):
        self.assertEqual(plain(line('صَفْحَةِ «الْيَوْم»: هُنَا — ثُمَّ؟')), 's̪afħati ljaum: hunaː, θumm?')


if __name__ == '__main__':
    unittest.main()
