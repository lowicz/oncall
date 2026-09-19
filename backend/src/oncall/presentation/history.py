"""HTTP contracts for previewing and committing an imported duty history."""

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from oncall.domain.vocabulary import AssignmentRole


class HistoryImportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_number: int | None = None
    service_date: date
    role: AssignmentRole
    assignee_name: str = Field(min_length=1, max_length=160)


class HistoryImportErrorResponse(BaseModel):
    row_number: int | None
    field: str | None
    message: str


class HistoryImportPreviewResponse(BaseModel):
    filename: str
    valid: bool
    rows: list[HistoryImportRow]
    errors: list[HistoryImportErrorResponse]


class HistoryCommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    rows: list[HistoryImportRow] = Field(min_length=1, max_length=5000)


class HistoryCommitResponse(BaseModel):
    schedule_id: uuid.UUID
    imported_rows: int


__all__ = [
    "HistoryCommitRequest",
    "HistoryCommitResponse",
    "HistoryImportErrorResponse",
    "HistoryImportPreviewResponse",
    "HistoryImportRow",
]
