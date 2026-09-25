"""The history CSV format: what an uploaded file must look like, row by row.

Checks against the rotation itself happen in `oncall.domain.history`.
"""

import csv
import io
from datetime import date

from oncall.domain.history.models import HistoryImportError as HistoryImportError
from oncall.domain.history.models import ParsedHistoryRow as ParsedHistoryRow
from oncall.domain.vocabulary import AssignmentRole
from oncall.i18n import translate
from oncall.workdays import is_working_day, polish_holidays

REQUIRED_HEADERS = {"service_date", "role", "assignee_name"}
MAX_ROWS = 5000


def parse_history_csv(content: bytes) -> tuple[list[ParsedHistoryRow], list[HistoryImportError]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [HistoryImportError(None, None, translate("history.file_not_utf8"))]

    reader = csv.DictReader(io.StringIO(text))
    headers = {header.strip() for header in (reader.fieldnames or [])}
    missing = sorted(REQUIRED_HEADERS - headers)
    if missing:
        return [], [
            HistoryImportError(
                None, None, translate("history.columns_missing", columns=", ".join(missing))
            )
        ]

    rows: list[ParsedHistoryRow] = []
    errors: list[HistoryImportError] = []
    seen_slots: set[tuple[date, AssignmentRole]] = set()
    for row_number, raw in enumerate(reader, start=2):
        if row_number > MAX_ROWS + 1:
            errors.append(
                HistoryImportError(
                    None, None, translate("history.too_many_rows", max_rows=MAX_ROWS)
                )
            )
            break
        try:
            service_date = date.fromisoformat((raw.get("service_date") or "").strip())
        except ValueError:
            errors.append(
                HistoryImportError(row_number, "service_date", translate("history.date_format"))
            )
            continue
        try:
            role = AssignmentRole((raw.get("role") or "").strip())
        except ValueError:
            errors.append(HistoryImportError(row_number, "role", translate("history.role_allowed")))
            continue
        if role == AssignmentRole.late_shift:
            polish_days = polish_holidays(service_date, service_date)
            if not is_working_day(service_date, polish_days):
                errors.append(
                    HistoryImportError(
                        row_number, "role", translate("history.late_shift_working_days_only")
                    )
                )
                continue
        assignee_name = (raw.get("assignee_name") or "").strip()
        if not assignee_name:
            errors.append(
                HistoryImportError(
                    row_number, "assignee_name", translate("history.assignee_required")
                )
            )
            continue
        slot = (service_date, role)
        if slot in seen_slots:
            errors.append(
                HistoryImportError(row_number, "role", translate("history.duplicate_role"))
            )
            continue
        seen_slots.add(slot)
        rows.append(ParsedHistoryRow(row_number, service_date, role, assignee_name))
    if not rows and not errors:
        errors.append(HistoryImportError(None, None, translate("history.file_empty")))
    return rows, errors
