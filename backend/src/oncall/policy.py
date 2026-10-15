"""The single scheduling policy row, shared by the generator and the reports.

The fairness report and the draft impact preview both describe the policy's
semantics to their readers (for example whether the 11-19 shift is balanced
on its own), so the row is loaded through one helper - a second copy of the
get-or-create logic would drift.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.infrastructure.sqlalchemy.base import load_singleton
from oncall.infrastructure.sqlalchemy.scheduling_models import SchedulingPolicy


async def load_policy(db: AsyncSession) -> SchedulingPolicy:
    """The one policy row, created with defaults on first use.

    Migrations insert the row, so on a deployed database this only reads it.
    Every field, the solver budget included, is edited in the application;
    no environment variable seeds or overrides it.
    """
    return await load_singleton(db, SchedulingPolicy)
