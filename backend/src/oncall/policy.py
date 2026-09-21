"""The single scheduling policy row, shared by the generator and the reports.

The fairness report and the draft impact preview both describe the policy's
semantics to their readers (for example whether the 11-19 shift is balanced
on its own), so the row is loaded through one helper - a second copy of the
get-or-create logic would drift.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.config import get_settings
from oncall.domain.vocabulary import RotationMode
from oncall.infrastructure.sqlalchemy.scheduling_models import SchedulingPolicy


async def load_policy(db: AsyncSession) -> SchedulingPolicy:
    """The one policy row, created with defaults on first use."""
    policy = await db.scalar(select(SchedulingPolicy).limit(1))
    if policy is None:
        policy = SchedulingPolicy(
            rotation_mode=RotationMode.hybrid,
            solve_seconds=get_settings().solver_seconds,
        )
        db.add(policy)
        await db.commit()
        await db.refresh(policy)
    return policy
