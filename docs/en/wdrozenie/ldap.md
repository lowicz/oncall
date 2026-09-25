# Directory sign-in (LDAP / Active Directory)

Directory sign-in is optional and disabled by default. Local accounts always
work, also when the directory is unavailable.

## How sign-in proceeds

Every attempt goes through the same steps. The names in brackets are the
values of the `phase=` field in the log - see [Diagnostics](#diagnostics).

1. Configuration check (`config`).
2. Connection to the server (`connect`) and encryption (`tls`): StartTLS for
   `ldap://`, TLS from the first byte for `ldaps://`.
3. Sign-in with the service account (`service_bind`).
4. Search for **exactly one** account with the filter (`search`).
5. Sign-in as that account with the password typed by the user (`user_bind`).
6. Reading the personnel number, first name, last name and e-mail
   (`attributes`) - only after the password has been checked.

The first successful sign-in creates a `viewer` account; subsequent ones
synchronise the data. Linking with a local account is described in
[Roles and access](../produkt/role-i-dostep.md#accounts-and-sign-in).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONCALL_LDAP_ENABLED` | `false` | enables directory sign-in |
| `ONCALL_LDAP_SERVER_URI` | none | `ldap://name` or `ldaps://name` of the controller; the name as in its certificate, not an IP address |
| `ONCALL_LDAP_START_TLS` | `true` | StartTLS for `ldap://`; Active Directory rejects password sign-in without encryption, so do not disable it |
| `ONCALL_LDAP_CA_FILE` | empty | the bundle of the CA that issued the controller's certificate - see [Directory certificate](#directory-certificate) |
| `ONCALL_LDAP_CONNECT_TIMEOUT_SECONDS` | `5` | the connection and response timeout |
| `ONCALL_LDAP_BIND_DN` | none | the service account: a DN or `login@domain` |
| `ONCALL_LDAP_BIND_PASSWORD` | none | the service account's password |
| `ONCALL_LDAP_BASE_DN` | none | the branch in which accounts are searched for, e.g. `DC=firma,DC=pl` |
| `ONCALL_LDAP_USER_FILTER` | `(&(objectClass=user)(sAMAccountName={username}))` | must contain `{username}` |
| `ONCALL_LDAP_ATTRIBUTE_PERSONNEL_NUMBER` | `employeeNumber` | the personnel number (digits only); in many domains it is in `employeeID` |
| `ONCALL_LDAP_ATTRIBUTE_FIRST_NAME` | `givenName` | first name, required |
| `ONCALL_LDAP_ATTRIBUTE_LAST_NAME` | `sn` | last name, may be empty |
| `ONCALL_LDAP_ATTRIBUTE_EMAIL` | `mail` | e-mail, may be empty |
| `ONCALL_LDAP_ATTRIBUTE_PHOTO` | `thumbnailPhoto` | the user's photo shown as the avatar - see [User photo](#user-photo); empty disables it |

The case of attribute names does not matter (`employeeID` and `employeeid`
are the same attribute). With the default filter the user signs in with the
bare account name (`anna`), not `anna@firma.example` or `FIRMA\anna`.

The minimum rights of the service account: reading the accounts in
`ONCALL_LDAP_BASE_DN` and the five attributes above. The user's password is
checked by the directory itself - the application does not store it.

## User photo

A directory account sees in the account menu (top right corner, on a phone
also the “More” screen) its photo from the directory instead of initials.
Active Directory keeps it in `thumbnailPhoto` (the same photo that Outlook and
Teams show), a directory with the `inetOrgPerson` class - in `jpegPhoto`;
point `ONCALL_LDAP_ATTRIBUTE_PHOTO` at that attribute. Local accounts and link
sessions always have initials.

The photo is read on demand, after sign-in, only for the signed-in person: the
service account searches for their account with the same filter as at sign-in
and reads one attribute. The application does not store the photo in the
database or in the log; the browser keeps it in memory until the end of the
session and does not save it in its cache, so the next person on the same
computer will not see it. Only a JPEG or PNG (recognised by its contents, not
its name) of up to 256 KiB is shown - any other value, no photo, no right to
read the attribute or an unavailable directory the interface answers with
initials, and the reason is in the log as `event=ldap_photo`
([Diagnostics](#diagnostics)).

## Directory certificate

The API always verifies the domain controller's certificate. Without
`ONCALL_LDAP_CA_FILE` it trusts only the public authorities from the image,
and the certificates of Active Directory controllers are usually issued by an
internal CA (AD CS). In that case point at the organisation's CA bundle with
the `docker-compose.ldap-ca.yml` overlay:

```bash
# .env - a path on the host, a PEM file with the root and the intermediates
ONCALL_LDAP_CA_FILE=/etc/pki/tls/certs/firma-ca.pem
```

```bash
docker compose -f docker-compose.yml -f docker-compose.ldap-ca.yml up -d
# together with HTTPS
docker compose -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.ldap-ca.yml up -d
```

The default path is `./tls/ca.pem` - the same bundle that the [TLS](tls.md)
overlay mounts for nginx. The file must exist before the start and have
`0644` permissions. Once the file is set, the directory is trusted **solely**
according to it.

Checking the certificate from the host where Compose runs:

```bash
openssl s_client -connect dc1.firma.example:389 -starttls ldap \
  -CAfile /etc/pki/tls/certs/firma-ca.pem -verify_hostname dc1.firma.example </dev/null
# or for ldaps://
openssl s_client -connect dc1.firma.example:636 \
  -CAfile /etc/pki/tls/certs/firma-ca.pem -verify_hostname dc1.firma.example </dev/null
```

`Verify return code: 0 (ok)` means that the API will accept the certificate
too.

## Diagnostics

The user always gets one of the generic answers (“Wrong username or
password”, “Directory sign-in is temporarily unavailable”). The reason is in
the API log, at the default level, without any switch:

```bash
docker compose logs api | grep -E 'event=(login|ldap_auth)'
# one attempt - all the lines with the same attempt=
docker compose logs api | grep 'attempt=eac19f62'
```

Every sign-in attempt is one `event=login` line with the outcome. A directory
attempt that did not end with an identity adds one `event=ldap_auth` line
with the place and the reason. Both have the same `attempt=`:

```
2026-09-21 13:26:11,436 WARNING event=ldap_auth attempt=eac19f62 login=anna outcome=unavailable phase=tls reason=certificate_verify_failed detail="unable to get local issuer certificate" server=ldap://dc1.corp.example.com:389 tls=starttls elapsed_ms=19
2026-09-21 13:26:11,436 INFO event=login attempt=eac19f62 login=anna outcome=directory_unavailable
```

A successful sign-in is one `INFO` line:

```
2026-09-21 13:26:38,238 INFO event=login attempt=d239e38a login=anna outcome=signed_in source=ldap
```

### Fields

| Field | Meaning |
| --- | --- |
| `attempt` | the identifier of one sign-in attempt |
| `login` | the username typed by the user |
| `outcome` | `event=login`: `signed_in`, `rejected`, `throttled`, `directory_unavailable`, `identity_conflict`; `event=ldap_auth`: `rejected`, `unavailable`, `invalid_identity`; `event=ldap_photo`: `skipped`, `unavailable` |
| `phase` | the step at which the attempt stopped |
| `reason` | the reason - table below; an LDAP result code (e.g. `invalidCredentials`) or a name given by the application |
| `detail` | a short supplement, e.g. the certificate verification message |
| `result` | the numeric LDAP result code |
| `ad_code`, `ad_reason` | the Active Directory code from the sign-in refusal, e.g. `775` / `account_locked` |
| `attribute` | the name of the attribute with the invalid value (the name alone, without the value) |
| `size`, `limit` | with `photo_too_large`: the size of the photo in the directory and the largest one shown, in bytes |
| `missing` | the empty configuration variables |
| `cause` | with `event=login`: why it was refused or where the identity conflict comes from |
| `source` | with `signed_in`: `local` or `ldap` |
| `server`, `tls` | the server and the encryption method: `starttls`, `ldaps` or `none` |
| `elapsed_ms` | the time of the conversation with the directory |
| `error`, `at` | with `unexpected_error`: the exception type and the place in the code |

### What the reason means

| `phase` | `reason` | What to check |
| --- | --- | --- |
| `config` | `settings_missing` | the variables listed in `missing=` are empty (an empty service account password counts too) |
| `config` | `server_uri_invalid` | `ONCALL_LDAP_SERVER_URI` must have the form `ldap://host[:port]` or `ldaps://host[:port]` |
| `config` | `filter_without_username` | `ONCALL_LDAP_USER_FILTER` does not contain `{username}` |
| `config` | `ca_file_unreadable` | the file from `detail=` is not in the container or cannot be read: the overlay, the path, `0644` permissions |
| `connect` | `host_not_resolved` | the `api` container does not resolve the server name (DNS) |
| `connect` | `connection_refused`, `unreachable`, `timeout` | the port and the firewall: `389` for `ldap://`, `636` for `ldaps://` |
| `tls` | `certificate_verify_failed` | `detail=unable to get local issuer certificate`: no CA - [Directory certificate](#directory-certificate); `certificate has expired`: the controller's certificate has expired; `Missing Authority Key Identifier`: the certificate does not meet strict X.509 verification and has to be reissued |
| `tls` | `certificate_name_mismatch` | the name from `ONCALL_LDAP_SERVER_URI` is not in the certificate (a common case: an IP address instead of a name) |
| `tls` | `tls_failed` | `detail=wrong_version_number`: `ldaps://` on port `389` or the other way round |
| `tls` | `unwillingToPerform`, `connection_closed` | the controller has no certificate for LDAP, or StartTLS hits the LDAPS port `636` |
| `service_bind` | `invalidCredentials` | the DN or the password of the service account; `ad_reason` says more: `password_expired`, `account_locked`, `account_disabled` |
| `service_bind` | `strongerAuthRequired` | the controller requires encryption: `ONCALL_LDAP_START_TLS=true` or `ldaps://` |
| `search` | `noSuchObject` | `ONCALL_LDAP_BASE_DN` does not exist |
| `search` | `operationsError`, `insufficientAccessRights` | the service account cannot search this branch |
| `search` | `invalid_filter` | a syntax error in `ONCALL_LDAP_USER_FILTER` |
| `search` | `multiple_entries` | the filter matches more than one account - narrow it down |
| `search` | `user_not_found` | (`rejected`) the account is not in `ONCALL_LDAP_BASE_DN` under this filter; most often a typo, or a username in a different form than the one the filter looks for |
| `user_bind` | `invalidCredentials` | (`rejected`) `ad_reason`: `invalid_credentials` - wrong password; `account_locked`, `password_expired`, `password_must_change`, `account_disabled`, `account_expired` - the account's state in AD |
| `attributes` | `personnel_number_missing`, `personnel_number_not_numeric` | the attribute from `attribute=` is empty or not digits only; in many domains the number is in `employeeID` - point at it in the [configuration](#configuration) |
| `attributes` | `first_name_missing`, `email_invalid`, `attribute_too_long`, `attribute_not_text` | fix the attribute's value in AD or point at a different attribute |
| `attributes` | `photo_too_large`, `photo_format_unsupported` | (`ldap_photo`, `skipped`) the photo in the attribute from `attribute=` is larger than `limit=` bytes or is not a JPEG or PNG file; upload a smaller photo to the directory |
| `search` | `user_not_found` | (`ldap_photo`, `skipped`) the signed-in account has disappeared from the directory since sign-in |
| any | `unexpected_error` | an error in the application or the LDAP library: report it with the `error` and `at` fields |

With `event=login`:

| `outcome` | `cause` | What it means |
| --- | --- | --- |
| `rejected` | `credentials_rejected` | neither the local password nor the directory confirmed the credentials |
| `rejected` | `account_inactive` | the account is disabled in the application (the “People” screen) |
| `identity_conflict` | `personnel_number_mismatch` | the account with this username has a different personnel number, or none - fix it on the account |
| `identity_conflict` | `login_taken` | an account with this personnel number exists, but the username from the directory belongs to a different account |

Refusals (`rejected`) and skipped photos (`skipped`) have the `INFO` level,
problems to be fixed on the deployment side - `WARNING`, `unexpected_error` -
`ERROR`. The same reason, in plain words, goes into the audit as “LDAP
unavailable”; reading the photo is not a sign-in and does not go into the
audit.

### What the log does not contain

Passwords, the session token and cookie, the DN and password of the service
account, the DN of the user's account, attribute values or the error text sent
by the directory - from the directory's response only the result code and the
Active Directory code go into the log. The username is recorded, because
without it an entry cannot be tied to a report; characters that could pass for
a new line are quoted.
