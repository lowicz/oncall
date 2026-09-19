"""Administration endpoints for accounts, rotation, eligibility and audit."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import AdminProvider, AuditProvider
from oncall.config import get_settings
from oncall.domain.admin import errors, use_cases
from oncall.domain.admin.models import (
    Account,
    AccountAction,
    AccountChange,
    AuditQuery,
    EligibilityChange,
    EligibilityGrant,
    EligibilityRevocation,
    Enrolment,
    MembershipChange,
    NewAccount,
)
from oncall.domain.vocabulary import UserRole
from oncall.models import User
from oncall.permissions import require_roles
from oncall.presentation.admin import (
    AdminUserCreate,
    AdminUserCreatedResponse,
    AdminUserResponse,
    AdminUserUpdate,
    AuditEventResponse,
    EligibilityCreate,
    EligibilityResponse,
    EligibilityUpdate,
    PasswordLinkResponse,
    TeamMemberCreate,
    TeamMemberResponse,
    TeamMemberUpdate,
)
from oncall.routes.domain_edge import actor_from, domain_errors_as_http

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
Admin = Annotated[User, Depends(require_roles(UserRole.admin))]

ADMIN_ERROR_STATUSES = {
    errors.AccountNotFound: status.HTTP_404_NOT_FOUND,
    errors.RotationMemberNotFound: status.HTTP_404_NOT_FOUND,
    errors.EligibilityNotFound: status.HTTP_404_NOT_FOUND,
    errors.FirstNameRequired: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.AdminConflict: status.HTTP_409_CONFLICT,
}


def account_url(path: str, raw_token: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/{path}?token={raw_token}"


def _admin_errors():
    return domain_errors_as_http(ADMIN_ERROR_STATUSES)


async def _stored_account(ports: AdminProvider, account: Account) -> AdminUserResponse:
    return AdminUserResponse.model_validate(await ports.accounts.account(account.id))


async def _stored_member(ports: AdminProvider, member_id: uuid.UUID) -> TeamMemberResponse:
    return TeamMemberResponse.model_validate(await ports.rotation.member(member_id))


async def _stored_period(ports: AdminProvider, eligibility_id: uuid.UUID) -> EligibilityResponse:
    return EligibilityResponse.model_validate(await ports.rotation.period(eligibility_id))


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(_: Admin, ports: AdminProvider) -> list[AdminUserResponse]:
    accounts = await use_cases.list_accounts(ports.accounts)
    return [AdminUserResponse.model_validate(account) for account in accounts]


@router.post("/users", response_model=AdminUserCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: AdminUserCreate, actor: Admin, ports: AdminProvider, _: CsrfGuard
) -> AdminUserCreatedResponse:
    with _admin_errors():
        created = await use_cases.create_account(
            NewAccount(
                actor=actor_from(actor),
                username=payload.username,
                personnel_number=payload.personnel_number,
                first_name=payload.first_name,
                last_name=payload.last_name,
                email=str(payload.email) if payload.email else None,
                phone=payload.phone,
                role=payload.role,
            ),
            ports,
        )
    return AdminUserCreatedResponse(
        user=await _stored_account(ports, created.account),
        activation_url=account_url("activate", created.activation.raw),
    )


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    actor: Admin,
    ports: AdminProvider,
    _: CsrfGuard,
) -> AdminUserResponse:
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("email") is not None:
        changes["email"] = str(changes["email"])
    with _admin_errors():
        account = await use_cases.update_account(
            AccountChange(actor=actor_from(actor), account_id=user_id, changes=changes),
            ports,
        )
    return await _stored_account(ports, account)


@router.post("/users/{user_id}/reset", response_model=PasswordLinkResponse)
async def issue_password_reset(
    user_id: uuid.UUID, actor: Admin, ports: AdminProvider, _: CsrfGuard
) -> PasswordLinkResponse:
    with _admin_errors():
        token = await use_cases.issue_password_reset(
            AccountAction(actor=actor_from(actor), account_id=user_id), ports
        )
    return PasswordLinkResponse(url=account_url("reset", token.raw), expires_at=token.expires_at)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, actor: Admin, ports: AdminProvider, _: CsrfGuard) -> None:
    with _admin_errors():
        await use_cases.delete_account(
            AccountAction(actor=actor_from(actor), account_id=user_id), ports
        )


@router.post(
    "/team-members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED
)
async def create_team_member(
    payload: TeamMemberCreate, actor: Admin, ports: AdminProvider, _: CsrfGuard
) -> TeamMemberResponse:
    with _admin_errors():
        member = await use_cases.enrol_in_rotation(
            Enrolment(
                actor=actor_from(actor), account_id=payload.user_id, active_from=payload.active_from
            ),
            ports,
        )
    return await _stored_member(ports, member.id)


@router.patch("/team-members/{member_id}", response_model=TeamMemberResponse)
async def update_team_member(
    member_id: uuid.UUID,
    payload: TeamMemberUpdate,
    actor: Admin,
    ports: AdminProvider,
    _: CsrfGuard,
) -> TeamMemberResponse:
    with _admin_errors():
        member = await use_cases.change_membership(
            MembershipChange(
                actor=actor_from(actor),
                member_id=member_id,
                changes=payload.model_dump(exclude_unset=True),
            ),
            ports,
        )
    return await _stored_member(ports, member.id)


@router.post(
    "/team-members/{member_id}/eligibility",
    response_model=EligibilityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_eligibility(
    member_id: uuid.UUID,
    payload: EligibilityCreate,
    actor: Admin,
    ports: AdminProvider,
    _: CsrfGuard,
) -> EligibilityResponse:
    with _admin_errors():
        period = await use_cases.grant_eligibility(
            EligibilityGrant(
                actor=actor_from(actor),
                member_id=member_id,
                role=payload.role,
                starts_on=payload.starts_on,
                ends_on=payload.ends_on,
            ),
            ports,
        )
    return await _stored_period(ports, period.id)


@router.patch("/eligibility/{eligibility_id}", response_model=EligibilityResponse)
async def update_eligibility(
    eligibility_id: uuid.UUID,
    payload: EligibilityUpdate,
    actor: Admin,
    ports: AdminProvider,
    _: CsrfGuard,
) -> EligibilityResponse:
    with _admin_errors():
        period = await use_cases.change_eligibility(
            EligibilityChange(
                actor=actor_from(actor),
                eligibility_id=eligibility_id,
                changes=payload.model_dump(exclude_unset=True),
            ),
            ports,
        )
    return await _stored_period(ports, period.id)


@router.delete("/eligibility/{eligibility_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_eligibility(
    eligibility_id: uuid.UUID, actor: Admin, ports: AdminProvider, _: CsrfGuard
) -> None:
    with _admin_errors():
        await use_cases.revoke_eligibility(
            EligibilityRevocation(actor=actor_from(actor), eligibility_id=eligibility_id),
            ports,
        )


@router.get("/audit", response_model=list[AuditEventResponse])
async def list_audit_events(
    _: Admin,
    audit: AuditProvider,
    response: Response,
    action: Annotated[str | None, Query(max_length=60)] = None,
    entity_type: Annotated[str | None, Query(max_length=40)] = None,
    actor: Annotated[str | None, Query(max_length=160)] = None,
    query_text: Annotated[str | None, Query(alias="q", max_length=160)] = None,
    starts_on: Annotated[date | None, Query()] = None,
    ends_on: Annotated[date | None, Query()] = None,
    include_logins: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AuditEventResponse]:
    page = await use_cases.browse_audit(
        AuditQuery(
            action=action,
            entity_type=entity_type,
            actor=actor,
            text=query_text,
            starts_on=starts_on,
            ends_on=ends_on,
            include_logins=include_logins,
            limit=limit,
            offset=offset,
        ),
        audit,
    )
    # Keep the established JSON list contract, but make the exclusion explicit
    # to API clients. This matters especially for free-text/actor searches
    # which can otherwise return an unexplained empty list even though
    # matching login events exist (MED-06).
    response.headers["X-Oncall-Logins-Excluded"] = "true" if page.logins_excluded else "false"
    return [AuditEventResponse.model_validate(entry) for entry in page.entries]
