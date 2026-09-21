from typing import Annotated

from fastapi import APIRouter, Depends

from oncall.bootstrap.providers import TeamProvider
from oncall.domain.admin.use_cases import list_rotation
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.admin import TeamMemberResponse

router = APIRouter(prefix="/api/v1/team", tags=["team"])
TeamReader = Annotated[
    User,
    Depends(require_roles(UserRole.member, UserRole.coordinator, UserRole.admin)),
]


@router.get("", response_model=list[TeamMemberResponse])
async def list_team(_: TeamReader, rotation: TeamProvider) -> list[TeamMemberResponse]:
    members = await list_rotation(rotation)
    return [TeamMemberResponse.model_validate(member) for member in members]
