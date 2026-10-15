"""The WCO client as the domain's connection probe: one login with the
stored passwords, in the order the forwarding pass tries them, and one read
of the user whose number is forwarded to. Nothing is written to WCO, and the
outcome names the failed call and its status only, never what WCO answered.
"""

from oncall import trust
from oncall.config import get_settings
from oncall.domain.forwarding.models import ConnectionTest, ConnectionTestOutcome, WcoAccount
from oncall.wco import (
    WcoClient,
    WcoConfigurationError,
    WcoError,
    WcoLoginRefused,
    WcoPasswordExpired,
)


def _open_wco(base_url: str) -> WcoClient:
    """A client that verifies WCO against the deployment's trust, as the
    worker's does; the tests replace it with one on the fake WCO."""
    try:
        verify = trust.tls_context(get_settings())
    except trust.CaFileUnreadable as exc:
        raise WcoConfigurationError(str(exc)) from exc
    return WcoClient(base_url, verify=verify)


async def probe_wco(account: WcoAccount) -> ConnectionTest:
    try:
        async with _open_wco(account.base_url) as wco:
            for password in account.passwords.login_order():
                try:
                    await wco.login(account.vpbx_number, account.username, password)
                    break
                except WcoLoginRefused:
                    continue
            else:
                return ConnectionTest(ConnectionTestOutcome.login_refused)
            try:
                user = await wco.get_user(account.wco_user_id)
            except WcoPasswordExpired:
                return ConnectionTest(ConnectionTestOutcome.password_expired)
    except WcoConfigurationError as exc:
        return ConnectionTest(ConnectionTestOutcome.configuration, detail=str(exc))
    except WcoError as exc:
        return ConnectionTest(ConnectionTestOutcome.connection, detail=str(exc))
    number = user.get("number")
    return ConnectionTest(
        ConnectionTestOutcome.ok, number=number if isinstance(number, str) else None
    )
