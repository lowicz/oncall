"""The demo seed's member names: the default set or ``ONCALL_DEMO_NAMES``."""

import pytest

from oncall.seed_demo import DEMO_LOGINS, DEMO_NAMES, demo_names


def test_unset_or_blank_keeps_the_default_names() -> None:
    assert demo_names(None) == DEMO_NAMES
    assert demo_names("   ") == DEMO_NAMES
    assert demo_names(None) is not DEMO_NAMES, "callers get their own list"


def test_configured_names_are_split_and_trimmed_in_login_order() -> None:
    names = demo_names(" Anna Carter, Mark Brown ,Olivia Reed,Peter Hale ")

    assert names == ["Anna Carter", "Mark Brown", "Olivia Reed", "Peter Hale"]
    assert len(names) == len(DEMO_LOGINS)


@pytest.mark.parametrize(
    "configured",
    [
        "Anna Carter,Mark Brown,Olivia Reed",
        "Anna Carter,Mark Brown,Olivia Reed,Peter Hale,Extra Person",
        "Anna Carter,,Olivia Reed,Peter Hale",
    ],
)
def test_wrong_count_or_empty_name_stops_the_seed(configured: str) -> None:
    with pytest.raises(SystemExit, match="exactly 4 comma-separated names"):
        demo_names(configured)
