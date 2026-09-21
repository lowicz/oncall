"""Dump whole `SolverResult`s for a fixed matrix of generation inputs.

`scripts/model_proto_dump.py` stops at model construction, so it proves nothing
about `generate_schedule` - the orchestration that drives the solver passes and
translates what comes back. This harness covers that half: dump, refactor, dump
again, `diff -r`.

    uv run python scripts/solver_result_dump.py /tmp/before
    uv run python scripts/solver_result_dump.py /tmp/after
    diff -r /tmp/before /tmp/after

Every case pins `solver_workers=1` and a budget generous enough that no pass
hits the wall clock, because a multi-threaded search or a starved pass makes
the output vary between runs and a diff of it would mean nothing. Run the
"before" dump twice and diff it against itself before trusting any comparison.

Each dump also carries the solver-pass trace: the sequence of progress events
the run emitted, with the per-pass budgets stripped. The budgets are wall-clock
derived and so cannot repeat, but *how many* passes ran and in what order is
the structure of the state machine that drives them, and that is what a
refactor of it must not change. Without this a diff would only compare the nine
answers and say nothing about the route taken to them.

`continuity_gap` is deliberately excluded: it is a float the solver reports
about its own search, and it does not have to repeat even when the schedule
does.
"""

import sys
from dataclasses import fields
from datetime import date, timedelta

from oncall.domain.scheduling.solver import PreferenceRange, SolverResult
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode
from oncall.scheduler import DateRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

STARTS = date(2026, 11, 2)
ENDS = date(2026, 11, 22)
HOLIDAYS = polish_holidays(STARTS - timedelta(days=365), ENDS)

#: Long enough that the criterion pass, the main solve and any fallback all
#: finish on their own rather than being cut off by the deadline.
BUDGET = 60.0

#: Reported about the search, not about the schedule, so it is not stable.
UNSTABLE_FIELDS = {"continuity_gap"}


def _member(name: str, preferences: tuple[PreferenceRange, ...] = ()) -> SolverMember:
    active = DateRange(date(2025, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=preferences,
    )


def _plain_members(count: int = 5) -> list[SolverMember]:
    return [_member(n) for n in ("Anna", "Bartek", "Cezary", "Dora", "Ewa")[:count]]


def _render(result: SolverResult) -> str:
    lines = []
    for field in fields(result):
        if field.name in UNSTABLE_FIELDS:
            continue
        value = getattr(result, field.name)
        if field.name == "assignments":
            lines.append("assignments:")
            lines.extend(
                f"  {item.service_date.isoformat()} {item.role.value} {item.assignee_name}"
                for item in value
            )
        elif isinstance(value, tuple):
            lines.append(f"{field.name}:")
            lines.extend(f"  {entry}" for entry in value)
        else:
            lines.append(f"{field.name}: {value}")
    return "\n".join(lines)


def _case(label: str, **kwargs: object) -> tuple[str, str]:
    kwargs.setdefault("starts_on", STARTS)
    kwargs.setdefault("ends_on", ENDS)
    kwargs.setdefault("holidays", HOLIDAYS)
    kwargs.setdefault("historical_points", {})
    kwargs.setdefault("solver_workers", 1)
    kwargs.setdefault("solve_seconds", BUDGET)

    trace: list[str] = []
    kwargs.setdefault("progress_callback", trace.append)
    result = generate_schedule(**kwargs)  # type: ignore[arg-type]
    # The budget rides on the wall clock and cannot repeat; the pass count and
    # their order is the part a refactor must preserve.
    passes = "\n".join(f"  {event.split(' ')[0]}" for event in trace)
    return label, f"# case {label}\ntrace:\n{passes}\n{_render(result)}\n"


def _cases() -> list[tuple[str, str]]:
    cases = []
    for mode in RotationMode:
        cases.append(_case(f"{mode.value}-plain", mode=mode, members=_plain_members()))
    cases.append(
        _case(
            "hybrid-historical-debt",
            mode=RotationMode.hybrid,
            members=_plain_members(),
            historical_points={("Anna", AssignmentRole.primary): 40.0},
        )
    )
    cases.append(
        _case(
            "hybrid-independent-anchor",
            mode=RotationMode.hybrid,
            members=_plain_members(),
            late_shift_anchor=LateShiftAnchor.independent,
        )
    )
    cases.append(
        _case(
            "hybrid-anchor-exceptions",
            mode=RotationMode.hybrid,
            members=[
                _member("Anna"),
                _member("Bartek"),
                _member("Cezary"),
                SolverMember(
                    name="Tylko dyżur",
                    active=DateRange(date(2025, 1, 1), None),
                    eligibility={
                        role: (DateRange(date(2025, 1, 1), None),)
                        for role in AssignmentRole
                        if role != AssignmentRole.late_shift
                    },
                ),
            ],
        )
    )
    cases.append(
        _case(
            "hybrid-unavailability",
            mode=RotationMode.hybrid,
            members=[
                _member(
                    "Anna",
                    (
                        PreferenceRange(
                            date(2026, 11, 5), date(2026, 11, 9), AvailabilityKind.unavailable
                        ),
                    ),
                ),
                _member(
                    "Bartek",
                    (
                        PreferenceRange(
                            date(2026, 11, 10), date(2026, 11, 12), AvailabilityKind.prefer_not
                        ),
                    ),
                ),
                _member("Cezary"),
                _member("Dora"),
                _member("Ewa"),
            ],
        )
    )
    cases.append(
        _case(
            "daily-too-few-members",
            mode=RotationMode.daily,
            members=_plain_members(count=2),
        )
    )
    cases.append(
        _case(
            "hybrid-prior-oncall",
            mode=RotationMode.hybrid,
            members=_plain_members(),
            prior_oncall={
                "Anna": {STARTS - timedelta(days=n) for n in range(1, 6)},
            },
        )
    )
    return cases


def main(out_dir: str) -> None:
    for label, dump in _cases():
        with open(f"{out_dir}/{label}.txt", "w") as handle:
            handle.write(dump)
        print(f"{label}: {len(dump)} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
