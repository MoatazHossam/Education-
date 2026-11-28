"""Command-line commands used by the start scripts."""

PASSWORD = "a-long-test-password-1"


def test_org_count_counts_organizations(database, capsys):
    from mahdar.cli import _create_org_and_admin, main

    assert main(["org-count"]) == 0
    before = int(capsys.readouterr().out.strip())
    _create_org_and_admin("جهة للاختبار", "count@example.com", "مدير", PASSWORD)
    assert main(["org-count"]) == 0
    assert int(capsys.readouterr().out.strip()) == before + 1
