"""Dump the CP-SAT model proto for a fixed matrix of inputs.

Refactoring the model builder may not change the model. The proto carries every
variable, its name and its creation order, so a byte-identical dump before and
after a refactor is proof that no structure moved - a stronger statement than
the fixed-seed tests make, since those only observe solutions.

Usage: dump into one directory, refactor, dump into another, `diff -r` them.

    uv run python scripts/model_proto_dump.py /tmp/before
    uv run python scripts/model_proto_dump.py /tmp/after
    diff -r /tmp/before /tmp/after

The matrix covers every rotation mode crossed with both spacing settings,
because the objective families are gated on opposite modes, plus the pass
shapes generation actually builds: an acceptance cap and the fairness-only
floor probe. Extend it whenever a slice touches a branch it does not reach.
"""

import sys
from datetime import date, timedelta

from oncall.domain.scheduling.solver import PreferenceRange
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode
from oncall.scheduler import DateRange, SolverMember, _build_model
from oncall.workdays import polish_holidays

STARTS = date(2026, 11, 2)
ENDS = date(2026, 11, 29)
HOLIDAYS = polish_holidays(STARTS - timedelta(days=365), ENDS)


def _member(name: str, preferences: tuple[PreferenceRange, ...] = ()) -> SolverMember:
    active = DateRange(date(2025, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=preferences,
    )


def _plain_members() -> list[SolverMember]:
    return [_member(n) for n in ("Anna", "Bartek", "Cezary", "Dora", "Ewa")]


def _one_late_shift_member() -> list[SolverMember]:
    """A roster where only one person may take 11-19.

    A lens fewer than two people compete for is dropped rather than levelled,
    and that skip is the one behavioural branch in lens construction. Every
    other case here has all five members eligible everywhere, so nothing else
    reaches it.
    """
    active = DateRange(date(2025, 1, 1), None)
    oncall_only = {role: (active,) for role in AssignmentRole if role != AssignmentRole.late_shift}
    members = [_member(n) for n in ("Anna", "Bartek", "Cezary", "Dora", "Ewa")]
    return [
        members[0],
        *(
            SolverMember(
                name=member.name,
                active=member.active,
                eligibility=oncall_only,
                preferences=member.preferences,
            )
            for member in members[1:]
        ),
    ]


def _opinionated_members() -> list[SolverMember]:
    return [
        _member(
            "Anna",
            (
                PreferenceRange(date(2026, 11, 5), date(2026, 11, 5), AvailabilityKind.unavailable),
                PreferenceRange(date(2026, 11, 6), date(2026, 11, 6), AvailabilityKind.prefer_not),
            ),
        ),
        _member(
            "Bartek",
            (PreferenceRange(date(2026, 11, 9), date(2026, 11, 9), AvailabilityKind.prefer),),
        ),
        _member(
            "Cezary",
            (
                PreferenceRange(
                    date(2026, 11, 14), date(2026, 11, 14), AvailabilityKind.unavailable
                ),
            ),
        ),
        _member(
            "Dora",
            (PreferenceRange(date(2026, 11, 20), date(2026, 11, 20), AvailabilityKind.prefer_not),),
        ),
        _member("Ewa"),
    ]


def _case(
    label: str,
    *,
    mode: RotationMode,
    spacing: bool,
    members: list[SolverMember],
    anchor: LateShiftAnchor = LateShiftAnchor.secondary,
    prior_oncall: dict[str, set[date]] | None = None,
    acceptance_cap: int | None = None,
    fairness_only: bool = False,
    fairness_bound: int | None = None,
) -> tuple[str, str]:
    model, variables, conflicts, lenses = _build_model(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=mode,
        members=members,
        historical_points={
            ("Anna", AssignmentRole.primary): 40.0,
            ("Bartek", AssignmentRole.secondary): 25.0,
        },
        holidays=HOLIDAYS,
        historical_lenses={("Anna", "weekends"): 6.0, ("Cezary", "holidays"): 2.0},
        history_window=None,
        fairness_weight=3.0,
        continuity_weight=1.0,
        preference_weight=2.0,
        late_shift_anchor=anchor,
        spacing=spacing,
        prior_oncall=prior_oncall,
        acceptance_cap=acceptance_cap,
        fairness_only=fairness_only,
        fairness_bound=fairness_bound,
    )
    summary = [
        f"# case {label}",
        f"# conflicts: {conflicts}",
        f"# variables: {len(variables)}",
        "# lenses: "
        + ", ".join(
            f"{lens.label}(graded={lens.graded},mean={lens.mean},span={lens.span})"
            for lens in lenses
        ),
        str(model.Proto()),
    ]
    return label, "\n".join(summary)


def main(out_dir: str) -> None:
    cases = []
    for mode in RotationMode:
        for spacing in (True, False):
            cases.append(
                _case(
                    f"{mode.value}-spacing{int(spacing)}",
                    mode=mode,
                    spacing=spacing,
                    members=_plain_members(),
                )
            )
    cases.append(
        _case(
            "hybrid-preferences",
            mode=RotationMode.hybrid,
            spacing=True,
            members=_opinionated_members(),
        )
    )
    cases.append(
        _case(
            "hybrid-independent-anchor",
            mode=RotationMode.hybrid,
            spacing=True,
            members=_plain_members(),
            anchor=LateShiftAnchor.independent,
        )
    )
    cases.append(
        _case(
            "weekly-prior-oncall-cap",
            mode=RotationMode.weekly,
            spacing=True,
            members=_plain_members(),
            prior_oncall={"Anna": {STARTS - timedelta(days=1), STARTS - timedelta(days=2)}},
            acceptance_cap=3,
        )
    )
    cases.append(
        _case(
            "hybrid-fairness-only",
            mode=RotationMode.hybrid,
            spacing=True,
            members=_plain_members(),
            fairness_only=True,
        )
    )
    cases.append(
        _case(
            "hybrid-fairness-bound",
            mode=RotationMode.hybrid,
            spacing=True,
            members=_plain_members(),
            fairness_only=True,
            fairness_bound=5,
        )
    )
    cases.append(
        _case(
            "hybrid-one-late-shift-member",
            mode=RotationMode.hybrid,
            spacing=True,
            members=_one_late_shift_member(),
        )
    )
    for label, dump in cases:
        with open(f"{out_dir}/{label}.txt", "w") as handle:
            handle.write(dump)
        print(f"{label}: {len(dump)} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
