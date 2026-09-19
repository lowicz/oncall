"""Composes the scheduling ports from the feature's persistence modules."""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.scheduling.ports import SchedulingPorts
from oncall.infrastructure.solver import CpSatSolver
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
from oncall.models import User


def scheduling_ports(session: AsyncSession, actor: User | None = None) -> SchedulingPorts:
    return SchedulingPorts(
        schedules=SqlAlchemySchedules(session),
        roster=SqlAlchemyPublishedRoster(session),
        team=SqlAlchemyTeamDirectory(session),
        policy=SqlAlchemyPolicyStore(session),
        changes=SqlAlchemyChangeLog(session),
        journal=SqlAlchemySchedulingJournal(session, actor),
        swaps=SqlAlchemyPublicationSwaps(session),
        queue=SqlAlchemyGenerationQueue(session),
        members=SqlAlchemySchedulingTeam(session),
        history=SqlAlchemyDutyHistory(session),
        solver=CpSatSolver(),
    )
