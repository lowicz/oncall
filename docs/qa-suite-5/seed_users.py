"""Seed QA round 4 accounts, team members and eligibility. Runs inside the api container."""
import asyncio
import os
from datetime import date

from sqlalchemy import text
from oncall.database import SessionFactory
from oncall.auth import hash_password
from oncall.models import (
    AssignmentRole, AuthSource, Eligibility, SchedulingPolicy, TeamMember, User, UserRole,
)

PASSWORD = os.environ.get("QA_PASSWORD", "OncallQA-2026!")
BASE_FROM = date(2024, 9, 1)
LATE_FROM = date(2026, 4, 1)

# username, first, last, role, personnel, active_from, roles the person may take
PEOPLE = [
    ("anna.kowalska",        "Anna",       "Kowalska",     UserRole.member,      "100101", BASE_FROM, "PSL"),
    ("marek.wisniewski",     "Marek",      "Wiśniewski",   UserRole.member,      "100102", BASE_FROM, "PSL"),
    ("ola.zielinska",        "Ola",        "Zielińska",    UserRole.coordinator, "100103", BASE_FROM, "PSL"),
    ("piotr.lewandowski",    "Piotr",      "Lewandowski",  UserRole.member,      "100104", BASE_FROM, "PSL"),
    ("katarzyna.dabrowska",  "Katarzyna",  "Dąbrowska",    UserRole.member,      "100105", BASE_FROM, "PSL"),
    ("tomasz.szymanski",     "Tomasz",     "Szymański",    UserRole.member,      "100106", BASE_FROM, "PS"),
    ("magdalena.wozniak",    "Magdalena",  "Woźniak",      UserRole.member,      "100107", BASE_FROM, "PSL"),
    ("rafal.kaminski",       "Rafał",      "Kamiński",     UserRole.member,      "100108", BASE_FROM, "SL"),
    ("julia.nowak",          "Julia",      "Nowak",        UserRole.member,      "100109", BASE_FROM, "PSL"),
    ("bartosz.mazur",        "Bartosz",    "Mazur",        UserRole.member,      "100110", LATE_FROM, "PSL"),
]

NON_MEMBERS = [
    ("kontroler.viewer", "Kontroler", "Audytu",  UserRole.viewer,      "100201", True),
    ("halina.koordynator", "Halina", "Sikora",   UserRole.coordinator, "100202", True),
    ("dawid.stary",      "Dawid",     "Stary",   UserRole.member,      "100203", False),
]

ROLE_LETTER = {
    "P": AssignmentRole.primary,
    "S": AssignmentRole.secondary,
    "L": AssignmentRole.late_shift,
}


async def main() -> None:
    async with SessionFactory() as db:
        for username, first, last, role, pesel, active_from, letters in PEOPLE:
            user = User(
                username=username, first_name=first, last_name=last, role=role,
                personnel_number=pesel, auth_source=AuthSource.local,
                password_hash=hash_password(PASSWORD),
                email=f"{username}@example.com", is_active=True,
            )
            db.add(user)
            await db.flush()
            member = TeamMember(
                user_id=user.id, display_name=f"{first} {last}", active_from=active_from,
            )
            db.add(member)
            await db.flush()
            for letter in letters:
                db.add(Eligibility(
                    member_id=member.id, role=ROLE_LETTER[letter], starts_on=active_from,
                ))
        for username, first, last, role, pesel, active in NON_MEMBERS:
            db.add(User(
                username=username, first_name=first, last_name=last, role=role,
                personnel_number=pesel, auth_source=AuthSource.local,
                password_hash=hash_password(PASSWORD),
                email=f"{username}@example.com", is_active=active,
            ))
        db.add(SchedulingPolicy())
        await db.commit()
        rows = await db.execute(text(
            "select u.username, u.role, t.display_name, t.active_from "
            "from users u left join team_members t on t.user_id = u.id order by u.username"
        ))
        for row in rows:
            print(row)


asyncio.run(main())
