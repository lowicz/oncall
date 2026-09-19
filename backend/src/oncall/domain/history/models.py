import uuid
from dataclasses import dataclass
from datetime import date, datetime

from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole

#: Every import is stored as a retired schedule named with this prefix, which
#: is how duty resolution tells imported history from real publications.
IMPORT_NAME_PREFIX = "Import historii: "


@dataclass(frozen=True)
class ParsedHistoryRow:
    row_number: int
    service_date: date
    role: AssignmentRole
    assignee_name: str


@dataclass(frozen=True)
class HistoryImportError:
    row_number: int | None
    field: str | None
    message: str


@dataclass(frozen=True)
class HistoryUpload:
    actor: Actor
    filename: str
    #: Rows as sent; their numbers are recounted from 2, as in the file.
    rows: list[ParsedHistoryRow]


@dataclass(frozen=True)
class ImportedDuty:
    service_date: date
    role: AssignmentRole
    assignee_name: str
    member_id: uuid.UUID | None


@dataclass(frozen=True)
class NewHistoryImport:
    name: str
    starts_on: date
    ends_on: date
    published_at: datetime
    duties: list[ImportedDuty]


@dataclass(frozen=True)
class HistoryImport:
    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    rows: int
    created_at: datetime | None
