# Logowanie przez SSO (Keycloak)

Logowanie przez SSO jest opcjonalne i domyślnie wyłączone. Po włączeniu
ekran logowania ma pod formularzem hasła przycisk **„Zaloguj przez SSO”**,
który prowadzi do Keycloak. Login i hasło (konta lokalne i
[LDAP / Active Directory](ldap.md)) działają dalej bez zmian, również wtedy,
gdy Keycloak jest niedostępny.

Konfiguracja samego Keycloak (realm, użytkownicy, federacja z katalogiem) nie
jest częścią aplikacji; ta strona mówi, czego aplikacja od niego oczekuje.

## Jak przebiega logowanie

Aplikacja używa OpenID Connect, przepływu Authorization Code z PKCE (S256).
Całą rozmowę z Keycloak prowadzi API: przeglądarka przechodzi tylko dwa
przekierowania, a żaden token nie trafia do JavaScriptu. Nazwy w nawiasach to
wartości pola `phase=` w logu - patrz [Diagnostyka](#diagnostyka).

1. Przycisk otwiera `/api/v1/auth/sso/start`. API pobiera konfigurację
   Keycloak (`discovery`) spod `ONCALL_SSO_ISSUER/.well-known/openid-configuration`,
   zapisuje w krótkim cookie `oncall_sso` (10 minut) `state`, `nonce`,
   weryfikator PKCE i ekran, na który osoba ma wrócić, i przekierowuje
   przeglądarkę do Keycloak.
2. Osoba loguje się w Keycloak tak, jak tam ustawiono.
3. Keycloak przekierowuje na `/api/v1/auth/sso/callback`. API sprawdza `state`
   z cookie i wymienia kod na tokeny bezpośrednio z Keycloak (`exchange`).
4. API weryfikuje token ID (`verify`): podpis kluczem z JWKS realmu, wystawcę,
   odbiorcę (identyfikator klienta), czas ważności i `nonce`. Token dostępu
   jest odrzucany, token odświeżania nie jest przechowywany.
5. Z tokenu ID API czyta numer kadrowy (domyślnie claim `employeeNumber`) i
   szuka konta z tym samym numerem kadrowym (`account`).
6. Konto aktywne dostaje zwykłą sesję - to samo cookie, ten sam czas życia i
   ta sama ochrona CSRF co po logowaniu hasłem - a osoba wraca na ekran, z
   którego przyszła.

Numer kadrowy to ten sam klucz, którym [logowanie z katalogu](ldap.md) wiąże
konta, i ten sam, który administrator wpisuje na ekranie „Osoby”. SSO **nie
zakłada kont**, nie synchronizuje danych i nie zmienia sposobu logowania
konta: konto lokalne zachowuje hasło, konto z katalogu - logowanie z
katalogu. Konto bez numeru kadrowego nie zaloguje się przez SSO.

Konfigurację i klucze Keycloak API trzyma w pamięci procesu; nowy klucz
(rotacja w realmie) pobiera samo, gdy token jest nim podpisany.

## Konfiguracja

Zmienne czyta tylko kontener `api`.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `ONCALL_SSO_ENABLED` | `false` | włącza przycisk „Zaloguj przez SSO” i logowanie przez Keycloak |
| `ONCALL_SSO_ISSUER` | brak | adres realmu, dokładnie taki jak `iss` w tokenach, np. `https://keycloak.firma.example/realms/firma`; zaczyna się od `https://` albo `http://` |
| `ONCALL_SSO_CLIENT_ID` | brak | identyfikator klienta w Keycloak, np. `oncall` |
| `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER` | `employeeNumber` | claim tokenu ID z numerem kadrowym (same cyfry, najwyżej 32) |
| `ONCALL_SSO_TIMEOUT_SECONDS` | `5` | limit czasu każdego wywołania Keycloak (konfiguracja, klucze, wymiana kodu), najwyżej 60 |

`ONCALL_SSO_ENABLED=true` z pustym `ONCALL_SSO_ISSUER` albo
`ONCALL_SSO_CLIENT_ID` zatrzymuje API przy starcie. Adresu powrotu nie
ustawia się osobno: API wylicza go z `ONCALL_PUBLIC_BASE_URL`.

```bash
# w .env
ONCALL_SSO_ENABLED=true
ONCALL_SSO_ISSUER=https://keycloak.firma.example/realms/firma
ONCALL_SSO_CLIENT_ID=oncall
```

Zmiana działa po ponownym uruchomieniu `api` (`docker compose up -d api`).

## Klient w Keycloak

Administrator Keycloak zakłada w realmie klienta z tymi ustawieniami:

| Ustawienie | Wartość |
| --- | --- |
| Client type | OpenID Connect |
| Client ID | ta sama wartość co `ONCALL_SSO_CLIENT_ID` |
| Client authentication | **wyłączone** (klient publiczny, bez sekretu) |
| Standard flow | włączony |
| Direct access grants | wyłączone |
| Proof Key for Code Exchange Code Challenge Method | `S256` |
| Valid redirect URIs | dokładnie `ONCALL_PUBLIC_BASE_URL` + `/api/v1/auth/sso/callback`, np. `https://oncall.firma.example:8443/api/v1/auth/sso/callback` - z portem, bez `*` |
| Web origins | puste |

Do tego mapper w zakładce „Client scopes” klienta (dedykowany zakres) albo we
wspólnym zakresie:

| Ustawienie | Wartość |
| --- | --- |
| Mapper type | User Attribute (albo atrybut z federacji LDAP) |
| User Attribute | atrybut z numerem kadrowym, np. `employeeNumber` |
| Token Claim Name | ta sama wartość co `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER` |
| Claim JSON Type | String |
| Add to ID token | **włączone** |

Numer musi być w **tokenie ID**. Mapper, który dodaje go tylko do tokenu
dostępu albo do userinfo, kończy każde logowanie odmową
`reason=claim_missing`.

## Certyfikat Keycloak

API zawsze weryfikuje certyfikat Keycloak. Gdy wystawiło go wewnętrzne CA
albo ruch przechodzi przez firmowe proxy TLS, dołóż to CA do
[pliku CA](uruchomienie.md#plik-ca) wdrożenia (`ONCALL_CA_FILE`) i uruchom
stos z nakładką `docker-compose.ca.yml`. Tak jak dla SMTP, CA z pliku
dochodzą do publicznych CA obrazu, nie zastępują ich.

## Gdy Keycloak jest niedostępny

Przycisk zostaje na ekranie logowania (aplikacja nie sprawdza Keycloak z
wyprzedzeniem). Gdy Keycloak nie odpowiada przy starcie logowania, przy
wymianie kodu albo przy pobieraniu kluczy, osoba wraca na ekran logowania z
komunikatem „Logowanie SSO jest chwilowo niedostępne” i formularzem hasła.
Żadne wywołanie nie trwa dłużej niż `ONCALL_SSO_TIMEOUT_SECONDS`. Logowanie
hasłem i z katalogu oraz otwarte sesje działają dalej.

## Wylogowanie

„Wyloguj” kończy tylko sesję w aplikacji. Sesja w Keycloak zostaje, więc
kolejne „Zaloguj przez SSO” wpuszcza bez pytania o hasło, dopóki trwa sesja
Keycloak. Klient nie potrzebuje adresu powrotu po wylogowaniu.

## Bezpieczeństwo i ograniczenia

- **Adres powrotu musi się zgadzać co do znaku** z `ONCALL_PUBLIC_BASE_URL`
  (schemat, nazwa, port). Różnica kończy się w Keycloak komunikatem „Invalid
  parameter: redirect_uri”, zanim aplikacja w ogóle zobaczy logowanie.
- **Numer kadrowy decyduje o koncie.** Kto zmienia atrybut z numerem w
  Keycloak (albo w katalogu, z którego Keycloak go czyta), decyduje, na które
  konto wejdzie osoba - tak samo jak dziś z `employeeNumber` w AD. Unikalny
  numer kadrowy w aplikacji wyklucza dwa konta z tym samym numerem.
- **Zegar.** Token ID jest sprawdzany z tolerancją 60 sekund. Większa różnica
  zegarów między hostem aplikacji a Keycloak odrzuca każde logowanie
  (`reason=token_expired`); oba hosty powinny synchronizować czas (NTP).
- **Wspólny komputer.** Ponieważ „Wyloguj” nie kończy sesji Keycloak, kolejna
  osoba, która na tym samym komputerze naciśnie „Zaloguj przez SSO”, wejdzie
  na konto poprzedniej, dopóki trwa jej sesja w Keycloak. Na stanowiskach
  współdzielonych trzeba wylogować się także z Keycloak albo zamknąć
  przeglądarkę.
- **Czas życia sesji** jest aplikacji (12 godzin), nie Keycloak: osoba
  zablokowana w Keycloak zachowuje otwartą sesję, dopóki ta nie wygaśnie albo
  administrator nie wyłączy konta na ekranie „Osoby” - jak przy AD.
- **Bez limitu prób.** Adres powrotu nie ma limitu prób logowania, celowo:
  hasło sprawdza Keycloak, a podrobione wywołanie kończy się jedną odrzuconą
  wymianą kodu.
- **Dwa adresy GET zmieniające stan.** `/api/v1/auth/sso/start` i
  `/api/v1/auth/sso/callback` ustawiają cookie i otwierają sesję zwykłym
  `GET`, bo tak działa przekierowanie OpenID Connect; nie przechodzą przez
  ochronę CSRF, a przed podrobieniem chroni je `state` i `nonce` związane z
  przeglądarką przez cookie `oncall_sso` (`HttpOnly`, `SameSite=Lax`,
  `Secure` tak jak cookie sesji). Ekran powrotu musi być ścieżką w tej samej
  aplikacji; każdy inny adres zamienia się na `/`.
- Polityka CSP zostaje bez zmian: przeglądarka nie łączy się z Keycloak z
  JavaScriptu, przechodzi tylko przekierowaniem.

## Diagnostyka

Osoba widzi jeden z czterech komunikatów, opisanych w
[Rozwiązywanie problemów](../uzytkownik/rozwiazywanie-problemow.md#logowanie).
Powód jest w logu API, na domyślnym poziomie:

```bash
docker compose logs api | grep -E 'event=(login|sso_auth)'
```

Udane logowanie to wiersz `event=login` z `outcome=signed_in source=sso`.
Logowanie zatrzymane po drodze dokłada wiersz `event=sso_auth` z `phase=` i
`reason=`. Log nie zawiera kodu autoryzacji, tokenów ani adresu z kodem.

Do audytu trafiają: udane logowanie jako „Logowanie” (`auth.login`, w
szczegółach `via=sso`), odmowa jako „Odrzucono logowanie SSO”
(`auth.sso_rejected`, z numerem kadrowym, gdy żadne konto go nie ma, żeby
administrator mógł założyć konto) i niedostępny Keycloak jako „SSO niedostępne”
(`auth.sso_unavailable`). Wszystkie trzy podlegają retencji zwykłych logowań,
`ONCALL_RETENTION_LOGIN_AUDIT_DAYS`.

### Co oznacza powód

| `phase` | `reason` | Co sprawdzić |
| --- | --- | --- |
| `discovery`, `exchange`, `verify` | `host_not_resolved` | kontener `api` nie rozwiązuje nazwy z `ONCALL_SSO_ISSUER` (DNS) |
| `discovery`, `exchange`, `verify` | `connection_refused`, `timeout` | port, zapora albo przeciążony Keycloak; limit to `ONCALL_SSO_TIMEOUT_SECONDS` |
| `discovery`, `exchange`, `verify` | `certificate_verify_failed` | brak CA Keycloak - [Certyfikat Keycloak](#certyfikat-keycloak) |
| `discovery` | inny | `ONCALL_SSO_ISSUER` nie wskazuje realmu: otwórz `ONCALL_SSO_ISSUER/.well-known/openid-configuration` z hosta i sprawdź, czy to JSON |
| `exchange` | `invalid_grant` | kod wygasł albo został już użyty (cofnięcie w przeglądarce, podwójne kliknięcie): wystarczy spróbować ponownie; powtarzalnie - klient nie ma PKCE `S256` albo `Client authentication` jest włączone |
| `verify` | `token_expired` | różnica zegarów między hostem aplikacji a Keycloak przekracza 60 sekund |
| `verify` | `claim_missing` | w tokenie ID nie ma claimu z `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER`: mapper nie ma „Add to ID token” albo nazwa claimu się różni - [Klient w Keycloak](#klient-w-keycloak) |
| `verify` | inny | token nie przeszedł sprawdzenia wystawcy, odbiorcy, podpisu albo `nonce`; `ONCALL_SSO_ISSUER` musi być identyczny z `iss`, a `ONCALL_SSO_CLIENT_ID` z identyfikatorem klienta |
| `account` | `no_account` | żadne konto nie ma tego numeru kadrowego: administrator wpisuje numer na koncie na ekranie „Osoby” albo zakłada konto |
| `account` | `account_inactive` | konto jest wyłączone w aplikacji (ekran „Osoby”) |
| dowolna | `unexpected_error` | błąd w aplikacji: zgłoś go z całym wierszem logu |
