# Role i dostęp

## Cztery role

| Rola | Etykieta w aplikacji | Zakres |
| --- | --- | --- |
| `viewer` | Podgląd | wyłącznie opublikowany grafik |
| `member` | Członek zespołu | podgląd oraz własna dostępność, zamiany i bilans |
| `coordinator` | Koordynator | generowanie, korekty, publikacja, zatwierdzanie zamian, raporty, import |
| `admin` | Administrator | wszystko powyżej oraz konta, eligibility, wydarzenia, udostępnienia i audyt |

Role są kumulatywne: administrator widzi wszystko, co koordynator.

## Co widzi która rola

| Ekran (ścieżka) | viewer | member | coordinator | admin |
| --- | :---: | :---: | :---: | :---: |
| Teraz (`/`) | tak | tak | tak | tak |
| Grafik (`/grafik`) | tak | tak | tak | tak |
| Moje (`/moje`) | nie | tak | tak | tak |
| Zamiany (`/zamiany`) | nie | tak | tak | tak |
| Generator (`/generator`) | nie | nie | tak | tak |
| Sprawiedliwość (`/sprawiedliwosc`) | nie | tylko siebie | cały zespół | cały zespół |
| Import historii (`/import`) | nie | nie | tak | tak |
| Raport miesięczny (`/raporty`) | nie | nie | tak | tak |
| Osoby (`/osoby`) | nie | nie | nie | tak |
| Wydarzenia (`/wydarzenia`) | nie | nie | nie | tak |
| Udostępnienia (`/udostepnienia`) | nie | nie | nie | tak |
| Audyt (`/audyt`) | nie | nie | nie | tak |

Pozycje nawigacji niedostępne dla roli po prostu się nie pokazują. Wejście
adresem na ekran spoza uprawnień przenosi na ekran „Teraz”; niezależnie od tego
każde żądanie do API jest sprawdzane po stronie serwera. **Interfejs nie jest
granicą bezpieczeństwa.**

Koordynator i administrator mają dostęp do ekranu „Moje” nawet wtedy, gdy sami
nie są w rotacji: to tam zgłaszają dostępność w imieniu osoby, która nie może
zrobić tego sama.

## Czego viewer nie zobaczy nigdy

- szkiców i wyników generatora,
- dostępności i powodów niedostępności (to dane prywatne),
- punktów, bilansu i prognoz sprawiedliwości,
- wniosków o zamianę,
- ustawień generowania i audytu.

Powód niedostępności jest prywatny również między członkami zespołu: widzi go
autor wpisu oraz koordynator i administrator.

## Konta i logowanie

- **Konto lokalne** - login i hasło (minimum 12 znaków), hash Argon2id.
- **Konto z katalogu (LDAP / Active Directory)** - opcjonalne, wyłączone
  domyślnie. Pierwsze udane logowanie z katalogu zakłada aktywne konto
  `viewer` kluczowane numerem kadrowym; kolejne synchronizują login, imię,
  nazwisko i e-mail, zostawiając lokalnie zarządzane rolę, status, rotację i
  eligibility.
- **Powiązanie konta lokalnego z katalogiem** następuje automatycznie przy
  pierwszym logowaniu z katalogu, jeśli **numer kadrowy konta zgadza się z
  `employeeNumber`**. Po powiązaniu hasło lokalne przestaje działać. Niezgodny
  numer kończy się konfliktem `409` zapisanym w audycie - poprawia go
  administrator na koncie.

Sesja jest cookie `HttpOnly`, `Secure`, `SameSite=Lax`, z ochroną CSRF na
operacjach zmieniających stan. Wylogowanie unieważnia sesję natychmiast.

## Dostęp czasowy bez konta

Administrator może wystawić **link podglądowy** związany z odbiorcą, zakresem
dat i datą wygaśnięcia (maksymalnie 30 dni). Otwarcie `/share/{token}` wymienia
jednorazowy token na ograniczoną sesję i usuwa token z paska adresu. Taka sesja:

- widzi wyłącznie opublikowany grafik przycięty do zakresu linku,
- wygasa razem z linkiem,
- przestaje działać natychmiast po odwołaniu linku.

Stałą formą dostępu pozostaje imienne konto `viewer`; link czasowy jest
wyjątkiem.
