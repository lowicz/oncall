import uuid

from oncall.domain.errors import DomainError


class PointsTeamOnly(DomainError):
    """Points are private to the team: viewers see none."""

    def __init__(self) -> None:
        super().__init__("balance.points_team_only")


class OwnDutiesOnly(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("balance.own_duties_only")
        self.member_id = member_id


class BalanceMemberNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("balance.member_not_found")
        self.member_id = member_id
