import uuid
from datetime import date

from oncall.ical import IcsEvent, build_ics
from oncall.models import AssignmentRole


def event(**overrides) -> IcsEvent:
    values = {
        "schedule_id": uuid.UUID("11111111-2222-3333-4444-555555555555"),
        "service_date": date(2026, 9, 14),
        "role": AssignmentRole.primary,
        "assignee_name": "Anna Kowalska",
        "sequence": 3,
    }
    values.update(overrides)
    return IcsEvent(**values)


def lines(ics: str) -> list[str]:
    return ics.split("\r\n")


def test_build_ics_structure_and_all_day_event() -> None:
    ics = build_ics([event()], calendar_name="Erste On-call · Anna")
    content = lines(ics)
    assert content[0] == "BEGIN:VCALENDAR"
    assert "VERSION:2.0" in content
    assert "X-WR-CALNAME:Erste On-call · Anna" in content
    assert content[-2] == "END:VCALENDAR"
    assert "DTSTART;VALUE=DATE:20260914" in content
    assert "DTEND;VALUE=DATE:20260915" in content
    assert "SUMMARY:PRIMARY · Anna Kowalska" in content
    assert "SEQUENCE:3" in content
    uid = "UID:11111111-2222-3333-4444-555555555555-20260914-primary@erste-oncall"
    assert uid in content
    assert "STATUS:CONFIRMED" in content


def test_build_ics_uses_crlf_and_trailing_crlf() -> None:
    ics = build_ics([event()], calendar_name="x")
    assert "\n" not in ics.replace("\r\n", "")
    assert ics.endswith("\r\n")


def test_build_ics_escapes_special_characters() -> None:
    ics = build_ics(
        [event(assignee_name="Kowalska, Anna; QA\\Lead")], calendar_name="nazwa, z;przecinkiem"
    )
    content = lines(ics)
    assert "SUMMARY:PRIMARY · Kowalska\\, Anna\\; QA\\\\Lead" in content
    assert "X-WR-CALNAME:nazwa\\, z\\;przecinkiem" in content


def test_build_ics_marks_override_in_description() -> None:
    ics = build_ics([event(is_override=True)], calendar_name="x")
    assert any("override" in line for line in lines(ics))


def test_long_lines_are_folded_below_75_octets() -> None:
    long_name = "Anna-Maria Kowalska-Nowak-Zielińska-Wiśniewska-Borkowska-Długa"
    ics = build_ics([event(assignee_name=long_name)], calendar_name="x")
    for line in lines(ics):
        assert len(line.encode("utf-8")) <= 75
    unfolded = ics.replace("\r\n ", "")
    assert f"SUMMARY:PRIMARY · {long_name}" in unfolded


def test_folding_does_not_split_multibyte_characters() -> None:
    name = "Ś" * 60
    ics = build_ics([event(assignee_name=name)], calendar_name="x")
    assert "�" not in ics
    unfolded = ics.replace("\r\n ", "")
    assert name in unfolded


def test_events_are_sorted_by_date_then_role() -> None:
    later = event(service_date=date(2026, 9, 15), role=AssignmentRole.primary)
    earlier_late = event(service_date=date(2026, 9, 14), role=AssignmentRole.late_shift)
    earlier_primary = event(service_date=date(2026, 9, 14), role=AssignmentRole.primary)
    ics = build_ics([later, earlier_late, earlier_primary], calendar_name="x")
    positions = [
        ics.index("DTSTART;VALUE=DATE:20260914"),
        ics.index("DTSTART;VALUE=DATE:20260915"),
    ]
    assert positions[0] < positions[1]
