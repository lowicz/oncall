"""In-memory ports for signing in, account links and sharing."""

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta

from oncall.domain.access import errors
from oncall.domain.access.errors import DirectoryFailure
from oncall.domain.access.models import AccountLink, StoredCredentials
from oncall.domain.access.ports import AccessPorts
from oncall.domain.accounts import Account, SignedInSession
from oncall.domain.sharing.models import CalendarFeed, FeedIssued, ShareLink
from oncall.domain.sharing.ports import SharingPorts
from oncall.domain.vocabulary import AuthSource, UserRole
from tests.domain.fakes import FakeJournal, FakeRoster, FakeTeam


def account(username: str, **changes) -> Account:
    values = {
        "id": uuid.uuid4(),
        "username": username,
        "personnel_number": None,
        "first_name": username.title(),
        "last_name": "",
        "auth_source": AuthSource.local,
        "role": UserRole.member,
        "email": None,
        "phone": None,
        "is_active": True,
        "created_at": datetime.now(UTC),
    }
    return Account(**(values | changes))


class FakeAttempts:
    def __init__(self) -> None:
        self.failures: dict[str, int] = {}
        self.throttles: dict[str, int] = {}
        self.events: list[tuple] = []

    async def failures_since(self, label, since):
        return self.failures.get(label, 0)

    async def throttled(self, label, since):
        self.throttles[label] = self.throttles.get(label, 0) + 1
        return self.throttles[label]

    async def failed(self, request, since):
        for label in (request.login_label, request.ip_label):
            self.failures[label] = self.failures.get(label, 0) + 1
        self.events.append(("failed", request.login))

    async def directory_unavailable(self, login, reason):
        self.events.append(("directory_unavailable", login, reason))

    async def identity_conflict(self, login):
        self.events.append(("identity_conflict", login))


class FakeAccessAccounts:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, Account] = {}
        self.hashes: dict[uuid.UUID, str | None] = {}
        self.members: set[uuid.UUID] = set()
        self.renamed: list[tuple[uuid.UUID, str]] = []

    def put(self, item: Account, password_hash: str | None = "hash:secret") -> Account:
        self.by_id[item.id] = item
        self.hashes[item.id] = password_hash
        return item

    async def account(self, account_id):
        return self.by_id.get(account_id)

    async def credentials_for_login(self, login):
        found = next((item for item in self.by_id.values() if item.username == login), None)
        return StoredCredentials(found, self.hashes[found.id]) if found else None

    async def account_with_personnel_number(self, personnel_number):
        return next(
            (item for item in self.by_id.values() if item.personnel_number == personnel_number),
            None,
        )

    async def account_named(self, login):
        return next((item for item in self.by_id.values() if item.username.lower() == login), None)

    async def has_team_member(self, account_id):
        return account_id in self.members

    async def provision_from_directory(self, login, identity):
        return self.put(
            account(
                login,
                personnel_number=identity.personnel_number,
                first_name=identity.first_name,
                last_name=identity.last_name,
                email=identity.email,
                auth_source=AuthSource.ldap,
                role=UserRole.viewer,
            ),
            None,
        )

    async def link_to_directory(self, account_id, login, identity):
        self.hashes[account_id] = None
        return self.put(
            replace(
                self.by_id[account_id],
                auth_source=AuthSource.ldap,
                username=login,
                first_name=identity.first_name,
                last_name=identity.last_name,
                email=identity.email,
            ),
            None,
        )

    async def update_from_directory(self, account_id, changes):
        return self.put(replace(self.by_id[account_id], **changes), None)

    async def set_password(self, account_id, password_hash):
        self.hashes[account_id] = password_hash

    async def change_phone(self, account_id, phone):
        if account_id not in self.by_id:
            raise errors.AccountGone()
        self.by_id[account_id] = replace(self.by_id[account_id], phone=phone)
        return self.by_id[account_id]


class FakePasswords:
    def __init__(self) -> None:
        self.verifications = 0
        self.decoys = 0

    async def verify(self, password_hash, password):
        self.verifications += 1
        return password_hash == f"hash:{password}"

    async def verify_decoy(self, password):
        self.decoys += 1

    async def hash(self, password):
        return f"hash:{password}"

    @property
    def cost(self) -> int:
        return self.verifications + self.decoys


class FakeDirectory:
    def __init__(self, identity=None, failure: str | None = None) -> None:
        self.identity = identity
        self.failure = failure
        self.calls = 0

    async def authenticate(self, login, password):
        self.calls += 1
        if self.failure:
            raise DirectoryFailure(self.failure)
        return self.identity


class FakeSessions:
    def __init__(self) -> None:
        self.opened: list[tuple] = []
        self.ended: list[uuid.UUID] = []

    async def open_for_account(self, account_id, expires_at):
        self.opened.append(("account", account_id, expires_at))
        return SignedInSession(f"token-{len(self.opened)}", "csrf", expires_at)

    async def open_for_share_link(self, link_id, expires_at):
        self.opened.append(("link", link_id, expires_at))
        return SignedInSession(f"token-{len(self.opened)}", "csrf", expires_at)

    async def end_all_for_account(self, account_id):
        self.ended.append(account_id)


class FakeAccountLinks:
    def __init__(self, accounts: FakeAccessAccounts) -> None:
        self.accounts = accounts
        self.by_token: dict[str, tuple] = {}
        self.used: dict[uuid.UUID, datetime] = {}
        self.held: list[str] = []
        #: What link lifetimes count from; tests set it to their own now.
        self.clock = datetime.now(UTC)

    def put(self, token, kind, owner: Account, *, expires_in=timedelta(hours=1), used_at=None):
        self.by_token[token] = (uuid.uuid4(), kind, self.clock + expires_in, used_at, owner)

    async def link(self, token, kind):
        stored = self.by_token.get(token)
        if stored is None or stored[1] != kind:
            return None
        link_id, kind, expires_at, used_at, owner = stored
        credentials = StoredCredentials(
            self.accounts.by_id[owner.id], self.accounts.hashes[owner.id]
        )
        return AccountLink(link_id, kind, expires_at, self.used.get(link_id, used_at), credentials)

    async def link_for_use(self, token, kind):
        self.held.append(token)
        return await self.link(token, kind)

    async def mark_used(self, link_id, at):
        self.used[link_id] = at


@dataclass
class AccessWorld:
    attempts: FakeAttempts = field(default_factory=FakeAttempts)
    accounts: FakeAccessAccounts = field(default_factory=FakeAccessAccounts)
    passwords: FakePasswords = field(default_factory=FakePasswords)
    directory: FakeDirectory = field(default_factory=FakeDirectory)
    sessions: FakeSessions = field(default_factory=FakeSessions)
    journal: FakeJournal = field(default_factory=FakeJournal)

    def __post_init__(self) -> None:
        self.links = FakeAccountLinks(self.accounts)

    @property
    def ports(self) -> AccessPorts:
        return AccessPorts(
            attempts=self.attempts,
            accounts=self.accounts,
            passwords=self.passwords,
            directory=self.directory,
            sessions=self.sessions,
            links=self.links,
            journal=self.journal,
        )


class FakeShareLinks:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, ShareLink] = {}
        self.tokens: dict[str, uuid.UUID] = {}
        self.staged = None
        self.held: list[str] = []

    def put(self, link: ShareLink, token: str | None = None) -> ShareLink:
        self.by_id[link.id] = link
        if token:
            self.tokens[token] = link.id
        return link

    async def links(self):
        return sorted(self.by_id.values(), key=lambda item: item.created_at, reverse=True)

    async def link(self, link_id):
        return self.by_id.get(link_id)

    async def stage(self, new):
        self.staged = new
        return f"share-{len(self.tokens)}"

    async def staged_link(self):
        new = self.staged
        link = ShareLink(
            uuid.uuid4(),
            new.label,
            new.starts_on,
            new.ends_on,
            new.expires_at,
            new.created_by_id,
            datetime.now(UTC),
            None,
            None,
        )
        return self.put(link, f"share-{len(self.tokens)}")

    async def link_for_exchange(self, token):
        self.held.append(token)
        link_id = self.tokens.get(token)
        return self.by_id.get(link_id) if link_id else None

    async def mark_used(self, link_id, at):
        self.by_id[link_id] = replace(self.by_id[link_id], used_at=at)

    async def revoke(self, link_id, at):
        self.by_id[link_id] = replace(self.by_id[link_id], revoked_at=at)


class FakeFeeds:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, CalendarFeed] = {}
        self.tokens: dict[str, uuid.UUID] = {}
        self.read: list[uuid.UUID] = []

    async def issue(self, new):
        feed = CalendarFeed(
            uuid.uuid4(),
            new.kind,
            new.label,
            new.member_id,
            new.share_link_id,
            new.created_by_id,
            datetime.now(UTC),
            None,
            None,
        )
        token = f"feed-{len(self.tokens)}"
        self.by_id[feed.id] = feed
        self.tokens[token] = feed.id
        return FeedIssued(feed, token)

    async def feed(self, feed_id):
        return self.by_id.get(feed_id)

    async def feed_for_token(self, token):
        feed_id = self.tokens.get(token)
        return self.by_id.get(feed_id) if feed_id else None

    async def feeds_created_by(self, account_id, kind):
        return [
            item
            for item in self.by_id.values()
            if item.created_by_id == account_id and item.kind == kind
        ]

    async def revoke(self, feed_id, at):
        self.by_id[feed_id] = replace(self.by_id[feed_id], revoked_at=at)

    async def mark_read(self, feed_id, at):
        self.read.append(feed_id)


@dataclass
class SharingWorld:
    links: FakeShareLinks = field(default_factory=FakeShareLinks)
    feeds: FakeFeeds = field(default_factory=FakeFeeds)
    sessions: FakeSessions = field(default_factory=FakeSessions)
    journal: FakeJournal = field(default_factory=FakeJournal)
    team: FakeTeam = field(default_factory=FakeTeam)
    roster: FakeRoster = field(default_factory=FakeRoster)

    @property
    def ports(self) -> SharingPorts:
        return SharingPorts(
            links=self.links,
            sessions=self.sessions,
            link_journal=self.journal,
            feeds=self.feeds,
            feed_journal=self.journal,
            team=self.team,
            roster=self.roster,
        )
