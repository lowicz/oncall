import uuid

from oncall.domain.errors import DomainError


class PointsTeamOnly(DomainError):
    """Points are private to the team: viewers see none."""

    def __init__(self) -> None:
        super().__init__("Punkty są widoczne tylko dla zespołu")


class OwnDutiesOnly(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Możesz sprawdzić tylko własne dyżury")
        self.member_id = member_id


class BalanceMemberNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono członka zespołu")
        self.member_id = member_id
