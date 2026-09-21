# Dokumentacja On-call

On-call układa i publikuje grafik dyżurów zespołu: kto jest `PRIMARY`,
kto `SECONDARY` i kto obsługuje zmianę `11–19` każdego dnia. Dokumentacja jest
po polsku, tak samo jak interfejs aplikacji, żeby nazwy ekranów, przycisków i
statusów w tekście były dokładnie tymi, które widać na ekranie.

Dokumentacja dzieli się na trzy części.

## Dokumentacja produktowa

Czym aplikacja jest, jakie reguły egzekwuje i dlaczego wynik wygląda tak, jak
wygląda. Czytaj, zanim zaczniesz z kimś ustalać zasady dyżurów.

- [Przegląd produktu](produkt/przeglad.md) - zakres, pojęcia i główne przepływy.
- [Role i dostęp](produkt/role-i-dostep.md) - co widzi i co może każda rola.
- [Model grafiku](produkt/model-grafiku.md) - dyżury, pokrycie, eligibility,
  dostępność, dni wolne i stawka 2X.
- [Generator grafiku](produkt/generator.md) - reguły twarde, wagi miękkie,
  tryby rotacji i kryterium odbioru.
- [Sprawiedliwość](produkt/sprawiedliwosc.md) - jak liczone są punkty i udział.
- [Integracje](produkt/integracje.md) - powiadomienia e-mail, kanały ICS,
  linki podglądowe i raport miesięczny.

## Dokumentacja użytkownika

Instrukcja ekran po ekranie, zadanie po zadaniu.

- [Pierwsze kroki](uzytkownik/pierwsze-kroki.md) - logowanie, hasło, motyw,
  nawigacja.
- [Teraz i Grafik](uzytkownik/dyzury.md) - kto dyżuruje teraz i macierz osób × dni.
- [Moje dyżury i dostępność](uzytkownik/dostepnosc.md) - zgłaszanie „nie mogę”,
  „wolę nie” i „chętnie wezmę”.
- [Zamiany](uzytkownik/zamiany.md) - prośba, akceptacja, zatwierdzenie.
- [Generowanie grafiku](uzytkownik/generowanie-grafiku.md) - dla koordynatora.
- [Administracja](uzytkownik/administracja.md) - osoby, wydarzenia, import,
  raporty, udostępnienia i audyt.
- [Rozwiązywanie problemów](uzytkownik/rozwiazywanie-problemow.md) - komunikaty
  i co z nimi zrobić.

## Wdrożenie

- [Uruchomienie](wdrozenie/uruchomienie.md) - Docker Compose i Podman Compose,
  obrazy z rejestru albo budowanie z repozytorium.
- [Wydania i wersje](wdrozenie/wydania.md) - numer wersji, aktualizacja,
  cofnięcie, weryfikacja pochodzenia obrazów, co sprawdza CI.
- [TLS](wdrozenie/tls.md) - certyfikat, klucz i CA jako trzy osobne pliki.
- [Logowanie z katalogu](wdrozenie/ldap.md) - LDAP / Active Directory,
  certyfikat katalogu i diagnostyka logowania z logu API.

## Dokumenty historyczne

Wcześniejsza zawartość katalogu `docs/` - plany, raporty QA, zrzuty ekranu i
skrypty testowe - została zachowana bez zmian w `archive/docs/`.
Opisuje stan projektu w chwili powstania i nie jest aktualizowana.
