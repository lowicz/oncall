import uuid

from oncall.domain.errors import DomainError

LINK_EXPIRED_OR_REVOKED = "Link wygasł lub został odwołany"


class ShareLinkNotFound(DomainError):
    """An administrator named a link that does not exist."""

    def __init__(self, link_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono linku")
        self.link_id = link_id


class ShareTokenUnknown(DomainError):
    """Somebody presented a one-time token no link was issued with."""

    def __init__(self) -> None:
        super().__init__("Link nie istnieje")


class ShareLinkGone(DomainError):
    """The link existed but can no longer be exchanged."""


class ShareLinkAlreadyUsed(ShareLinkGone):
    def __init__(self, link_id: uuid.UUID) -> None:
        super().__init__("Link został już użyty")
        self.link_id = link_id


class ShareLinkInactive(ShareLinkGone):
    def __init__(self, link_id: uuid.UUID) -> None:
        super().__init__(LINK_EXPIRED_OR_REVOKED)
        self.link_id = link_id


class FeedNotFound(DomainError):
    """A subscription the account cannot see, or that does not exist."""

    def __init__(self, feed_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono subskrypcji")
        self.feed_id = feed_id


class FeedUnavailable(DomainError):
    """A calendar application asked with a token that no longer serves."""

    def __init__(self) -> None:
        super().__init__("Subskrypcja nie istnieje")


class FeedLinkInactive(DomainError):
    """A share-link subscription whose link is revoked or expired."""

    def __init__(self) -> None:
        super().__init__(LINK_EXPIRED_OR_REVOKED)
