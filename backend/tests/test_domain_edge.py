"""How `routes/domain_edge.py` turns a business-rule failure into a response,
and what it does with one no endpoint mapped."""

import pytest
from fastapi import HTTPException

from oncall.domain.errors import DomainError, NotATeamMember, RecordedRefusal
from oncall.routes.domain_edge import (
    SHARED_ERROR_STATUSES,
    RecordedHttpException,
    domain_errors_as_http,
    http_error,
    refusals_as_http,
)


class _Refused(RecordedRefusal):
    def __init__(self) -> None:
        super().__init__("domain.not_a_team_member")


class _Unmapped(DomainError):
    def __init__(self) -> None:
        super().__init__("domain.not_a_team_member")


def test_an_error_is_answered_by_its_closest_mapped_ancestor() -> None:
    response = http_error(
        NotATeamMember(),
        {DomainError: 400, NotATeamMember: 403},
        details={DomainError: lambda error: {"kind": type(error).__name__}},
        headers={NotATeamMember: lambda _error: {"X-Reason": "member"}},
    )

    assert response is not None
    assert response.status_code == 403
    assert response.detail == {"kind": "NotATeamMember"}
    assert response.headers == {"X-Reason": "member"}


def test_an_unmapped_error_has_no_response() -> None:
    assert http_error(_Unmapped(), SHARED_ERROR_STATUSES) is None


def test_the_synchronous_edge_lets_an_unmapped_error_through_unchanged() -> None:
    error = _Unmapped()

    with pytest.raises(_Unmapped) as raised, domain_errors_as_http(SHARED_ERROR_STATUSES):
        raise error

    assert raised.value is error


def test_the_synchronous_edge_answers_a_mapped_error_with_its_message() -> None:
    with pytest.raises(HTTPException) as raised, domain_errors_as_http(SHARED_ERROR_STATUSES):
        raise NotATeamMember()

    assert raised.value.status_code == 403
    assert raised.value.detail == str(NotATeamMember())
    assert not isinstance(raised.value, RecordedHttpException)


async def test_the_refusal_edge_lets_an_unmapped_error_through_unchanged() -> None:
    error = _Unmapped()

    with pytest.raises(_Unmapped) as raised:
        async with refusals_as_http(None, SHARED_ERROR_STATUSES):
            raise error

    assert raised.value is error


async def test_a_recorded_refusal_is_answered_so_that_what_it_recorded_is_committed() -> None:
    with pytest.raises(HTTPException) as raised:
        async with refusals_as_http(
            None,
            {_Refused: 429},
            headers={_Refused: lambda _error: {"Retry-After": "60"}},
        ):
            raise _Refused()

    assert isinstance(raised.value, RecordedHttpException)
    assert raised.value.commit_transaction is True
    assert raised.value.status_code == 429
    assert raised.value.headers == {"Retry-After": "60"}


async def test_an_ordinary_refusal_commits_nothing() -> None:
    with pytest.raises(HTTPException) as raised:
        async with refusals_as_http(None, SHARED_ERROR_STATUSES):
            raise NotATeamMember()

    assert not isinstance(raised.value, RecordedHttpException)
    assert raised.value.status_code == 403
