# SSO sign-in (Keycloak)

SSO sign-in is optional and disabled by default. Once enabled, the sign-in
screen has a **“Sign in with SSO”** button under the password form, which
leads to Keycloak. Username and password (local accounts and
[LDAP / Active Directory](ldap.md)) keep working unchanged, also when Keycloak
is unavailable.

Configuring Keycloak itself (the realm, users, directory federation) is not
part of the application; this page says what the application expects of it.

## How sign-in proceeds

The application uses OpenID Connect, the Authorization Code flow with PKCE
(S256). The API carries the whole conversation with Keycloak: the browser only
follows two redirects, and no token ever reaches JavaScript. The names in
brackets are the values of the `phase=` field in the log - see
[Diagnostics](#diagnostics).

1. The button opens `/api/v1/auth/sso/start`. The API fetches Keycloak's
   configuration (`discovery`) from `ONCALL_SSO_ISSUER/.well-known/openid-configuration`,
   stores `state`, `nonce`, the PKCE verifier and the screen to return to in a
   short-lived `oncall_sso` cookie (10 minutes) and redirects the browser to
   Keycloak.
2. The person signs in at Keycloak, however it is set up there.
3. Keycloak redirects to `/api/v1/auth/sso/callback`. The API checks `state`
   against the cookie and exchanges the code for tokens directly with Keycloak
   (`exchange`).
4. The API verifies the ID token (`verify`): the signature with a key from the
   realm's JWKS, the issuer, the audience (the client id), the validity period
   and `nonce`. The access token is discarded, no refresh token is kept.
5. The API reads the personnel number from the ID token (the `employeeNumber`
   claim by default) and looks for the account with the same personnel number
   (`account`).
6. An active account gets an ordinary session - the same cookie, the same
   lifetime and the same CSRF protection as after a password sign-in - and the
   person returns to the screen they came from.

The personnel number is the same key [directory sign-in](ldap.md) links
accounts by, and the same one the administrator types on the “People” screen.
SSO **creates no accounts**, synchronises no data and does not change how an
account signs in: a local account keeps its password, a directory account its
directory sign-in. An account without a personnel number cannot sign in with
SSO.

The API keeps Keycloak's configuration and keys in process memory; it fetches
a new key (rotation in the realm) by itself when a token is signed with it.

## Configuration

Only the `api` container reads these variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONCALL_SSO_ENABLED` | `false` | turns on the “Sign in with SSO” button and sign-in through Keycloak |
| `ONCALL_SSO_ISSUER` | none | the realm's address, exactly as `iss` in the tokens, e.g. `https://keycloak.company.example/realms/company`; starts with `https://` or `http://` |
| `ONCALL_SSO_CLIENT_ID` | none | the client id in Keycloak, e.g. `oncall` |
| `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER` | `employeeNumber` | the ID token claim with the personnel number (digits only, at most 32) |
| `ONCALL_SSO_TIMEOUT_SECONDS` | `5` | time limit of each call to Keycloak (configuration, keys, code exchange), at most 60 |

`ONCALL_SSO_ENABLED=true` with an empty `ONCALL_SSO_ISSUER` or
`ONCALL_SSO_CLIENT_ID` stops the API at startup. The return address is not set
separately: the API derives it from `ONCALL_PUBLIC_BASE_URL`.

```bash
# in .env
ONCALL_SSO_ENABLED=true
ONCALL_SSO_ISSUER=https://keycloak.company.example/realms/company
ONCALL_SSO_CLIENT_ID=oncall
```

The change takes effect after restarting `api` (`docker compose up -d api`).

## Keycloak client

The Keycloak administrator creates a client in the realm with these settings:

| Setting | Value |
| --- | --- |
| Client type | OpenID Connect |
| Client ID | the same value as `ONCALL_SSO_CLIENT_ID` |
| Client authentication | **off** (a public client, no secret) |
| Standard flow | on |
| Direct access grants | off |
| Proof Key for Code Exchange Code Challenge Method | `S256` |
| Valid redirect URIs | exactly `ONCALL_PUBLIC_BASE_URL` + `/api/v1/auth/sso/callback`, e.g. `https://oncall.company.example:8443/api/v1/auth/sso/callback` - port included, no `*` |
| Web origins | empty |

Plus a mapper in the client's “Client scopes” tab (the dedicated scope) or in
a shared scope:

| Setting | Value |
| --- | --- |
| Mapper type | User Attribute (or an attribute from LDAP federation) |
| User Attribute | the attribute holding the personnel number, e.g. `employeeNumber` |
| Token Claim Name | the same value as `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER` |
| Claim JSON Type | String |
| Add to ID token | **on** |

The number must be in the **ID token**. A mapper that adds it only to the
access token or to userinfo ends every sign-in in a refusal with
`reason=claim_missing`.

## Keycloak certificate

The API always verifies Keycloak's certificate. When an internal CA issued it,
or the traffic passes through a corporate TLS proxy, add that CA to the
deployment's [CA file](uruchomienie.md#ca-file) (`ONCALL_CA_FILE`) and start
the stack with the `docker-compose.ca.yml` overlay. As for SMTP, the CAs from
the file are added to the image's public CAs, not substituted for them.

## When Keycloak is unavailable

The button stays on the sign-in screen (the application does not probe
Keycloak in advance). When Keycloak does not answer at the start of the
sign-in, at the code exchange or when fetching keys, the person returns to the
sign-in screen with the message “SSO sign-in is temporarily unavailable” and
the password form. No call lasts longer than `ONCALL_SSO_TIMEOUT_SECONDS`.
Password and directory sign-in, and open sessions, keep working.

## Signing out

“Sign out” ends only the session in the application. The Keycloak session
stays, so the next “Sign in with SSO” lets the person in without asking for a
password for as long as the Keycloak session lasts. The client needs no
post-logout redirect address.

## Security and limitations

- **The return address must match `ONCALL_PUBLIC_BASE_URL` character for
  character** (scheme, name, port). A difference ends at Keycloak with
  “Invalid parameter: redirect_uri”, before the application sees the sign-in
  at all.
- **The personnel number decides the account.** Whoever changes the
  attribute with the number in Keycloak (or in the directory Keycloak reads it
  from) decides which account a person enters - just as with `employeeNumber`
  in AD today. The unique personnel number in the application rules out two
  accounts with the same number.
- **Clock.** The ID token is checked with a 60-second tolerance. A larger
  clock difference between the application host and Keycloak refuses every
  sign-in (`reason=token_expired`); both hosts should synchronise their time
  (NTP).
- **Shared computer.** Since “Sign out” does not end the Keycloak session, the
  next person who presses “Sign in with SSO” on the same computer enters the
  previous person's account for as long as their Keycloak session lasts. On
  shared workstations, sign out of Keycloak too or close the browser.
- **Session lifetime** is the application's (12 hours), not Keycloak's: a
  person blocked in Keycloak keeps an open session until it expires or the
  administrator disables the account on the “People” screen - as with AD.
- **No attempt limit.** The return address has no sign-in attempt limit, on
  purpose: Keycloak checks the password, and a forged call ends in one refused
  code exchange.
- **Two state-changing GET addresses.** `/api/v1/auth/sso/start` and
  `/api/v1/auth/sso/callback` set a cookie and open a session with a plain
  `GET`, because that is how an OpenID Connect redirect works; they bypass the
  CSRF protection, and forgery is prevented by `state` and `nonce` bound to the
  browser through the `oncall_sso` cookie (`HttpOnly`, `SameSite=Lax`,
  `Secure` like the session cookie). The return screen must be a path within
  the same application; any other address becomes `/`.
- The CSP stays unchanged: the browser does not connect to Keycloak from
  JavaScript, it only follows a redirect.

## Diagnostics

The person sees one of four messages, described in
[Troubleshooting](../uzytkownik/rozwiazywanie-problemow.md#signing-in). The
cause is in the API log, at the default level:

```bash
docker compose logs api | grep -E 'event=(login|sso_auth)'
```

A successful sign-in is an `event=login` line with
`outcome=signed_in source=sso`. A sign-in stopped along the way adds an
`event=sso_auth` line with `phase=` and `reason=`. The log contains no
authorisation code, no tokens and no address carrying the code.

The audit records: a successful sign-in as “Sign-in” (`auth.login`, with
`via=sso` in the details), a refusal as “SSO sign-in refused”
(`auth.sso_rejected`, with the personnel number when no account has it, so
the administrator can create the account) and an unavailable Keycloak as
“SSO unavailable” (`auth.sso_unavailable`). All three fall under the
retention of routine sign-ins, `ONCALL_RETENTION_LOGIN_AUDIT_DAYS`.

### What the reason means

| `phase` | `reason` | What to check |
| --- | --- | --- |
| `discovery`, `exchange`, `verify` | `host_not_resolved` | the `api` container cannot resolve the name in `ONCALL_SSO_ISSUER` (DNS) |
| `discovery`, `exchange`, `verify` | `connection_refused`, `timeout` | port, firewall or an overloaded Keycloak; the limit is `ONCALL_SSO_TIMEOUT_SECONDS` |
| `discovery`, `exchange`, `verify` | `certificate_verify_failed` | Keycloak's CA is missing - [Keycloak certificate](#keycloak-certificate) |
| `discovery` | other | `ONCALL_SSO_ISSUER` does not point at a realm: open `ONCALL_SSO_ISSUER/.well-known/openid-configuration` from the host and check that it is JSON |
| `exchange` | `invalid_grant` | the code expired or was already used (browser back, double click): just try again; if it repeats, the client lacks PKCE `S256` or has `Client authentication` on |
| `verify` | `token_expired` | the clock difference between the application host and Keycloak exceeds 60 seconds |
| `verify` | `claim_missing` | the ID token has no claim named by `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER`: the mapper lacks “Add to ID token” or the claim name differs - [Keycloak client](#keycloak-client) |
| `verify` | other | the token failed the issuer, audience, signature or `nonce` check; `ONCALL_SSO_ISSUER` must equal `iss` and `ONCALL_SSO_CLIENT_ID` the client id |
| `account` | `no_account` | no account has this personnel number: the administrator types the number on the account on the “People” screen or creates the account |
| `account` | `account_inactive` | the account is disabled in the application (“People” screen) |
| any | `unexpected_error` | an error in the application: report it with the whole log line |
