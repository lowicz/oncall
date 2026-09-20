"""QA test-data seeder: 15 accounts, 10 rotation members, 12 months of history."""

import asyncio
import random
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select

from oncall.auth import hash_password
from oncall.database import SessionFactory
from oncall.models import (
    Assignment,
    AssignmentRole,
    Availability,
    AvailabilityKind,
    Eligibility,
    Schedule,
    ScheduleStatus,
    TeamMember,
    User,
    UserRole,
)
from oncall.workdays import is_working_day, polish_holidays

PASSWORD = "TestOncall2026!"
TODAY = date.today()

# login, first, last, role, in_rotation, active_from_offset, eligible_roles
ACCOUNTS = [
    ("admin2", "Barbara", "Adminowska", UserRole.admin, False, None, None),
    ("koord", "Krzysztof", "Koordynacki", UserRole.coordinator, False, None, None),
    ("anna", "Anna", "Kowalska", UserRole.coordinator, True, -400, "psl"),
    ("marek", "Marek", "Nowak", UserRole.member, True, -400, "psl"),
    ("ola", "Aleksandra", "Wiśniewska", UserRole.member, True, -400, "psl"),
    ("piotr", "Piotr", "Zieliński", UserRole.member, True, -400, "psl"),
    ("kasia", "Katarzyna", "Lewandowska", UserRole.member, True, -400, "psl"),
    ("tomek", "Tomasz", "Wójcik", UserRole.member, True, -400, "psl"),
    ("ewa", "Ewa", "Kamińska", UserRole.member, True, -400, "sl"),      # no primary
    ("jakub", "Jakub", "Szymański", UserRole.member, True, -400, "ps"),  # no late shift
    ("magda", "Magdalena", "Dąbrowska", UserRole.member, True, -400, "psl"),
    ("rafal", "Rafał", "Woźniak", UserRole.member, True, -90, "psl"),    # newcomer
    ("viewer", "Service", "Desk", UserRole.viewer, False, None, None),
    ("viewer2", "Recepcja", "Główna", UserRole.viewer, False, None, None),
]

ROLE_LETTERS = {
    "p": AssignmentRole.primary,
    "s": AssignmentRole.secondary,
    "l": AssignmentRole.late_shift,
}


async def wipe(db):
    """Remove previous QA data so the seeder is repeatable."""
    logins = [row[0] for row in ACCOUNTS]
    await db.execute(delete(Schedule))
    members = (await db.scalars(select(TeamMember))).all()
    for member in members:
        await db.delete(member)
    users = (await db.scalars(select(User).where(User.username.in_(logins)))).all()
    for user in users:
        await db.delete(user)
    await db.commit()


async def seed():
    async with SessionFactory() as db:
        await wipe(db)

        members: list[TeamMember] = []
        for login, first, last, role, in_rotation, offset, letters in ACCOUNTS:
            user = User(
                username=login,
                first_name=first,
                last_name=last,
                password_hash=hash_password(PASSWORD),
                role=role,
                email=f"{login}@example.com",
                is_active=True,
            )
            db.add(user)
            await db.flush()
            if in_rotation:
                active_from = TODAY + timedelta(days=offset)
                member = TeamMember(
                    user_id=user.id,
                    display_name=f"{first} {last}",
                    active_from=active_from,
                )
                member.eligibility = [
                    Eligibility(role=ROLE_LETTERS[letter], starts_on=active_from)
                    for letter in letters
                ]
                db.add(member)
                members.append(member)
        await db.flush()

        by_role: dict[AssignmentRole, list[TeamMember]] = {
            role: [
                m for m in members
                if any(e.role == role for e in m.eligibility)
            ]
            for role in AssignmentRole
        }

        rng = random.Random(20260905)
        holidays = polish_holidays(TODAY - timedelta(days=400), TODAY + timedelta(days=120))

        def build(name, start, end, status, published_at, skew=False):
            schedule = Schedule(
                name=name,
                starts_on=start,
                ends_on=end,
                status=status,
                published_at=published_at,
                version=1,
            )
            day = start
            index = 0
            while day <= end:
                # A deliberately uneven rotation so the fairness report has
                # something to report on.
                pool_p = by_role[AssignmentRole.primary]
                pool_s = by_role[AssignmentRole.secondary]
                if skew and day.weekday() >= 5:
                    primary = pool_p[index % 3]  # weekends land on 3 people only
                else:
                    primary = pool_p[index % len(pool_p)]
                secondary = pool_s[(index + 3) % len(pool_s)]
                if secondary.id == primary.id:
                    secondary = pool_s[(index + 4) % len(pool_s)]
                schedule.assignments.append(
                    Assignment(service_date=day, role=AssignmentRole.primary,
                               assignee_name=primary.display_name, member_id=primary.id)
                )
                schedule.assignments.append(
                    Assignment(service_date=day, role=AssignmentRole.secondary,
                               assignee_name=secondary.display_name, member_id=secondary.id)
                )
                if is_working_day(day, holidays):
                    pool_l = by_role[AssignmentRole.late_shift]
                    late = pool_l[(index + 1) % len(pool_l)]
                    schedule.assignments.append(
                        Assignment(service_date=day, role=AssignmentRole.late_shift,
                                   assignee_name=late.display_name, member_id=late.id)
                    )
                day += timedelta(days=1)
                index += 1
            db.add(schedule)
            return schedule

        now = datetime.now(UTC)
        # Twelve months of served duty, in three publications, one of which is a
        # partial republication inside an older one.
        build("Historia 12M", TODAY - timedelta(days=365), TODAY - timedelta(days=31),
              ScheduleStatus.published, now - timedelta(days=370), skew=True)
        build("Republikacja fragmentu", TODAY - timedelta(days=60), TODAY - timedelta(days=46),
              ScheduleStatus.published, now - timedelta(days=65))
        build("Ostatni miesiąc", TODAY - timedelta(days=30), TODAY - timedelta(days=1),
              ScheduleStatus.published, now - timedelta(days=35))
        # The live schedule: today plus four weeks, so "who is now" and swaps work.
        build("Grafik bieżący", TODAY, TODAY + timedelta(days=27),
              ScheduleStatus.published, now - timedelta(days=5))

        # Availability of every kind, in the future so the generator sees it.
        def avail(member, kind, start_off, end_off, note):
            db.add(Availability(
                member_id=member.id, kind=kind,
                starts_on=TODAY + timedelta(days=start_off),
                ends_on=TODAY + timedelta(days=end_off), note=note,
            ))

        by_login = {m.display_name: m for m in members}
        avail(by_login["Marek Nowak"], AvailabilityKind.unavailable, 30, 44, "Urlop")
        avail(by_login["Aleksandra Wiśniewska"], AvailabilityKind.prefer_not, 30, 60, "Szkolenie")
        avail(by_login["Piotr Zieliński"], AvailabilityKind.prefer, 30, 60, "Chętnie wezmę")
        avail(by_login["Katarzyna Lewandowska"], AvailabilityKind.unavailable, 35, 38, "Wyjazd")

        await db.commit()

        print(f"password={PASSWORD}")
        print(f"members={len(members)} users={len(ACCOUNTS)}")
        for m in sorted(members, key=lambda x: x.display_name):
            print(f"  {m.display_name}  id={m.id}  from={m.active_from}")


if __name__ == "__main__":
    asyncio.run(seed())
