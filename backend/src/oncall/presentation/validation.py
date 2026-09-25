"""Field validators shared by HTTP request models of several features."""

import re

from oncall.i18n import translate

#: E.164 (`+48123456789`) or a Polish national number written with spaces or
#: dashes (`123 456 789`, `12-345-67-89`) - decision D8.
PHONE_PATTERN = re.compile(r"^\+?[0-9]{9,15}$")


def validate_phone(value: str) -> str:
    normalized = re.sub(r"[ \-]", "", value.strip())
    if not PHONE_PATTERN.fullmatch(normalized):
        raise ValueError(translate("validation.phone"))
    return normalized
