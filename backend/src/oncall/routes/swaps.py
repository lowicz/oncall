"""HTTP adapter for the swap use cases in `oncall.domain.swaps`."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from oncall.auth import CsrfGuard, CurrentUser
from oncall.bootstrap.providers import SwapProvider
from oncall.domain.swaps import errors, use_cases
from oncall.domain.swaps.models import (
    ReplacementOptionsQuery,
    SwapAutoCancelled,
    SwapDecisionInput,
    SwapImpactQuery,
    SwapListQuery,
    SwapRequestInput,
    SwapRequestView,
)
from oncall.domain.vocabulary import AssignmentRole, SwapStatus, UserRole
from oncall.fairness_data import member_response
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.rules import rule_violation_responses
from oncall.presentation.swaps import (
    SwapDecisionRequest,
    SwapImpactMemberResponse,
    SwapImpactResponse,
    SwapOptionResponse,
    SwapPolicyResponse,
    SwapRequestCreate,
    SwapRequestResponse,
    swap_option_response,
    swap_policy_response,
    swap_response,
)
from oncall.routes.domain_edge import (
    SHARED_ERROR_STATUSES,
    RecordedHttpException,
    actor_from,
    domain_errors_as_http,
)

router = APIRouter(
    prefix="/api/v1/swaps",
    tags=["swaps"],
    dependencies=[Depends(require_roles(UserRole.member, UserRole.coordinator, UserRole.admin))],
)
Coordinator = Annotated[User, Depends(require_roles(UserRole.coordinator, UserRole.admin))]

SWAP_ERROR_STATUSES = {
    **SHARED_ERROR_STATUSES,
    errors.SwapInThePast: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.SlotNotPublished: status.HTTP_404_NOT_FOUND,
    errors.SlotNotYours: status.HTTP_409_CONFLICT,
    errors.ReplacementNotEligible: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.CannotSwapWithYourself: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.ReplacementHasNoAccount: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.ReplacementUnavailable: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.ReplacementAlreadyOnCall: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.ReplacementOnCallSinceRequest: status.HTTP_409_CONFLICT,
    errors.SlotHasActiveSwap: status.HTTP_409_CONFLICT,
    errors.SwapBreaksHardRules: status.HTTP_409_CONFLICT,
    errors.SwapNotFound: status.HTTP_404_NOT_FOUND,
    errors.OnlyNamedReplacementMayAccept: status.HTTP_403_FORBIDDEN,
    errors.OnlyNamedReplacementMayReject: status.HTTP_403_FORBIDDEN,
    errors.OnlyCoordinatorMayRejectAccepted: status.HTTP_403_FORBIDDEN,
    errors.OnlyRequesterMayCancel: status.HTTP_403_FORBIDDEN,
    errors.SwapNotAwaitingReplacement: status.HTTP_409_CONFLICT,
    errors.SwapNotAwaitingCoordinator: status.HTTP_409_CONFLICT,
    errors.SwapNoLongerRejectable: status.HTTP_409_CONFLICT,
    errors.SwapNoLongerCancellable: status.HTTP_409_CONFLICT,
    errors.DecisionReasonRequired: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.SwapPartiesGone: status.HTTP_409_CONFLICT,
    errors.SelfApprovalNotAllowed: status.HTTP_403_FORBIDDEN,
    errors.ScheduleChangedSinceRequest: status.HTTP_409_CONFLICT,
    errors.PointsHiddenFromViewers: status.HTTP_403_FORBIDDEN,
    errors.ReplacementNotFound: status.HTTP_404_NOT_FOUND,
    errors.NoPublicationForDay: status.HTTP_404_NOT_FOUND,
    errors.SlotHasNoPublishedDuty: status.HTTP_404_NOT_FOUND,
    errors.SlotHolderNotATeamMember: status.HTTP_409_CONFLICT,
    errors.OnlyOwnSwapsPreview: status.HTTP_403_FORBIDDEN,
    errors.NoBalanceInWindow: status.HTTP_409_CONFLICT,
}


def _rule_violations_detail(error: errors.SwapBreaksHardRules) -> dict:
    return {
        "message": str(error),
        "next_step": error.next_step,
        "violations": [
            {
                "rule": violation.rule,
                "message": violation.message,
                "member_name": violation.member_name,
                "days": [day.isoformat() for day in violation.days],
            }
            for violation in error.violations
        ],
    }


SWAP_ERROR_DETAILS = {errors.SwapBreaksHardRules: _rule_violations_detail}


def _swap_errors_as_http():
    return domain_errors_as_http(SWAP_ERROR_STATUSES, SWAP_ERROR_DETAILS)


def _handed_over(outcome: SwapRequestView | SwapAutoCancelled) -> SwapRequestResponse:
    """A hand-over that found the slot in someone else's hands cancelled the
    request; that cancellation is kept, so it is reported, not rolled back."""
    if isinstance(outcome, SwapAutoCancelled):
        raise RecordedHttpException(status.HTTP_409_CONFLICT, errors.SLOT_CHANGED_OWNER_MESSAGE)
    return swap_response(outcome)


@router.get("/policy", response_model=SwapPolicyResponse)
async def swap_policy(_: CurrentUser, ports: SwapProvider) -> SwapPolicyResponse:
    """Whether a request the replacement accepts still waits for a
    coordinator. Readable by every signed-in member: the swap screens word the
    next step from it."""
    return swap_policy_response(await use_cases.swap_policy(ports))


@router.get("/options", response_model=list[SwapOptionResponse])
async def replacement_options(
    user: CurrentUser,
    ports: SwapProvider,
    service_date: Annotated[date, Query()],
    role: Annotated[AssignmentRole, Query()],
) -> list[SwapOptionResponse]:
    with _swap_errors_as_http():
        options = await use_cases.list_replacement_options(
            ReplacementOptionsQuery(actor_from(user), service_date, role), ports
        )
    return [swap_option_response(option) for option in options]


@router.get("/impact", response_model=SwapImpactResponse)
async def swap_impact(
    user: CurrentUser,
    ports: SwapProvider,
    service_date: Annotated[date, Query()],
    role: Annotated[AssignmentRole, Query()],
    replacement_member_id: Annotated[uuid.UUID, Query()],
) -> SwapImpactResponse:
    # The document this docstring cites now lives in archive/docs/PLAN.md. The
    # path is left as written because FastAPI publishes this docstring as the
    # endpoint's OpenAPI description, which contracts/openapi.json pins:
    # correcting it here would change the published contract over a comment.
    """What this swap would do to both people's balance.

    docs/PLAN.md §4 puts a points preview between choosing a replacement and
    sending the request. Nothing is written; the projection reuses the same
    12-month window as the fairness report so the two never disagree.
    """
    with _swap_errors_as_http():
        impact = await use_cases.preview_swap_impact(
            SwapImpactQuery(actor_from(user), service_date, role, replacement_member_id),
            ports,
        )

    def side(item) -> SwapImpactMemberResponse:
        return SwapImpactMemberResponse(
            member_id=item.member_id,
            display_name=item.display_name,
            before=member_response(item.before),
            after=member_response(item.after),
        )

    return SwapImpactResponse(
        service_date=impact.service_date,
        role=impact.role,
        points=impact.points,
        window_start=impact.window_start,
        window_end=impact.window_end,
        requester=side(impact.requester),
        replacement=side(impact.replacement),
        warnings=rule_violation_responses(impact.warnings),
    )


@router.get("", response_model=list[SwapRequestResponse])
async def list_swaps(
    user: CurrentUser,
    ports: SwapProvider,
    status_in: Annotated[list[SwapStatus] | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SwapRequestResponse]:
    """Newest first. The list is filterable and paged because resolved requests
    accumulate forever and would otherwise bury the ones needing action."""
    with _swap_errors_as_http():
        views = await use_cases.list_swap_requests(
            SwapListQuery(actor_from(user), tuple(status_in or ()), limit, offset),
            ports,
        )
    return [swap_response(view) for view in views]


@router.post("", response_model=SwapRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_swap(
    payload: SwapRequestCreate, user: CurrentUser, ports: SwapProvider, _: CsrfGuard
) -> SwapRequestResponse:
    # `payload.schedule_id` is deliberately not passed on: the use case resolves
    # which publication owns the slot from the roster in force.
    with _swap_errors_as_http():
        view = await use_cases.request_swap(
            SwapRequestInput(
                actor=actor_from(user),
                service_date=payload.service_date,
                role=payload.role,
                replacement_member_id=payload.replacement_member_id,
                note=payload.note,
            ),
            ports,
        )
    return swap_response(view)


@router.post("/{swap_id}/accept", response_model=SwapRequestResponse)
async def accept_swap(
    swap_id: uuid.UUID, user: CurrentUser, ports: SwapProvider, _: CsrfGuard
) -> SwapRequestResponse:
    with _swap_errors_as_http():
        outcome = await use_cases.accept_swap(SwapDecisionInput(actor_from(user), swap_id), ports)
    return _handed_over(outcome)


@router.post("/{swap_id}/reject", response_model=SwapRequestResponse)
async def reject_swap(
    swap_id: uuid.UUID,
    payload: SwapDecisionRequest,
    user: CurrentUser,
    ports: SwapProvider,
    _: CsrfGuard,
) -> SwapRequestResponse:
    with _swap_errors_as_http():
        view = await use_cases.reject_swap(
            SwapDecisionInput(actor_from(user), swap_id, payload.reason), ports
        )
    return swap_response(view)


@router.post("/{swap_id}/cancel", response_model=SwapRequestResponse)
async def cancel_swap(
    swap_id: uuid.UUID,
    payload: SwapDecisionRequest,
    user: CurrentUser,
    ports: SwapProvider,
    _: CsrfGuard,
) -> SwapRequestResponse:
    with _swap_errors_as_http():
        view = await use_cases.cancel_swap(
            SwapDecisionInput(actor_from(user), swap_id, payload.reason), ports
        )
    return swap_response(view)


@router.post("/{swap_id}/approve", response_model=SwapRequestResponse)
async def approve_swap(
    swap_id: uuid.UUID, user: Coordinator, ports: SwapProvider, __: CsrfGuard
) -> SwapRequestResponse:
    with _swap_errors_as_http():
        outcome = await use_cases.approve_swap(SwapDecisionInput(actor_from(user), swap_id), ports)
    return _handed_over(outcome)
