"""Reading and changing the scheduling policy."""

from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import PolicyChange, SchedulingPolicy
from oncall.domain.scheduling.ports import CurrentPolicy, PolicyPorts


async def current_policy(policy: CurrentPolicy) -> SchedulingPolicy:
    return await policy.current()


async def change_policy(change: PolicyChange, ports: PolicyPorts) -> SchedulingPolicy:
    current = await ports.policy.current()
    weights = (
        current.fairness_weight if change.fairness_weight is None else change.fairness_weight,
        current.continuity_weight if change.continuity_weight is None else change.continuity_weight,
        current.preference_weight if change.preference_weight is None else change.preference_weight,
    )
    if not any(weights):
        raise errors.PolicyWithoutWeight()
    policy = await ports.policy.change(change)
    await ports.journal.policy_updated(policy)
    return policy
