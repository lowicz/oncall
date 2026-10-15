"""Field validators shared by HTTP request models of several features."""

from oncall.domain.accounts import normalize_phone
from oncall.i18n import translate


def validate_phone(value: str) -> str:
    normalized = normalize_phone(value)
    if normalized is None:
        raise ValueError(translate("validation.phone"))
    return normalized
