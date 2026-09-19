"""FastAPI dependencies that compose feature application ports."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import CurrentUser
from oncall.database import get_db
from oncall.domain.access.ports import AccessPorts
from oncall.domain.admin.ports import AdminPorts, AuditTrail, RotationDirectory
from oncall.domain.availability.ports import AvailabilityReadPorts, AvailabilityWritePorts
from oncall.domain.balance.ports import BalancePorts
from oncall.domain.calendar.ports import CalendarPorts
from oncall.domain.history.ports import HistoryPorts
from oncall.domain.overrides.ports import OverridePorts
from oncall.domain.reports.ports import ReportPorts
from oncall.domain.scheduling.ports import SchedulingPorts
from oncall.domain.sharing.ports import (
    CalendarSubscriptionPorts,
    LinkFeedPorts,
    MemberFeedPorts,
    ShareExchangePorts,
    ShareLinkCommandPorts,
    ShareLinkQueryPorts,
)
from oncall.domain.swaps.ports import SwapPorts
from oncall.infrastructure.credentials import Argon2Passwords, DirectoryAuthentication
from oncall.infrastructure.sqlalchemy.access import (
    SqlAlchemyAccessAccounts,
    SqlAlchemyAccessJournal,
    SqlAlchemyAccountLinks,
    SqlAlchemyLoginAttempts,
)
from oncall.infrastructure.sqlalchemy.admin import (
    SqlAlchemyAccounts,
    SqlAlchemyAdminJournal,
    SqlAlchemyAuditTrail,
    SqlAlchemyRotation,
)
from oncall.infrastructure.sqlalchemy.availability import SqlAlchemyAvailability
from oncall.infrastructure.sqlalchemy.calendar import (
    SqlAlchemyCalendarEvents,
    SqlAlchemyCalendarRoster,
)
from oncall.infrastructure.sqlalchemy.history import SqlAlchemyHistory
from oncall.infrastructure.sqlalchemy.overrides import SqlAlchemyOverrideJournal
from oncall.infrastructure.sqlalchemy.reports import SqlAlchemyReportRoster
from oncall.infrastructure.sqlalchemy.roster import (
    SqlAlchemyFairnessHistory,
    SqlAlchemyPublicationCalendar,
    SqlAlchemyPublishedRoster,
    SqlAlchemyRosterPolicy,
)
from oncall.infrastructure.sqlalchemy.scheduling import scheduling_ports
from oncall.infrastructure.sqlalchemy.sessions import SqlAlchemySessions
from oncall.infrastructure.sqlalchemy.sharing import SqlAlchemyCalendarFeeds, SqlAlchemyShareLinks
from oncall.infrastructure.sqlalchemy.swaps import SqlAlchemySwapJournal, SqlAlchemySwapRequests
from oncall.infrastructure.sqlalchemy.team import SqlAlchemyTeamDirectory
from oncall.ldap_auth import LdapAuthenticator, get_directory_authenticator

DbSession = Annotated[AsyncSession, Depends(get_db, scope="function")]
DirectoryAuth = Annotated[LdapAuthenticator, Depends(get_directory_authenticator)]


def scheduling_reader(db: DbSession) -> SchedulingPorts:
    return scheduling_ports(db)


def scheduling_writer(db: DbSession, actor: CurrentUser) -> SchedulingPorts:
    return scheduling_ports(db, actor)


def availability_reader(db: DbSession, actor: CurrentUser) -> AvailabilityReadPorts:
    return AvailabilityReadPorts(
        team=SqlAlchemyTeamDirectory(db),
        ledger=SqlAlchemyAvailability(db, actor),
    )


def availability_writer(db: DbSession, actor: CurrentUser) -> AvailabilityWritePorts:
    ledger = SqlAlchemyAvailability(db, actor)
    return AvailabilityWritePorts(
        team=SqlAlchemyTeamDirectory(db),
        roster=SqlAlchemyPublishedRoster(db),
        ledger=ledger,
        journal=ledger,
    )


def swap_ports(db: DbSession, actor: CurrentUser) -> SwapPorts:
    return SwapPorts(
        team=SqlAlchemyTeamDirectory(db),
        roster=SqlAlchemyPublishedRoster(db),
        policy=SqlAlchemyRosterPolicy(db),
        requests=SqlAlchemySwapRequests(db),
        journal=SqlAlchemySwapJournal(db, actor),
        fairness=SqlAlchemyFairnessHistory(db),
    )


def calendar_reader(db: DbSession) -> CalendarPorts:
    events = SqlAlchemyCalendarEvents(db)
    return CalendarPorts(
        events=events,
        journal=events,
        roster=SqlAlchemyPublishedRoster(db),
        calendar=SqlAlchemyCalendarRoster(db),
    )


def calendar_writer(db: DbSession, actor: CurrentUser) -> CalendarPorts:
    events = SqlAlchemyCalendarEvents(db, actor)
    return CalendarPorts(
        events=events,
        journal=events,
        roster=SqlAlchemyPublishedRoster(db),
        calendar=SqlAlchemyCalendarRoster(db),
    )


def override_ports(db: DbSession, actor: CurrentUser) -> OverridePorts:
    return OverridePorts(
        team=SqlAlchemyTeamDirectory(db),
        roster=SqlAlchemyPublishedRoster(db),
        policy=SqlAlchemyRosterPolicy(db),
        journal=SqlAlchemyOverrideJournal(db, actor),
    )


def balance_ports(db: DbSession) -> BalancePorts:
    return BalancePorts(
        team=SqlAlchemyTeamDirectory(db),
        history=SqlAlchemyFairnessHistory(db),
        policy=SqlAlchemyRosterPolicy(db),
        publications=SqlAlchemyPublicationCalendar(db),
    )


def report_ports(db: DbSession) -> ReportPorts:
    return ReportPorts(
        members=SqlAlchemyReportRoster(db),
        roster=SqlAlchemyPublishedRoster(db),
    )


def team_reader(db: DbSession) -> RotationDirectory:
    return SqlAlchemyRotation(db)


def history_reader(db: DbSession) -> HistoryPorts:
    history = SqlAlchemyHistory(db)
    return HistoryPorts(archive=history, journal=history)


def history_writer(db: DbSession, actor: CurrentUser) -> HistoryPorts:
    history = SqlAlchemyHistory(db, actor)
    return HistoryPorts(archive=history, journal=history)


def admin_ports(db: DbSession, actor: CurrentUser) -> AdminPorts:
    return AdminPorts(
        accounts=SqlAlchemyAccounts(db),
        rotation=SqlAlchemyRotation(db),
        journal=SqlAlchemyAdminJournal(db, actor),
    )


def audit_trail(db: DbSession) -> AuditTrail:
    return SqlAlchemyAuditTrail(db)


def access_ports(db: DbSession, directory: DirectoryAuth) -> AccessPorts:
    return AccessPorts(
        attempts=SqlAlchemyLoginAttempts(db),
        accounts=SqlAlchemyAccessAccounts(db),
        passwords=Argon2Passwords(),
        directory=DirectoryAuthentication(directory),
        sessions=SqlAlchemySessions(db),
        links=SqlAlchemyAccountLinks(db),
        journal=SqlAlchemyAccessJournal(db),
    )


def session_store(db: DbSession) -> SqlAlchemySessions:
    return SqlAlchemySessions(db)


def share_link_query(db: DbSession) -> ShareLinkQueryPorts:
    return ShareLinkQueryPorts(links=SqlAlchemyShareLinks(db))


def share_link_command(db: DbSession, actor: CurrentUser) -> ShareLinkCommandPorts:
    links = SqlAlchemyShareLinks(db, actor)
    return ShareLinkCommandPorts(links=links, link_journal=links)


def share_exchange(db: DbSession) -> ShareExchangePorts:
    links = SqlAlchemyShareLinks(db)
    return ShareExchangePorts(
        links=links,
        sessions=SqlAlchemySessions(db),
        link_journal=links,
    )


def member_feed(db: DbSession, actor: CurrentUser) -> MemberFeedPorts:
    feeds = SqlAlchemyCalendarFeeds(db, actor)
    return MemberFeedPorts(
        feeds=feeds,
        feed_journal=feeds,
        team=SqlAlchemyTeamDirectory(db),
    )


def link_feed(db: DbSession, actor: CurrentUser) -> LinkFeedPorts:
    links = SqlAlchemyShareLinks(db, actor)
    feeds = SqlAlchemyCalendarFeeds(db, actor)
    return LinkFeedPorts(
        links=links,
        feeds=feeds,
        feed_journal=feeds,
    )


def calendar_subscription(db: DbSession) -> CalendarSubscriptionPorts:
    return CalendarSubscriptionPorts(
        links=SqlAlchemyShareLinks(db),
        feeds=SqlAlchemyCalendarFeeds(db),
        team=SqlAlchemyTeamDirectory(db),
        roster=SqlAlchemyPublishedRoster(db),
    )


SchedulingReader = Annotated[SchedulingPorts, Depends(scheduling_reader)]
SchedulingWriter = Annotated[SchedulingPorts, Depends(scheduling_writer)]
AvailabilityReader = Annotated[AvailabilityReadPorts, Depends(availability_reader)]
AvailabilityWriter = Annotated[AvailabilityWritePorts, Depends(availability_writer)]
SwapProvider = Annotated[SwapPorts, Depends(swap_ports)]
CalendarReader = Annotated[CalendarPorts, Depends(calendar_reader)]
CalendarWriter = Annotated[CalendarPorts, Depends(calendar_writer)]
OverrideProvider = Annotated[OverridePorts, Depends(override_ports)]
BalanceProvider = Annotated[BalancePorts, Depends(balance_ports)]
ReportProvider = Annotated[ReportPorts, Depends(report_ports)]
TeamProvider = Annotated[RotationDirectory, Depends(team_reader)]
HistoryReader = Annotated[HistoryPorts, Depends(history_reader)]
HistoryWriter = Annotated[HistoryPorts, Depends(history_writer)]
AdminProvider = Annotated[AdminPorts, Depends(admin_ports)]
AuditProvider = Annotated[AuditTrail, Depends(audit_trail)]
AccessProvider = Annotated[AccessPorts, Depends(access_ports)]
SessionProvider = Annotated[SqlAlchemySessions, Depends(session_store)]
ShareLinkQueryProvider = Annotated[ShareLinkQueryPorts, Depends(share_link_query)]
ShareLinkCommandProvider = Annotated[ShareLinkCommandPorts, Depends(share_link_command)]
ShareExchangeProvider = Annotated[ShareExchangePorts, Depends(share_exchange)]
MemberFeedProvider = Annotated[MemberFeedPorts, Depends(member_feed)]
LinkFeedProvider = Annotated[LinkFeedPorts, Depends(link_feed)]
CalendarSubscriptionProvider = Annotated[CalendarSubscriptionPorts, Depends(calendar_subscription)]

__all__ = [
    "AccessProvider",
    "AdminProvider",
    "AvailabilityReader",
    "AvailabilityWriter",
    "AuditProvider",
    "BalanceProvider",
    "CalendarReader",
    "CalendarSubscriptionProvider",
    "CalendarWriter",
    "HistoryReader",
    "HistoryWriter",
    "LinkFeedProvider",
    "MemberFeedProvider",
    "OverrideProvider",
    "ReportProvider",
    "SchedulingReader",
    "SchedulingWriter",
    "SessionProvider",
    "ShareExchangeProvider",
    "ShareLinkCommandProvider",
    "ShareLinkQueryProvider",
    "SwapProvider",
    "TeamProvider",
]
