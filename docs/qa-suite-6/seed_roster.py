"""QA6: wipe business data and build a fresh 10-person roster.

Runs inside the api container (has the oncall package and DB access).
"""
import asyncio
from datetime import date

from sqlalchemy import text, select

from oncall.database import SessionFactory
from oncall.auth import hash_password
from oncall.models import (
    AssignmentRole, AuthSource, Eligibility, TeamMember, User, UserRole,
)

PASSWORD = "QA6-Testowe-Haslo!"

# (username, first, last, role, personnel, active_from, eligible_roles, is_active)
P = AssignmentRole.primary
S = AssignmentRole.secondary
L = AssignmentRole.late_shift

ROSTER = [
    # login,              imie,       nazwisko,      rola konta,        nr,      od,           eligibility,  aktywne
    ("adam.nowicki",      "Adam",     "Nowicki",     UserRole.coordinator, "200101", date(2024, 1, 8),  (P, S, L), True),
    ("beata.lis",         "Beata",    "Lis",         UserRole.member,      "200102", date(2024, 1, 8),  (P, S, L), True),
    ("cezary.dudek",      "Cezary",   "Dudek",       UserRole.member,      "200103", date(2024, 1, 8),  (P, S, L), True),
    ("dorota.pawlak",     "Dorota",   "Pawlak",      UserRole.member,      "200104", date(2024, 1, 8),  (P, S, L), True),
    ("emil.zajac",        "Emil",     "Zając",       UserRole.member,      "200105", date(2024, 1, 8),  (P, S),    True),  # bez 11-19
    ("filip.gorski",      "Filip",    "Górski",      UserRole.member,      "200106", date(2024, 1, 8),  (P, S, L), True),
    ("grazyna.wilk",      "Grażyna",  "Wilk",        UserRole.member,      "200107", date(2024, 1, 8),  (P, S, L), True),
    ("hubert.baran",      "Hubert",   "Baran",       UserRole.member,      "200108", date(2024, 1, 8),  (P, S, L), True),
    ("iwona.sadowska",    "Iwona",    "Sadowska",    UserRole.member,      "200109", date(2024, 1, 8),  (P, S, L), True),
    # Osoba, ktora dolaczyla do rotacji wiele miesiecy pozniej niz reszta.
    ("jakub.polak",       "Jakub",    "Polak",       UserRole.member,      "200110", date(2026, 4, 1),  (P, S, L), True),
]

# Konta spoza rotacji.
EXTRA = [
    ("karolina.master",   "Karolina", "Master",      UserRole.coordinator, "200201", True),
    ("lucjan.widok",      "Lucjan",   "Widok",       UserRole.viewer,      "200202", True),
    ("marta.nieaktywna",  "Marta",    "Nieaktywna",  UserRole.member,      "200203", False),
]

ELIG_UNTIL = None


async def main() -> None:
    async with SessionFactory() as db:
        # FK-safe wipe of business data. alembic_version and the bootstrap admin
        # (recreated from .env on api start) are left alone.
        for table in (
            "assignments", "schedules", "schedule_runs", "swap_requests",
            "availability", "eligibility", "calendar_events", "calendar_feed_tokens",
            "notification_outbox", "share_links", "audit_events", "account_tokens",
            "team_members",
        ):
            await db.execute(text(f"DELETE FROM {table}"))
        await db.execute(text("DELETE FROM sessions"))
        await db.execute(text("DELETE FROM users WHERE username <> 'admin'"))
        await db.commit()

        digest = hash_password(PASSWORD)

        for username, first, last, role, personnel, active_from, roles, active in ROSTER:
            user = User(
                username=username, personnel_number=personnel,
                first_name=first, last_name=last, auth_source=AuthSource.local,
                password_hash=digest, role=role,
                email=f"{username}@example.com", is_active=active,
            )
            db.add(user)
            await db.flush()
            member = TeamMember(
                user_id=user.id, display_name=f"{first} {last}",
                active_from=active_from, active_until=None,
            )
            db.add(member)
            await db.flush()
            for elig_role in roles:
                db.add(Eligibility(
                    member_id=member.id, role=elig_role,
                    starts_on=active_from, ends_on=ELIG_UNTIL,
                ))

        for username, first, last, role, personnel, active in EXTRA:
            db.add(User(
                username=username, personnel_number=personnel,
                first_name=first, last_name=last, auth_source=AuthSource.local,
                password_hash=digest, role=role,
                email=f"{username}@example.com", is_active=active,
            ))

        await db.commit()

        members = (await db.scalars(select(TeamMember).order_by(TeamMember.display_name))).all()
        for m in members:
            print(f"{m.display_name:22} od {m.active_from}")
        users = (await db.scalars(select(User).order_by(User.username))).all()
        print(f"\nusers={len(users)} members={len(members)}")


asyncio.run(main())
