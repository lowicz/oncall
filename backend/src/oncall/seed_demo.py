import asyncio
import os
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from oncall.auth import hash_password
from oncall.database import SessionFactory
from oncall.models import (
    Assignment,
    AssignmentRole,
    Eligibility,
    Schedule,
    ScheduleStatus,
    TeamMember,
    User,
    UserRole,
)
from oncall.workdays import is_working_day, polish_holidays

DEMO_NAMES = ["Anna Kowalska", "Marek Nowak", "Ola Wiśniewska", "Piotr Zieliński"]


async def get_or_create_user(
    username: str, display_name: str, role: UserRole, password: str
) -> User:
    email_domain = os.environ.get("ONCALL_DEMO_EMAIL_DOMAIN")
    async with SessionFactory() as db:
        user = await db.scalar(select(User).where(User.username == username))
        if user is None:
            user = User(
                username=username,
                display_name=display_name,
                password_hash=hash_password(password),
                role=role,
                email=f"{username}@{email_domain}" if email_domain else None,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        elif email_domain and user.email is None:
            user.email = f"{username}@{email_domain}"
            await db.commit()
            await db.refresh(user)
        return user


async def seed_demo() -> None:
    password = os.environ.get("ONCALL_DEMO_PASSWORD")
    if not password or len(password) < 12:
        raise SystemExit("Set ONCALL_DEMO_PASSWORD (minimum 12 characters).")

    admin = await get_or_create_user("admin", "Administrator", UserRole.admin, password)
    member_users = [
        await get_or_create_user(username, name, UserRole.member, password)
        for username, name in zip(("anna", "marek", "ola", "piotr"), DEMO_NAMES, strict=True)
    ]
    await get_or_create_user("viewer", "Service Desk", UserRole.viewer, password)

    async with SessionFactory() as db:
        if await db.scalar(select(Schedule).where(Schedule.name == "Demo schedule")):
            members = (
                await db.scalars(select(TeamMember).where(TeamMember.display_name.in_(DEMO_NAMES)))
            ).all()
            user_ids = {name: user.id for name, user in zip(DEMO_NAMES, member_users, strict=True)}
            for member in members:
                member.user_id = user_ids[member.display_name]
            await db.commit()
            print("Demo accounts and team-member links synchronized.")
            return

        members: list[TeamMember] = []
        for index, name in enumerate(DEMO_NAMES):
            member = TeamMember(
                user_id=member_users[index].id,
                display_name=name,
                active_from=date.today() - timedelta(days=365),
            )
            member.eligibility = [
                Eligibility(role=AssignmentRole.primary, starts_on=member.active_from),
                Eligibility(role=AssignmentRole.secondary, starts_on=member.active_from),
                Eligibility(role=AssignmentRole.late_shift, starts_on=member.active_from),
            ]
            members.append(member)
            db.add(member)

        starts_on = date.today()
        schedule = Schedule(
            name="Demo schedule",
            starts_on=starts_on,
            ends_on=starts_on + timedelta(days=13),
            status=ScheduleStatus.published,
            published_at=datetime.now(UTC),
        )
        for offset in range(14):
            service_date = starts_on + timedelta(days=offset)
            assignments = [
                Assignment(
                    service_date=service_date,
                    role=AssignmentRole.primary,
                    assignee_name=DEMO_NAMES[offset % len(DEMO_NAMES)],
                ),
                Assignment(
                    service_date=service_date,
                    role=AssignmentRole.secondary,
                    assignee_name=DEMO_NAMES[(offset + 1) % len(DEMO_NAMES)],
                ),
            ]
            polish_days = polish_holidays(service_date, service_date)
            if is_working_day(service_date, polish_days):
                assignments.append(
                    Assignment(
                        service_date=service_date,
                        role=AssignmentRole.late_shift,
                        assignee_name=DEMO_NAMES[(offset + 1) % len(DEMO_NAMES)],
                    )
                )
            schedule.assignments.extend(assignments)
        db.add(schedule)
        await db.commit()
    print("Created demo accounts: admin, anna, marek, ola, piotr and viewer.")
    print(f"Admin id: {admin.id}")


if __name__ == "__main__":
    asyncio.run(seed_demo())
