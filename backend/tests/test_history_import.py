from oncall.history_import import MAX_ROWS, HistoryImportError, parse_history_csv
from oncall.i18n import translate


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


def test_parse_refuses_a_file_that_is_not_utf8() -> None:
    rows, errors = parse_history_csv(b"service_date,role,assignee_name\n2026-01-05,primary,\xb3\n")

    assert rows == []
    assert [(error.row_number, error.field, error.message) for error in errors] == [
        (None, None, translate("history.file_not_utf8"))
    ]


def test_parse_reads_a_file_saved_with_a_byte_order_mark() -> None:
    """Excel writes one at the start of a UTF-8 CSV; it must not become part
    of the first column's name."""
    rows, errors = parse_history_csv(
        b"\xef\xbb\xbfservice_date,role,assignee_name\n2026-01-05,primary,Anna\n"
    )

    assert errors == []
    assert [row.assignee_name for row in rows] == ["Anna"]


def test_parse_reads_column_names_padded_with_spaces() -> None:
    """A header written as `service_date , role` names the same columns; the
    rows are read under the trimmed names too, not failed as bad dates."""
    rows, errors = parse_history_csv(
        b"service_date , role ,assignee_name\n2026-01-05,primary,Anna\n"
    )

    assert errors == []
    assert [(row.service_date.isoformat(), row.role.value) for row in rows] == [
        ("2026-01-05", "primary")
    ]


def test_parse_names_every_row_it_cannot_read_and_why() -> None:
    rows, errors = parse_history_csv(
        b"service_date,role,assignee_name\n"
        b"2026-01-05,backup,Anna\n"
        b"2026-01-05,secondary,   \n"
        b"2026-01-05,primary\n"
        b",primary,Anna\n"
    )

    assert rows == []
    assert [(error.row_number, error.field, error.message) for error in errors] == [
        (2, "role", translate("history.role_allowed")),
        (3, "assignee_name", translate("history.assignee_required")),
        (4, "assignee_name", translate("history.assignee_required")),
        (5, "service_date", translate("history.date_format")),
    ]


def test_parse_stops_at_the_row_limit_and_says_so() -> None:
    lines = [b"service_date,role,assignee_name"]
    lines += [b"2026-01-05,primary,Anna"] + [b"2026-01-05,primary,Anna"] * MAX_ROWS
    rows, errors = parse_history_csv(b"\n".join(lines) + b"\n")

    assert len(rows) == 1
    # Every row after the first is a duplicate, then the one past the limit
    # ends the reading with a file-level error rather than one more duplicate.
    assert len(errors) == MAX_ROWS
    assert errors[-1] == HistoryImportError(
        None, None, translate("history.too_many_rows", max_rows=MAX_ROWS)
    )
    assert errors[-2].row_number == MAX_ROWS + 1


def test_parse_of_headers_alone_says_the_file_is_empty() -> None:
    rows, errors = parse_history_csv(b"service_date,role,assignee_name\n")

    assert rows == []
    assert errors == [HistoryImportError(None, None, translate("history.file_empty"))]


def test_parse_of_an_empty_file_names_every_missing_column() -> None:
    rows, errors = parse_history_csv(b"")

    assert rows == []
    assert errors == [
        HistoryImportError(
            None,
            None,
            translate("history.columns_missing", columns="assignee_name, role, service_date"),
        )
    ]
