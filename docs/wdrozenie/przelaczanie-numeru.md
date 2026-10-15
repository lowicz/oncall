# Włączenie przełączania numeru

Ta strona prowadzi przez włączenie automatycznego przełączania numeru
on-call przez Orange WCO na działającym wdrożeniu, krok po kroku, od
aktualizacji wydania do pracy w trybie **Włączone**. Jak funkcja działa,
opisują [Integracje](../produkt/integracje.md#przełączanie-numeru-on-call-orange-wco),
a ekran - [Administracja](../uzytkownik/administracja.md#przełączanie-numeru-przelaczanie-administrator).

Po aktualizacji przełączanie jest wyłączone (tryb **Wyłączone**) i nic się
nie zmienia, dopóki administrator aplikacji go nie włączy. Kroki do
[klucza](#klucz-szyfrujący) włącznie robi administrator hosta, w
katalogu wdrożenia (`~/oncall`); dalsze - administrator aplikacji na ekranie
**Przełączanie numeru** (`/przelaczanie`).

## Lista kontrolna

1. `.env` nie przypisuje `ONCALL_LDAP_CA_FILE`, `ONCALL_SMTP_CA_FILE`,
   `ONCALL_WCO_CA_FILE` ani `ONCALL_TLS_CA_FILE`; zaufane CA są w jednym
   pliku `ONCALL_CA_FILE` ([Przed aktualizacją](#przed-aktualizacją)).
2. Drop-in jednostki nie wymienia starych nakładek CA, tylko
   `docker-compose.ca.yml`.
3. Próbny alarm e-mail dochodzi, a koordynatorzy i administratorzy mają
   adresy e-mail.
4. Lokalne konto administratora działa, a jego hasło jest w sejfie.
5. Wydanie zaktualizowane, logowanie z katalogu działa
   ([Aktualizacja](#aktualizacja)).
6. `ONCALL_SECRETS_KEY` ustawiony i zapisany w sejfie
   ([Klucz](#klucz-szyfrujący)).
7. Każda osoba w rotacji ma numer w formacie `+48500500500`
   ([Numery telefonów](#numery-telefonów)).
8. Konto WCO zapisane, **Sprawdź połączenie** zwraca „Połączenie działa”
   ([Konto WCO](#konto-wco-i-sprawdzenie-połączenia)).
9. Jedno odsłonięcie hasła WCO od początku do końca, z wpisem „Odsłonięto
   hasło WCO” w Audycie ([Ręczne przełączenie](#ręczne-przełączenie)).
10. Tryb **Próbny** przez co najmniej trzy dni robocze bez niepowodzeń
    ([Tryb próbny](#tryb-próbny)).
11. Potwierdzenie przed włączeniem
    ([Potwierdzenie](#potwierdzenie-przed-włączeniem)).
12. Tryb **Włączone** w dniu roboczym przed godziną przypomnienia, z
    obserwacją przełączenia ([Włączenie](#włączenie)).

## Przed aktualizacją

Wydanie z przełączaniem numeru czyta wszystkie zaufane CA z jednego pliku,
`ONCALL_CA_FILE`, i nakładki `docker-compose.ca.yml` -
[Jeden plik CA](aktualizacja.md#jeden-plik-ca). Dopóki `.env` albo jednostka
używa starych nazw, `update.sh` odmawia, niczego nie zmieniając. Sprawdź oba
miejsca przed aktualizacją:

```bash
cd ~/oncall
grep -nE '^(export )?ONCALL_(LDAP|SMTP|WCO|TLS)_CA_FILE=' .env
systemctl --user cat oncall | grep ONCALL_COMPOSE_FILES
```

- **`.env`**: wdrożenie zaktualizowane wcześniej przez `update.sh` ma z
  dawnego `.env.example` linię `ONCALL_TLS_CA_FILE=./tls/ca.pem`. Linię ze
  ścieżką `./tls/ca.pem` usuń. Inną ścieżkę zamień na
  `ONCALL_CA_FILE=<ścieżka>`; gdy kilka zmiennych wskazywało różne pliki,
  połącz je w jeden pakiet PEM, np.
  `cat /etc/pki/firma-root.pem /etc/pki/firma-ad.pem > tls/ca.pem`.
- **Drop-in**: gdy `ONCALL_COMPOSE_FILES` wymienia
  `docker-compose.ldap-ca.yml`, `docker-compose.smtp-ca.yml` albo
  `docker-compose.wco-ca.yml`, `update.sh` wypisze gotowe polecenie `sed`,
  które zastępuje je jednym `docker-compose.ca.yml`, oraz
  `systemctl --user daemon-reload`. Wykonaj je i od razu uruchom aktualizację
  ponownie: do jej końca jednostka nie wystartuje
  (`missing docker-compose.ca.yml`). Bez tej linii jednostka startuje
  domyślne trzy pliki i nic nie trzeba zmieniać.

Plik CA (domyślnie `./tls/ca.pem`) musi istnieć i mieć prawa `0644` -
[Plik CA](uruchomienie.md#plik-ca). Połączenie z WCO jest zawsze
weryfikowane; `wco.orange.pl` ma certyfikat publicznego CA, więc firmowe CA
jest potrzebne tylko za proxy TLS. Kontenery `worker` (przełączanie) i `api`
(**Sprawdź połączenie**) muszą mieć dostęp do `https://wco.orange.pl` (port
443).

Alarm o nieudanym przełączeniu to e-mail, więc SMTP musi działać.
Sprawdza to próbny alarm kopii zapasowych, wysyłany do jego odbiorców:

```bash
./deploy/backup/oncall-backup.sh alert --test
```

Alarm dostają aktywni koordynatorzy i administratorzy, którzy mają adres
e-mail, oraz osoba na PRIMARY; konto bez adresu nie dostanie niczego.

Zachowaj lokalne konto administratora: `ONCALL_ADMIN_USERNAME` i
`ONCALL_ADMIN_PASSWORD` w `.env` zakładają je i synchronizują przy każdym
starcie `api` ([Konto administratora](uruchomienie.md#konto-administratora)).
Hasło trzymaj w sejfie organizacji. Gdy katalog LDAP i przełączanie zawiodą
naraz, tylko to konto odsłoni hasło WCO.

## Aktualizacja

Aktualizację robi `update.sh` z numerem wydania -
[Aktualizacja wdrożenia](aktualizacja.md). Do `.env` dochodzi pusta zmienna
`ONCALL_SECRETS_KEY` (skrypt wypisuje `added ONCALL_SECRETS_KEY`) i
zakomentowana `ONCALL_LDAP_ATTRIBUTE_PHONE`. Migracje przy starcie `api`
zapisują istniejące numery telefonów jako `+48` i dziewięć cyfr, gdy się da.

Po aktualizacji sprawdź logowanie kontem z katalogu i próbny alarm, jak
wyżej. Przełączanie zostaje wyłączone.

## Klucz szyfrujący

Hasło WCO leży w bazie zaszyfrowane kluczem Fernet z `ONCALL_SECRETS_KEY`.
Bez klucza ekran nie zapisze hasła ani nie włączy przełączania. Nowy klucz
wypisuje obraz aplikacji:

```bash
cd ~/oncall
podman compose exec api python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Wpisz go do `.env` i uruchom stos ponownie:

```bash
# w .env: ONCALL_SECRETS_KEY=<klucz wypisany wyżej>
systemctl --user restart oncall
```

Klucz, który nie jest kluczem Fernet, zatrzymuje start `api` i `worker`; log
podaje, który wpis po przecinku jest zły.

**Kopia klucza.** Klucz zapisz w sejfie organizacji razem z `.env`. Zrzuty
bazy go nie zawierają ([Co jest w kopii](kopie-zapasowe.md#co-jest-w-kopii)),
a odtworzona baza bez tego samego klucza ma nieczytelne hasło WCO. Klucz
chroni wartość, którą administrator może odsłonić, więc jego granica jest
taka sama jak konta administratora.

**Co ginie bez klucza.** Tylko hasło WCO (i hasło oczekujące w trakcie
zmiany). Proces roboczy zapisuje wtedy niepowodzenie „Konfiguracja WCO jest
niekompletna lub niedostępna”, a **Pokaż hasło** i **Sprawdź połączenie**
odmawiają. W trybie **Włączone** proces sam zmienia wygasłe hasło, więc
aplikacja bywa jedynym miejscem, które zna bieżące hasło: po utracie klucza
trzeba je ustalić albo zresetować w Orange, ustawić nowy klucz i wpisać
hasło w polu **Hasło WCO**. Grafik, konta i reszta danych nie zależą od
klucza.

**Rotacja klucza.** Dopisz nowy klucz na początku (`nowy,stary`) i uruchom
stos ponownie. Odsłoń hasło, wpisz je przez **Zmień hasło** i **Zapisz** -
zapis szyfruje je nowym kluczem. Potem usuń stary klucz i znowu uruchom stos
ponownie. Rób to, gdy karta **Stan** nie pokazuje trwającej zmiany hasła.

## Numery telefonów

Celem przekierowania jest telefon z konta osoby na PRIMARY, zapisany jako
`+48` i dziewięć cyfr (`+48500500500`) i wysyłany do WCO bez zmian. Na
ekranie **Osoby** filtr **W rotacji** pokazuje każdą osobę, która może
dostać PRIMARY: brak numeru jest w kolumnie telefonu czerwony, a numer w
innym formacie ma dopisek „popraw numer”. Numer poprawia administrator w
panelu osoby albo sama osoba na ekranie
[Moje](../uzytkownik/dostepnosc.md#mój-telefon). Opcjonalnie
`ONCALL_LDAP_ATTRIBUTE_PHONE` uzupełnia pusty numer z katalogu przy
logowaniu - [Numer telefonu](ldap.md#numer-telefonu).

Gdy osoba na PRIMARY nie ma numeru, proces niczego w WCO nie zmienia, a w
trybie **Włączone** wysyła alarm.

## Konto WCO i sprawdzenie połączenia

Na ekranie **Przełączanie numeru**, z trybem **Wyłączone**:

1. Wpisz **Numer centrali**, **Login**, **Identyfikator użytkownika WCO**
   (użytkownik WCO, którego numer jest celem przekierowania) i **Hasło WCO**.
   **Adres WCO** zostaje `https://wco.orange.pl`. Kliknij **Zapisz**.
2. Kliknij **Sprawdź połączenie**. Oczekiwany wynik to „Połączenie działa.
   WCO przekierowuje teraz na +48…”, z numerem, na który numer on-call jest
   teraz przełączony ręcznie.

Sprawdzenie loguje się do WCO i tylko czyta; w Audycie zostaje wpis
„Sprawdzono przełączanie numeru”. Inne wyniki opisuje
[Rozwiązywanie problemów](#rozwiązywanie-problemów). Nie powtarzaj
sprawdzenia z hasłem, które WCO odrzuciło: kolejne nieudane logowania mogą
zablokować konto WCO.

## Tryb próbny

Ustaw **Tryb** na **Próbny** i kliknij **Zapisz**. W ciągu kilku sekund
proces roboczy loguje się do WCO, odczytuje numer i zapisuje, co by ustawił,
niczego w WCO nie zmieniając. Robi to raz na dzień dyżuru, o godzinie
przypomnienia (`ONCALL_HANDOVER_REMINDER_HOUR`, domyślnie 9:00), i ponownie
po korekcie grafiku albo zmianie ustawień. Alarmów e-mail w tym trybie nie
ma.

Wynik czytasz w dwóch miejscach:

- karta **Stan**: **Cel** (osoba na PRIMARY, jej numer, dzień dyżuru),
  **WCO przekierowuje na** (numer, który WCO trzyma teraz) i **Wynik**
  „próba, bez zmian”;
- **Audyt**, akcja „Sprawdzono przełączanie numeru”, aktor `system`:
  „Próba przełączenia numeru na <osoba>”, a w **Szczegóły** `day`,
  `desired_number` (co proces by ustawił) i `current_number` (co WCO
  trzyma). Wpisy tej samej akcji z administratorem jako aktorem to ręczne
  **Sprawdź połączenie**.

Każdego dnia sprawdź, że `desired_number` to numer osoby, która według
**Grafiku** ma PRIMARY, a `current_number` ma ten sam format (`+48` i
dziewięć cyfr) co numery w aplikacji. Wpisy „Nie udało się przełączyć
numeru” i „Pominięto przełączenie numeru” pokazują, co zawiodłoby w trybie
**Włączone** - przyczyna jest w treści wpisu. W trybie próbnym proces nie
zmienia wygasłego hasła: zgłasza niepowodzenie i ponawia po godzinie.

## Potwierdzenie przed włączeniem

Tryb **Włączone** włącza właściciel wdrożenia, gdy:

- tryb **Próbny** trwał co najmniej trzy dni robocze, a każdego dnia
  `desired_number` zgadzał się z grafikiem i nie było niepowodzeń;
- format `current_number` z WCO jest taki sam jak format numerów w
  aplikacji, więc przełączenie nie zmieni zapisu numeru w WCO;
- wszystkie wcześniejsze pozycje [listy kontrolnej](#lista-kontrolna) są
  odhaczone;
- koordynatorzy wiedzą, że od włączenia nie przełączają numeru ręcznie, a
  po alarmie postępują według
  [Ręcznego przełączenia](#ręczne-przełączenie).

Wybierz dzień roboczy i moment przed godziną przypomnienia, z kimś, kto o
tej godzinie obserwuje kartę **Stan** i Audyt.

## Włączenie

Ustaw **Tryb** na **Włączone** i kliknij **Zapisz**. Zapis zeruje stan
poprzedniego trybu, więc proces działa w ciągu kilku sekund:

- przed godziną przypomnienia celem jest osoba na PRIMARY z poprzedniego
  dnia, która ma dyżur do tej godziny;
- gdy WCO już przekierowuje na numer celu, **Wynik** to „bez zmian” i wpisu w
  Audycie nie ma;
- w przeciwnym razie proces zmienia numer, odczytuje go z WCO dla
  potwierdzenia, **Wynik** to „przełączono”, a Audyt dostaje „Przełączono
  numer on-call” („Numer on-call przełączono na <osoba>”).

O godzinie przypomnienia proces przełącza numer na dzisiejszą osobę na
PRIMARY. Sprawdź wtedy kartę **Stan** i Audyt, a potem zadzwoń na numer
on-call i upewnij się, że dzwoni telefon tej osoby.

Od tej chwili przypomnienie z pierwszego dnia dyżuru PRIMARY mówi „Numer
on-call jest przełączany automatycznie o 09:00. Jeśli połączenia nie
docierają, skontaktuj się z koordynatorem.” zamiast „Pamiętaj o przełączeniu
numeru on-call.”. Po udanym przełączeniu proces czyta WCO ponownie dopiero
wtedy, gdy zmieni się numer do ustawienia: o najbliższej godzinie
przypomnienia, po korekcie grafiku lub zamianie, która zmienia osobę na
PRIMARY albo jej numer, i po zapisaniu ustawień przełączania. Numer zmieniony
ręcznie w panelu WCO na inny niż numer osoby na PRIMARY zostaje do tej chwili
i wtedy proces go nadpisze. Żeby ręczny numer został, ustaw tryb
**Wyłączone**.

## Alarm e-mail

Gdy przełączenie zawiedzie w trybie **Włączone**, proces wysyła wiadomość:

- temat „Pilne: numer on-call nie został przełączony”, tytuł „Numer on-call
  wymaga pilnej interwencji”;
- fakty: **Dzień dyżuru**, **PRIMARY**, **Numer docelowy** i **Ostatni numer
  WCO** (zamaskowane, np. `+48 500 *** 500`), **Potwierdzony** (kiedy WCO
  ostatnio potwierdziło numer) i **Przyczyna**;
- polecenie „Przełącz numer ręcznie i sprawdź ustawienia przełączania.”, z
  przyciskiem **Przełącz numer ręcznie** prowadzącym do `ONCALL_SWITCH_URL`
  (gdy jest ustawiony) i linkiem **Sprawdź przełączanie** do
  `/przelaczanie`.

Dostają ją aktywni koordynatorzy i administratorzy z adresem e-mail oraz
osoba na PRIMARY. Kiedy wychodzi i kiedy przychodzi wiadomość o powrocie,
opisują [Integracje](../produkt/integracje.md#przełączanie-numeru-on-call-orange-wco).

## Ręczne przełączenie

Gdy automat zawiedzie, administrator odsłania hasło WCO i przełącza numer w
panelu WCO - pełna procedura:
[Ręczne przełączenie numeru](../uzytkownik/administracja.md#ręczne-przełączenie-numeru).

Przed włączeniem zrób jedno odsłonięcie (**Pokaż hasło**) od początku do
końca, także zalogowanie w panelu WCO bez zmiany numeru, i znajdź w Audycie
wpis „Odsłonięto hasło WCO”. Zrób to
lokalnym kontem administratora, żeby sprawdzić drogę na wypadek awarii LDAP.

## Zmiana hasła WCO

W trybie **Włączone** proces sam zmienia hasło, gdy WCO zgłosi jego
wygaśnięcie: ustawia nowe (20 znaków, cztery klasy znaków), zapisując je
najpierw jako oczekujące, i przyjmuje je po udanym logowaniu. Audyt dostaje
„Zmieniono hasło WCO”, a karta **Stan** datę w **Hasło WCO zmieniono**.
Nikt nie dostaje o tym e-maila; bieżące hasło zna tylko aplikacja i pokazuje
je **Pokaż hasło**. Hasło odrzucone przez WCO z powodu polityki proces
zastępuje nowym, najwyżej trzy razy na przebieg; potem wysyła alarm z
przyczyną „Hasło WCO wygasło, a jego automatyczna zmiana nie powiodła się”.

Nie zmieniaj hasła w panelu WCO, jeśli nie musisz. Gdy musisz, od razu wpisz
nowe w polu **Hasło WCO**: inaczej proces dostanie odmowę logowania, pokaże
„Hasła odrzucone”, przestanie się logować, żeby nie zablokować konta WCO, i
wyśle alarm. Wpisanie hasła zdejmuje tę blokadę.

## Wycofanie

Ustaw **Tryb** na **Wyłączone** i kliknij **Zapisz**. Proces przestaje
łączyć się z WCO przy najbliższym przebiegu, czyli w ciągu kilku sekund. WCO
zostaje na ostatnio ustawionym numerze, a numer znowu przełącza się ręcznie;
przypomnienie z pierwszego dnia dyżuru wraca do „Pamiętaj o przełączeniu
numeru on-call.”. Ustawienia i hasło zostają zapisane, więc ponowne włączenie
zaczyna się od [trybu próbnego](#tryb-próbny). Cofnięcie wydania nie jest do
tego potrzebne.

## Rozwiązywanie problemów

| Objaw | Przyczyna | Co zrobić |
| --- | --- | --- |
| `update.sh` kończy się `.env sets ONCALL_..._CA_FILE` albo `runs per-feature CA overlays` | stara konfiguracja CA | [Przed aktualizacją](#przed-aktualizacją) |
| `api` i `worker` nie startują, log `ONCALL_SECRETS_KEY entry N is not a Fernet key` | zły klucz | wygeneruj klucz poleceniem z sekcji [Klucz szyfrujący](#klucz-szyfrujący) |
| **Zapisz**: „Hasło WCO jest przechowywane zaszyfrowane, a serwer nie ma klucza” | brak `ONCALL_SECRETS_KEY` | ustaw klucz i uruchom stos ponownie |
| „Żaden klucz z ONCALL_SECRETS_KEY nie odszyfrowuje zapisanego hasła WCO” | usunięto klucz, którym zaszyfrowano hasło | przywróć ten klucz jako drugi wpis albo wpisz hasło ponownie |
| „Zmiana adresu WCO wymaga ponownego podania hasła” | zmieniony **Adres WCO** | wpisz hasło razem z nowym adresem |
| **Sprawdź połączenie**: „Nie da się nawiązać zweryfikowanego połączenia z WCO: sprawdź ONCALL_CA_FILE.” | plik CA nie istnieje albo jest nieczytelny | [Plik CA](uruchomienie.md#plik-ca), potem restart |
| **Sprawdź połączenie**: „Nie udało się połączyć z WCO.” | sieć, zapora, awaria WCO | sprawdź dostęp `api` i `worker` do `https://wco.orange.pl`; proces ponawia sam |
| **Sprawdź połączenie**: „WCO odrzuciło zapisane dane logowania.” | zły numer centrali, login albo hasło | popraw dane i wpisz hasło ponownie; nie ponawiaj na ślepo |
| **Sprawdź połączenie**: „Logowanie działa, ale hasło WCO wygasło.” | hasło wygasło | w trybie **Włączone** proces zmieni je sam; w innym trybie zmień je w panelu WCO i od razu wpisz w **Hasło WCO** |
| **Stan**: „Hasła odrzucone”, **Sprawdź połączenie** nieaktywne | WCO odrzuciło każde zapisane hasło | ustal właściwe hasło i wpisz je w **Hasło WCO** |
| **Wynik**: „pominięto: brak numeru” | osoba na PRIMARY nie ma numeru | uzupełnij numer ([Numery telefonów](#numery-telefonów)) |
| **Wynik**: „pominięto: nikogo na PRIMARY” | dzień bez PRIMARY w opublikowanym grafiku | uzupełnij i opublikuj grafik |
| **Przyczyna**: „WCO odrzuciło zmianę numeru” | zły **Identyfikator użytkownika WCO** albo numer, którego WCO nie przyjmuje | sprawdź identyfikator i numer osoby; przełącz ręcznie |
| **Przyczyna**: „Konfiguracja WCO jest niekompletna lub niedostępna” | brak klucza, nieczytelne hasło albo plik CA | wiersze wyżej o kluczu i pliku CA |
| alarm nie przyszedł | SMTP wyłączony albo odbiorca bez adresu e-mail | [Przed aktualizacją](#przed-aktualizacją); w trybie **Próbny** alarmów nie ma |
| ręcznie ustawiony numer wraca do numeru z grafiku | tryb **Włączone** nadpisuje ręczne zmiany przy najbliższym przełączeniu: o godzinie przypomnienia, po korekcie grafiku lub zamianie i po zapisaniu ustawień | ustaw **Wyłączone**, jeśli ręczny numer ma zostać |
