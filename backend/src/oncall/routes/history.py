import uuid
from datetime import date, datetime
from typing import Annotated, TypedDict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import HistoryReader, HistoryWriter
from oncall.domain.history import use_cases
from oncall.domain.history.errors import HistoryRejected
from oncall.domain.history.models import HistoryImportError, HistoryUpload, ParsedHistoryRow
from oncall.domain.vocabulary import UserRole
from oncall.history_import import parse_history_csv
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.history import (
    HistoryCommitRequest,
    HistoryCommitResponse,
    HistoryImportErrorResponse,
    HistoryImportPreviewResponse,
    HistoryImportRow,
)
from oncall.routes.domain_edge import actor_from, domain_errors_as_http

router = APIRouter(prefix="/api/v1/history", tags=["history"])
HistoryManager = Annotated[User, Depends(require_roles(UserRole.coordinator, UserRole.admin))]
MAX_FILE_BYTES = 1024 * 1024


class HistoryImportSummaryResponse(TypedDict):
    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    rows: int
    created_at: datetime | None


HISTORY_ERROR_STATUSES = {HistoryRejected: status.HTTP_422_UNPROCESSABLE_CONTENT}
HISTORY_ERROR_DETAILS = {
    HistoryRejected: lambda error: [
        _error_response(problem).model_dump() for problem in error.problems
    ]
}


def _error_response(error: HistoryImportError) -> HistoryImportErrorResponse:
    return HistoryImportErrorResponse(**error.__dict__)


@router.get("/imports", response_model=list[dict])
async def list_history_imports(
    _: HistoryManager, ports: HistoryReader
) -> list[HistoryImportSummaryResponse]:
    return [
        {
            "id": item.id,
            "name": item.name,
            "starts_on": item.starts_on,
            "ends_on": item.ends_on,
            "rows": item.rows,
            "created_at": item.created_at,
        }
        for item in await use_cases.list_history_imports(ports)
    ]


@router.post("/preview", response_model=HistoryImportPreviewResponse)
async def preview_history(
    _: HistoryManager,
    ports: HistoryReader,
    __: CsrfGuard,
    file: Annotated[UploadFile, File()],
) -> HistoryImportPreviewResponse:
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Plik przekracza 1 MB")
    rows, errors = parse_history_csv(content)
    errors.extend(await use_cases.check_history(rows, ports))
    return HistoryImportPreviewResponse(
        filename=file.filename or "history.csv",
        valid=not errors,
        rows=[HistoryImportRow(**row.__dict__) for row in rows],
        errors=[_error_response(error) for error in errors],
    )


@router.post("/commit", response_model=HistoryCommitResponse, status_code=status.HTTP_201_CREATED)
async def commit_history(
    payload: HistoryCommitRequest,
    user: HistoryManager,
    ports: HistoryWriter,
    __: CsrfGuard,
) -> HistoryCommitResponse:
    with domain_errors_as_http(HISTORY_ERROR_STATUSES, HISTORY_ERROR_DETAILS):
        schedule_id = await use_cases.import_history(
            HistoryUpload(
                actor=actor_from(user),
                filename=payload.filename,
                rows=[
                    ParsedHistoryRow(0, row.service_date, row.role, row.assignee_name)
                    for row in payload.rows
                ],
            ),
            ports,
        )
    return HistoryCommitResponse(schedule_id=schedule_id, imported_rows=len(payload.rows))
