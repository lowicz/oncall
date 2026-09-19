"""The password hasher and the directory, as the sign-in use case sees them."""

from oncall import auth, ldap_auth
from oncall.domain.access.errors import DirectoryFailure
from oncall.domain.access.models import DirectoryIdentity
from oncall.domain.access.ports import Directory, PasswordHasher


class Argon2Passwords(PasswordHasher):
    """Argon2 off the event loop. Looked up on the `auth` module at call time,
    so a test can count verifications."""

    async def verify(self, password_hash: str | None, password: str) -> bool:
        return await auth.verify_password_async(password_hash, password)

    async def verify_decoy(self, password: str) -> None:
        await auth.verify_password_async(auth.DUMMY_PASSWORD_HASH, password)

    async def hash(self, password: str) -> str:
        return await auth.hash_password_async(password)


class DirectoryAuthentication(Directory):
    """Any LDAP authenticator, its failures translated for the domain."""

    def __init__(self, authenticator: ldap_auth.LdapAuthenticator) -> None:
        self._authenticator = authenticator

    async def authenticate(self, login: str, password: str) -> DirectoryIdentity | None:
        try:
            return await self._authenticator.authenticate(login, password)
        except (ldap_auth.DirectoryUnavailableError, ldap_auth.DirectoryIdentityError) as exc:
            raise DirectoryFailure(str(exc)) from exc
