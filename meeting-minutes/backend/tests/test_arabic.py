from mahdar.pipeline import arabic


def test_normalize_unifies_letters_digits_and_diacritics():
    assert arabic.normalize("إحنا شايفين إنّ النظامَ ده") == "احنا شايفين ان النظام ده"
    assert arabic.normalize("٢٥٫٥٪ من ١٬٢٠٠") == "25.5 % من 1,200"
    assert arabic.normalize("المرحلة الأولى") == arabic.normalize("المرحله الاولي")


def test_numbers_in_words_and_digits_agree():
    words = arabic.extract_numbers("الميزانية خمسة وعشرين ألف جنيه")
    digits = arabic.extract_numbers("الميزانية 25,000 جنيه")
    assert 25000 in words and 25000 in digits
    assert 2400000 in arabic.extract_numbers("مليونين وأربعمائة ألف جنيه")
    assert 2400000 in arabic.extract_numbers("مليونان وأربعمئة ألف")
    assert 550000 in arabic.extract_numbers("خمسمية وخمسين ألف")
    assert {15.0} <= arabic.extract_numbers("خمستاشر في المية")
    assert 99.5 in arabic.extract_numbers("تسعة وتسعين ونص في المية")
    assert 2500000 in arabic.extract_numbers("2.5 مليون")


def test_price_word_is_not_eight():
    # "تمن" (price, Egyptian) must not be read as eight.
    assert 8 not in arabic.extract_numbers("التمن عالي")


def test_dates_explicit_and_relative():
    found = arabic.extract_dates("نسلم يوم الخميس 15 ديسمبر أو الأسبوع الجاي")
    assert any(d.day == 15 and d.month == 12 for d in found)
    assert any(d.relative and d.text == "الاسبوع الجاي" for d in found)
    words = arabic.extract_dates("قبل العشرين من ديسمبر")
    assert any(d.day == 20 and d.month == 12 for d in words)


def test_negation_in_msa_and_egyptian():
    assert arabic.has_negation("إحنا مش هنعتمد النظام")
    assert arabic.has_negation("ماوافقناش على العرض")
    assert arabic.has_negation("لم يتم الاتفاق")
    assert not arabic.has_negation("نعتمد النظام")


def test_approval_and_tentative_lexicons():
    assert arabic.contains_phrase(arabic.normalize("إذن تقرر اعتماد الميزانية"), arabic.APPROVAL)
    assert arabic.contains_phrase(arabic.normalize("تمام يبقى اتفقنا"), arabic.APPROVAL)
    assert arabic.contains_phrase(arabic.normalize("مبدئياً خلينا نقول آخر الشهر"), arabic.TENTATIVE)
    assert not arabic.contains_phrase(arabic.normalize("إحنا شايفين إن النظام ده ممكن يوفر وقت"), arabic.APPROVAL)


def test_egyptian_future_commitment():
    assert arabic.future_commitment("أنا هبعت التقرير بكرة")
    assert arabic.future_commitment("سأرسله قبل العشرين")
    assert not arabic.future_commitment("هذا هو التقرير")


def test_latin_terms_keep_product_versions():
    assert arabic.latin_terms("ربط ERP مع Dynamics 365 عن طريق API") == {"erp", "dynamics 365", "api"}


def test_colloquial_words_detected():
    assert "دلوقتي" in arabic.colloquial_words("هنعمل ده دلوقتي")
    assert arabic.colloquial_words("نوقشت إمكانية استخدام النظام") == []
