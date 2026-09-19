from oncall.history_import import parse_history_csv


def test_parse_valid_history_csv() -> None:
    rows, errors = parse_history_csv(
        b"service_date,role,assignee_name\n2026-01-01,primary,Anna Nowak\n"
    )

    assert errors == []
    assert len(rows) == 1
    assert rows[0].assignee_name == "Anna Nowak"
    assert rows[0].role.value == "primary"


def test_parse_reports_duplicate_slot_and_invalid_values() -> None:
    rows, errors = parse_history_csv(
        b"service_date,role,assignee_name\n"
        b"bad,primary,Anna\n"
        b"2026-01-01,primary,Anna\n"
        b"2026-01-01,primary,Jan\n"
    )

    assert len(rows) == 1
    assert [(error.row_number, error.field) for error in errors] == [
        (2, "service_date"),
        (4, "role"),
    ]


def test_parse_requires_headers() -> None:
    rows, errors = parse_history_csv(b"date,name\n2026-01-01,Anna\n")

    assert rows == []
    assert "assignee_name" in errors[0].message


def test_parse_rejects_late_shift_on_day_off() -> None:
    rows, errors = parse_history_csv(
        b"service_date,role,assignee_name\n2026-09-06,late_shift,Anna Nowak\n"
    )

    assert rows == []
    assert "tylko w dni robocze" in errors[0].message


def test_downloadable_template_passes_format_validation() -> None:
    """QA7-L04: the template's own example used 2026-01-01 (Nowy Rok) for a
    late_shift row, so downloading and re-uploading it unmodified failed."""
    template = (
        b"service_date,role,assignee_name\n"
        b"2026-01-05,primary,Anna Nowak\n"
        b"2026-01-05,secondary,Jan Kowalski\n"
        b"2026-01-05,late_shift,Anna Nowak\n"
    )

    rows, errors = parse_history_csv(template)

    assert errors == []
    assert len(rows) == 3
