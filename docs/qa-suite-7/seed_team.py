"""QA7: wipe ALL business data and build a fresh team. Runs inside the api container.

Rotation (10 active people):
- tomasz.krawczyk is the coordinator AND serves in the rotation,
- igor.wojcik is a junior: secondary + 11-19 only, never primary,
- grzegorz.zielinski does not do the 11-19 shift,
- julia.nowak joined on 2026-03-02, 14 months after the rest,
- robert.baran served until 2026-02-27 and left (account deactivated).
"""
import asyncio
from datetime import date

from sqlalchemy import select, text

from oncall.auth import hash_password
from oncall.database import SessionFactory
from oncall.models import AssignmentRole, AuthSource, Eligibility, TeamMember, User, UserRole

PASSWORD = "QA7-Haslo-Testowe!"
P, S, L = AssignmentRole.primary, AssignmentRole.secondary, AssignmentRole.late_shift
BASE = date(2025, 1, 6)

# login, first, last, account role, personnel no, active_from, active_until, roles, account active
ROTATION = [
    ("tomasz.krawczyk", "Tomasz", "Krawczyk", UserRole.coordinator, "310001", BASE, None, (P, S, L), True),
    ("anna.wrobel", "Anna", "Wróbel", UserRole.member, "310002", BASE, None, (P, S, L), True),
    ("bartosz.kowal", "Bartosz", "Kowal", UserRole.member, "310003", BASE, None, (P, S, L), True),
    ("celina.mazur", "Celina", "Mazur", UserRole.member, "310004", BASE, None, (P, S, L), True),
    ("dawid.lewandowski", "Dawid", "Lewandowski", UserRole.member, "310005", BASE, None, (P, S, L), True),
    ("elzbieta.kaczmarek", "Elżbieta", "Kaczmarek", UserRole.member, "310006", BASE, None, (P, S, L), True),
    ("grzegorz.zielinski", "Grzegorz", "Zieliński", UserRole.member, "310007", BASE, None, (P, S), True),
    ("halina.szymanska", "Halina", "Szymańska", UserRole.member, "310008", BASE, None, (P, S, L), True),
    ("igor.wojcik", "Igor", "Wójcik", UserRole.member, "310009", BASE, None, (S, L), True),
    ("julia.nowak", "Julia", "Nowak", UserRole.member, "310010", date(2026, 3, 2), None, (P, S, L), True),
    ("robert.baran", "Robert", "Baran", UserRole.member, "310011", BASE, date(2026, 3, 1), (P, S, L), False),
]

OUTSIDE = [
    ("ewa.maj", "Ewa", "Maj", UserRole.coordinator, "310101", True),
    ("patryk.podglad", "Patryk", "Podgląd", UserRole.viewer, "310102", True),
    ("szef.dzialu", "Stanisław", "Szef", UserRole.admin, "310103", True),
]


async def main() -> None:
    async with SessionFactory() as db:
        tables = (await db.execute(text(
            "select tablename from pg_tables where schemaname='public' "
            "and tablename not in ('alembic_version','users')"
        ))).scalars().all()
        await db.execute(text("TRUNCATE " + ", ".join(tables) + " CASCADE"))
        await db.execute(text("DELETE FROM users WHERE username <> 'admin'"))
        await db.commit()

        digest = hash_password(PASSWORD)
        for login, first, last, role, no, since, until, roles, active in ROTATION:
            user = User(
                username=login, personnel_number=no, first_name=first, last_name=last,
                auth_source=AuthSource.local, password_hash=digest, role=role,
                email=f"{login}@example.com", is_active=active,
            )
            db.add(user)
            await db.flush()
            member = TeamMember(
                user_id=user.id, display_name=f"{first} {last}",
                active_from=since, active_until=until,
            )
            db.add(member)
            await db.flush()
            for r in roles:
                db.add(Eligibility(member_id=member.id, role=r, starts_on=since, ends_on=until))
        for login, first, last, role, no, active in OUTSIDE:
            db.add(User(
                username=login, personnel_number=no, first_name=first, last_name=last,
                auth_source=AuthSource.local, password_hash=digest, role=role,
                email=f"{login}@example.com", is_active=active,
            ))
        await db.commit()
        for m in (await db.scalars(select(TeamMember).order_by(TeamMember.active_from))).all():
            print(f"{m.display_name:22} {m.active_from} .. {m.active_until}")
        print("users:", len((await db.scalars(select(User))).all()))


asyncio.run(main())
