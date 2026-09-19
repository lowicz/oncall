"""The history CSV format: what an uploaded file must look like, row by row.

Checks against the rotation itself happen in `oncall.domain.history`.
"""

import csv
import io
from datetime import date

from oncall.domain.history.models import HistoryImportError as HistoryImportError
from oncall.domain.history.models import ParsedHistoryRow as ParsedHistoryRow
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_working_day, polish_holidays

REQUIRED_HEADERS = {"service_date", "role", "assignee_name"}
MAX_ROWS = 5000


def parse_history_csv(content: bytes) -> tuple[list[ParsedHistoryRow], list[HistoryImportError]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [HistoryImportError(None, None, "Plik musi być zapisany jako UTF-8")]

    reader = csv.DictReader(io.StringIO(text))
    headers = {header.strip() for header in (reader.fieldnames or [])}
    missing = sorted(REQUIRED_HEADERS - headers)
    if missing:
        return [], [HistoryImportError(None, None, f"Brak wymaganych kolumn: {', '.join(missing)}")]

    rows: list[ParsedHistoryRow] = []
    errors: list[HistoryImportError] = []
    seen_slots: set[tuple[date, AssignmentRole]] = set()
    for row_number, raw in enumerate(reader, start=2):
        if row_number > MAX_ROWS + 1:
            errors.append(
                HistoryImportError(None, None, f"Plik może zawierać maksymalnie {MAX_ROWS} wierszy")
            )
            break
        try:
            service_date = date.fromisoformat((raw.get("service_date") or "").strip())
        except ValueError:
            errors.append(
                HistoryImportError(row_number, "service_date", "Oczekiwany format RRRR-MM-DD")
            )
            continue
        try:
            role = AssignmentRole((raw.get("role") or "").strip())
        except ValueError:
            errors.append(
                HistoryImportError(
                    row_number,
                    "role",
                    "Dozwolone: primary, secondary, late_shift",
                )
            )
            continue
        if role == AssignmentRole.late_shift:
            polish_days = polish_holidays(service_date, service_date)
            if not is_working_day(service_date, polish_days):
                errors.append(
                    HistoryImportError(
                        row_number,
                        "role",
                        "Zmiana 11–19 może występować tylko w dni robocze",
                    )
                )
                continue
        assignee_name = (raw.get("assignee_name") or "").strip()
        if not assignee_name:
            errors.append(HistoryImportError(row_number, "assignee_name", "Osoba jest wymagana"))
            continue
        slot = (service_date, role)
        if slot in seen_slots:
            errors.append(HistoryImportError(row_number, "role", "Duplikat roli dla tego dnia"))
            continue
        seen_slots.add(slot)
        rows.append(ParsedHistoryRow(row_number, service_date, role, assignee_name))
    if not rows and not errors:
        errors.append(HistoryImportError(None, None, "Plik nie zawiera danych"))
    return rows, errors
