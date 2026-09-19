"""HTTP adapter for the availability use cases in `oncall.domain.availability`."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import AvailabilityReader, AvailabilityWriter
from oncall.domain.availability import errors, use_cases
from oncall.domain.availability.models import (
    AvailabilityDeclaration,
    AvailabilityQuery,
    AvailabilityWithdrawal,
    MemberById,
    MemberRef,
    OwnMember,
)
from oncall.domain.availability.ports import AvailabilityReadPorts, AvailabilityWritePorts
from oncall.models import User, UserRole
from oncall.permissions import require_roles
from oncall.presentation.availability import (
    AvailabilityCreate,
    AvailabilityResponse,
    availability_response,
)
from oncall.routes.domain_edge import SHARED_ERROR_STATUSES, actor_from, domain_errors_as_http

router = APIRouter(prefix="/api/v1/availability", tags=["availability"])
MemberUser = Annotated[
    User,
    Depends(require_roles(UserRole.member, UserRole.coordinator, UserRole.admin)),
]
#: On-behalf-of filing is a coordinator responsibility, not a member one: a
#: member editing another member's availability would be filing unverifiable
#: claims about a colleague. Viewer is already excluded by role.
CoordinatorUser = Annotated[
    User,
    Depends(require_roles(UserRole.coordinator, UserRole.admin)),
]

AVAILABILITY_ERROR_STATUSES = {
    **SHARED_ERROR_STATUSES,
    errors.TeamMemberNotFound: status.HTTP_404_NOT_FOUND,
    errors.AvailabilityRangeReversed: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.AvailabilityRangeTooLong: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.AvailabilityInThePast: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.AvailabilityAlreadyExists: status.HTTP_409_CONFLICT,
    errors.AvailabilityOverlaps: status.HTTP_409_CONFLICT,
    errors.AvailabilityEntryNotFound: status.HTTP_404_NOT_FOUND,
}


async def _list(
    user: User,
    member: MemberRef,
    ports: AvailabilityReadPorts,
    starts_on: date | None,
    ends_on: date | None,
) -> list[AvailabilityResponse]:
    with domain_errors_as_http(AVAILABILITY_ERROR_STATUSES):
        result = await use_cases.list_availability(
            AvailabilityQuery(actor_from(user), member, starts_on, ends_on), ports
        )
    return [availability_response(entry, result.member) for entry in result.entries]


async def _create(
    user: User,
    member: MemberRef,
    payload: AvailabilityCreate,
    ports: AvailabilityWritePorts,
) -> AvailabilityResponse:
    with domain_errors_as_http(AVAILABILITY_ERROR_STATUSES):
        declared = await use_cases.declare_availability(
            AvailabilityDeclaration(
                actor=actor_from(user),
                member=member,
                kind=payload.kind,
                starts_on=payload.starts_on,
                ends_on=payload.ends_on,
                note=payload.note,
            ),
            ports,
        )
    return availability_response(declared.entry, declared.member, declared.warning)


async def _delete(
    user: User, member: MemberRef, entry_id: uuid.UUID, ports: AvailabilityWritePorts
) -> None:
    with domain_errors_as_http(AVAILABILITY_ERROR_STATUSES):
        await use_cases.withdraw_availability(
            AvailabilityWithdrawal(actor_from(user), member, entry_id), ports
        )


@router.get("/me", response_model=list[AvailabilityResponse])
async def list_my_availability(
    user: MemberUser,
    ports: AvailabilityReader,
    starts_on: Annotated[date | None, Query()] = None,
    ends_on: Annotated[date | None, Query()] = None,
) -> list[AvailabilityResponse]:
    return await _list(user, OwnMember(), ports, starts_on, ends_on)


@router.post("/me", response_model=AvailabilityResponse, status_code=status.HTTP_201_CREATED)
async def create_my_availability(
    payload: AvailabilityCreate, user: MemberUser, ports: AvailabilityWriter, _: CsrfGuard
) -> AvailabilityResponse:
    return await _create(user, OwnMember(), payload, ports)


@router.delete("/me/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_availability(
    entry_id: uuid.UUID, user: MemberUser, ports: AvailabilityWriter, _: CsrfGuard
) -> None:
    await _delete(user, OwnMember(), entry_id, ports)


@router.get("/members/{member_id}", response_model=list[AvailabilityResponse])
async def list_member_availability(
    member_id: uuid.UUID,
    user: CoordinatorUser,
    ports: AvailabilityReader,
    starts_on: Annotated[date | None, Query()] = None,
    ends_on: Annotated[date | None, Query()] = None,
) -> list[AvailabilityResponse]:
    return await _list(user, MemberById(member_id), ports, starts_on, ends_on)


@router.post(
    "/members/{member_id}",
    response_model=AvailabilityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_member_availability(
    member_id: uuid.UUID,
    payload: AvailabilityCreate,
    user: CoordinatorUser,
    ports: AvailabilityWriter,
    _: CsrfGuard,
) -> AvailabilityResponse:
    return await _create(user, MemberById(member_id), payload, ports)


@router.delete("/members/{member_id}/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member_availability(
    member_id: uuid.UUID,
    entry_id: uuid.UUID,
    user: CoordinatorUser,
    ports: AvailabilityWriter,
    _: CsrfGuard,
) -> None:
    await _delete(user, MemberById(member_id), entry_id, ports)
