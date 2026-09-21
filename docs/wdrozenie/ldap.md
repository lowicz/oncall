# Logowanie z katalogu (LDAP / Active Directory)

Logowanie z katalogu jest opcjonalne i domyślnie wyłączone. Konta lokalne
działają zawsze, również wtedy, gdy katalog jest niedostępny.

## Jak przebiega logowanie

Każda próba przechodzi te same kroki. Nazwy w nawiasach to wartości pola
`phase=` w logu - patrz [Diagnostyka](#diagnostyka).

1. Sprawdzenie konfiguracji (`config`).
2. Połączenie z serwerem (`connect`) i szyfrowanie (`tls`): StartTLS dla
   `ldap://`, TLS od pierwszego bajtu dla `ldaps://`.
3. Logowanie kontem serwisowym (`service_bind`).
4. Wyszukanie **dokładnie jednego** konta filtrem (`search`).
5. Logowanie jako to konto hasłem wpisanym przez użytkownika (`user_bind`).
6. Odczyt numeru kadrowego, imienia, nazwiska i e-maila (`attributes`) -
   dopiero po sprawdzeniu hasła.

Pierwsze udane logowanie zakłada konto `viewer`, kolejne synchronizują dane.
Powiązanie z kontem lokalnym opisuje [Role i dostęp](../produkt/role-i-dostep.md#konta-i-logowanie).

## Konfiguracja

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `ONCALL_LDAP_ENABLED` | `false` | włącza logowanie z katalogu |
| `ONCALL_LDAP_SERVER_URI` | brak | `ldap://nazwa` albo `ldaps://nazwa` kontrolera; nazwa taka jak w jego certyfikacie, nie adres IP |
| `ONCALL_LDAP_START_TLS` | `true` | StartTLS dla `ldap://`; Active Directory odrzuca logowanie hasłem bez szyfrowania, więc nie wyłączaj |
| `ONCALL_LDAP_CA_FILE` | puste | pakiet CA, które wystawiło certyfikat kontrolera - patrz [Certyfikat katalogu](#certyfikat-katalogu) |
| `ONCALL_LDAP_CONNECT_TIMEOUT_SECONDS` | `5` | limit czasu połączenia i odpowiedzi |
| `ONCALL_LDAP_BIND_DN` | brak | konto serwisowe: DN albo `login@domena` |
| `ONCALL_LDAP_BIND_PASSWORD` | brak | hasło konta serwisowego |
| `ONCALL_LDAP_BASE_DN` | brak | gałąź, w której szukane są konta, np. `DC=firma,DC=pl` |
| `ONCALL_LDAP_USER_FILTER` | `(&(objectClass=user)(sAMAccountName={username}))` | musi zawierać `{username}` |
| `ONCALL_LDAP_ATTRIBUTE_PERSONNEL_NUMBER` | `employeeNumber` | numer kadrowy (same cyfry); w wielu domenach jest w `employeeID` |
| `ONCALL_LDAP_ATTRIBUTE_FIRST_NAME` | `givenName` | imię, wymagane |
| `ONCALL_LDAP_ATTRIBUTE_LAST_NAME` | `sn` | nazwisko, może być puste |
| `ONCALL_LDAP_ATTRIBUTE_EMAIL` | `mail` | e-mail, może być pusty |

Wielkość liter w nazwach atrybutów nie ma znaczenia (`employeeID` i
`employeeid` to ten sam atrybut). Z domyślnym filtrem użytkownik loguje się
samą nazwą konta (`anna`), nie `anna@firma.example` ani `FIRMA\anna`.

Minimalne prawa konta serwisowego: odczyt kont w `ONCALL_LDAP_BASE_DN` i
czterech atrybutów powyżej. Hasło użytkownika sprawdza sam katalog - aplikacja
go nie przechowuje.

## Certyfikat katalogu

API zawsze weryfikuje certyfikat kontrolera domeny. Bez `ONCALL_LDAP_CA_FILE`
ufa tylko publicznym urzędom z obrazu, a certyfikaty kontrolerów Active
Directory wystawia zwykle wewnętrzne CA (AD CS). Wtedy wskaż pakiet CA
organizacji nakładką `docker-compose.ldap-ca.yml`:

```bash
# .env - ścieżka na hoście, plik PEM z korzeniem i pośrednimi
ONCALL_LDAP_CA_FILE=/etc/pki/tls/certs/firma-ca.pem
```

```bash
docker compose -f docker-compose.yml -f docker-compose.ldap-ca.yml up -d
# razem z HTTPS
docker compose -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.ldap-ca.yml up -d
```

Domyślna ścieżka to `./tls/ca.pem` - ten sam pakiet, który nakładka
[TLS](tls.md) montuje dla nginx. Plik musi istnieć przed startem i mieć prawa
`0644`. Po ustawieniu pliku katalogowi ufa się **wyłącznie** według niego.

Sprawdzenie certyfikatu z hosta, na którym działa Compose:

```bash
openssl s_client -connect dc1.firma.example:389 -starttls ldap \
  -CAfile /etc/pki/tls/certs/firma-ca.pem -verify_hostname dc1.firma.example </dev/null
# albo dla ldaps://
openssl s_client -connect dc1.firma.example:636 \
  -CAfile /etc/pki/tls/certs/firma-ca.pem -verify_hostname dc1.firma.example </dev/null
```

`Verify return code: 0 (ok)` oznacza, że API też zaakceptuje certyfikat.

## Diagnostyka

Użytkownik dostaje zawsze jedną z ogólnych odpowiedzi („Nieprawidłowy login lub
hasło”, „Logowanie katalogowe jest chwilowo niedostępne”). Powód jest w logu
API, na domyślnym poziomie, bez żadnego przełącznika:

```bash
docker compose logs api | grep -E 'event=(login|ldap_auth)'
# jedna próba - wszystkie wiersze z tym samym attempt=
docker compose logs api | grep 'attempt=eac19f62'
```

Każda próba logowania to jeden wiersz `event=login` z wynikiem. Próba z
katalogiem, która nie skończyła się tożsamością, dokłada jeden wiersz
`event=ldap_auth` z miejscem i powodem. Oba mają to samo `attempt=`:

```
2026-09-21 13:26:11,436 WARNING event=ldap_auth attempt=eac19f62 login=anna outcome=unavailable phase=tls reason=certificate_verify_failed detail="unable to get local issuer certificate" server=ldap://dc1.corp.example.com:389 tls=starttls elapsed_ms=19
2026-09-21 13:26:11,436 INFO event=login attempt=eac19f62 login=anna outcome=directory_unavailable
```

Udane logowanie to jeden wiersz `INFO`:

```
2026-09-21 13:26:38,238 INFO event=login attempt=d239e38a login=anna outcome=signed_in source=ldap
```

### Pola

| Pole | Znaczenie |
| --- | --- |
| `attempt` | identyfikator jednej próby logowania |
| `login` | login wpisany przez użytkownika |
| `outcome` | `event=login`: `signed_in`, `rejected`, `throttled`, `directory_unavailable`, `identity_conflict`; `event=ldap_auth`: `rejected`, `unavailable`, `invalid_identity` |
| `phase` | krok, na którym próba się zatrzymała |
| `reason` | powód - tabela poniżej; kod wyniku LDAP (np. `invalidCredentials`) albo nazwa nadana przez aplikację |
| `detail` | krótkie uzupełnienie, np. komunikat weryfikacji certyfikatu |
| `result` | numeryczny kod wyniku LDAP |
| `ad_code`, `ad_reason` | kod Active Directory z odmowy logowania, np. `775` / `account_locked` |
| `attribute` | nazwa atrybutu z błędną wartością (sama nazwa, bez wartości) |
| `missing` | puste zmienne konfiguracji |
| `cause` | przy `event=login`: dlaczego odmówiono albo skąd konflikt tożsamości |
| `source` | przy `signed_in`: `local` albo `ldap` |
| `server`, `tls` | serwer i sposób szyfrowania: `starttls`, `ldaps` albo `none` |
| `elapsed_ms` | czas rozmowy z katalogiem |
| `error`, `at` | przy `unexpected_error`: typ wyjątku i miejsce w kodzie |

### Co oznacza powód

| `phase` | `reason` | Co sprawdzić |
| --- | --- | --- |
| `config` | `settings_missing` | zmienne wymienione w `missing=` są puste (puste hasło konta serwisowego też) |
| `config` | `server_uri_invalid` | `ONCALL_LDAP_SERVER_URI` musi mieć postać `ldap://host[:port]` albo `ldaps://host[:port]` |
| `config` | `filter_without_username` | `ONCALL_LDAP_USER_FILTER` nie zawiera `{username}` |
| `config` | `ca_file_unreadable` | pliku z `detail=` nie ma w kontenerze albo nie da się go czytać: nakładka, ścieżka, prawa `0644` |
| `connect` | `host_not_resolved` | kontener `api` nie rozwiązuje nazwy serwera (DNS) |
| `connect` | `connection_refused`, `unreachable`, `timeout` | port i zapora: `389` dla `ldap://`, `636` dla `ldaps://` |
| `tls` | `certificate_verify_failed` | `detail=unable to get local issuer certificate`: brak CA - [Certyfikat katalogu](#certyfikat-katalogu); `certificate has expired`: certyfikat kontrolera wygasł; `Missing Authority Key Identifier`: certyfikat nie spełnia ścisłej weryfikacji X.509, trzeba go wystawić ponownie |
| `tls` | `certificate_name_mismatch` | nazwy z `ONCALL_LDAP_SERVER_URI` nie ma w certyfikacie (częsty przypadek: adres IP zamiast nazwy) |
| `tls` | `tls_failed` | `detail=wrong_version_number`: `ldaps://` na porcie `389` albo odwrotnie |
| `tls` | `unwillingToPerform`, `connection_closed` | kontroler nie ma certyfikatu dla LDAP albo StartTLS trafia na port LDAPS `636` |
| `service_bind` | `invalidCredentials` | DN albo hasło konta serwisowego; `ad_reason` mówi więcej: `password_expired`, `account_locked`, `account_disabled` |
| `service_bind` | `strongerAuthRequired` | kontroler wymaga szyfrowania: `ONCALL_LDAP_START_TLS=true` albo `ldaps://` |
| `search` | `noSuchObject` | `ONCALL_LDAP_BASE_DN` nie istnieje |
| `search` | `operationsError`, `insufficientAccessRights` | konto serwisowe nie może przeszukiwać tej gałęzi |
| `search` | `invalid_filter` | błąd składni w `ONCALL_LDAP_USER_FILTER` |
| `search` | `multiple_entries` | filtr pasuje do więcej niż jednego konta - zawęź go |
| `search` | `user_not_found` | (`rejected`) konta nie ma w `ONCALL_LDAP_BASE_DN` pod tym filtrem; najczęściej literówka albo login w innej postaci niż ta, której szuka filtr |
| `user_bind` | `invalidCredentials` | (`rejected`) `ad_reason`: `invalid_credentials` - złe hasło; `account_locked`, `password_expired`, `password_must_change`, `account_disabled`, `account_expired` - stan konta w AD |
| `attributes` | `personnel_number_missing`, `personnel_number_not_numeric` | atrybut z `attribute=` jest pusty albo nie same cyfry; w wielu domenach numer jest w `employeeID` - wskaż go w [konfiguracji](#konfiguracja) |
| `attributes` | `first_name_missing`, `email_invalid`, `attribute_too_long`, `attribute_not_text` | popraw wartość atrybutu w AD albo wskaż inny atrybut |
| dowolna | `unexpected_error` | błąd w aplikacji albo bibliotece LDAP: zgłoś go z polami `error` i `at` |

Przy `event=login`:

| `outcome` | `cause` | Co to znaczy |
| --- | --- | --- |
| `rejected` | `credentials_rejected` | ani hasło lokalne, ani katalog nie potwierdziły danych |
| `rejected` | `account_inactive` | konto jest wyłączone w aplikacji (ekran „Osoby”) |
| `identity_conflict` | `personnel_number_mismatch` | konto o tym loginie ma inny numer kadrowy albo żadnego - popraw go na koncie |
| `identity_conflict` | `login_taken` | konto z tym numerem kadrowym istnieje, ale login z katalogu ma inne konto |

Odmowy (`rejected`) mają poziom `INFO`, problemy do naprawienia po stronie
wdrożenia - `WARNING`, `unexpected_error` - `ERROR`. Ten sam powód, po polsku,
trafia do audytu jako „Logowanie LDAP niedostępne”.

### Czego log nie zawiera

Haseł, tokenu i cookie sesji, DN i hasła konta serwisowego, DN konta
użytkownika, wartości atrybutów ani tekstu błędu przysłanego przez katalog - z
odpowiedzi katalogu trafia do logu tylko kod wyniku i kod Active Directory.
Login jest zapisywany, bo bez niego nie da się powiązać wpisu ze zgłoszeniem;
znaki, które mogłyby udawać nowy wiersz, są cytowane.
