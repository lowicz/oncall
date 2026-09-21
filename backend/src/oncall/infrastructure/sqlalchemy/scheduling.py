"""Composes each scheduling consumer's ports from the feature's persistence modules."""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.scheduling.ports import (
    DraftPorts,
    GenerationPorts,
    GenerationRequestPorts,
    PolicyPorts,
    PublicationPorts,
    ScheduleQueryPorts,
)
from oncall.infrastructure.solver import CpSatSolver
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.roster import SqlAlchemyPublishedRoster
from oncall.infrastructure.sqlalchemy.scheduling_changes import SqlAlchemyChangeLog
from oncall.infrastructure.sqlalchemy.scheduling_duty_history import SqlAlchemyDutyHistory
from oncall.infrastructure.sqlalchemy.scheduling_generation import (
    SqlAlchemyGenerationQueue,
    SqlAlchemyPolicyStore,
)
from oncall.infrastructure.sqlalchemy.scheduling_journal import SqlAlchemySchedulingJournal
from oncall.infrastructure.sqlalchemy.scheduling_publication import SqlAlchemyPublicationSwaps
from oncall.infrastructure.sqlalchemy.scheduling_schedules import SqlAlchemySchedules
from oncall.infrastructure.sqlalchemy.scheduling_team import SqlAlchemySchedulingTeam
from oncall.infrastructure.sqlalchemy.team import SqlAlchemyTeamDirectory


def schedule_query_ports(session: AsyncSession) -> ScheduleQueryPorts:
    return ScheduleQueryPorts(
        schedules=SqlAlchemySchedules(session),
        team=SqlAlchemyTeamDirectory(session),
        roster=SqlAlchemyPublishedRoster(session),
        changes=SqlAlchemyChangeLog(session),
        policy=SqlAlchemyPolicyStore(session),
        members=SqlAlchemySchedulingTeam(session),
        history=SqlAlchemyDutyHistory(session),
    )


def policy_ports(session: AsyncSession, actor: User) -> PolicyPorts:
    return PolicyPorts(
        policy=SqlAlchemyPolicyStore(session),
        journal=SqlAlchemySchedulingJournal(session, actor),
    )


def generation_request_ports(session: AsyncSession) -> GenerationRequestPorts:
    return GenerationRequestPorts(
        policy=SqlAlchemyPolicyStore(session),
        roster=SqlAlchemyPublishedRoster(session),
        queue=SqlAlchemyGenerationQueue(session),
    )


def generation_ports(session: AsyncSession, actor: User) -> GenerationPorts:
    return GenerationPorts(
        policy=SqlAlchemyPolicyStore(session),
        members=SqlAlchemySchedulingTeam(session),
        history=SqlAlchemyDutyHistory(session),
        solver=CpSatSolver(),
        drafts=SqlAlchemySchedules(session),
        journal=SqlAlchemySchedulingJournal(session, actor),
    )


def draft_ports(session: AsyncSession, actor: User) -> DraftPorts:
    return DraftPorts(
        schedules=SqlAlchemySchedules(session),
        team=SqlAlchemyTeamDirectory(session),
        journal=SqlAlchemySchedulingJournal(session, actor),
    )


def publication_ports(session: AsyncSession, actor: User | None = None) -> PublicationPorts:
    """The preview reads through the same ports as publishing, and writes
    nothing, so it composes them with no actor."""
    return PublicationPorts(
        schedules=SqlAlchemySchedules(session),
        roster=SqlAlchemyPublishedRoster(session),
        team=SqlAlchemyTeamDirectory(session),
        policy=SqlAlchemyPolicyStore(session),
        changes=SqlAlchemyChangeLog(session),
        swaps=SqlAlchemyPublicationSwaps(session),
        members=SqlAlchemySchedulingTeam(session),
        journal=SqlAlchemySchedulingJournal(session, actor),
    )
