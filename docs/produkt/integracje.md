# Integracje

## Powiadomienia e-mail

Zdarzenia cyklu zamian, publikacje grafiku, korekty koordynatora,
powiadomienia o rozpoczęciu dyżuru i wiadomość dla koordynatorów z dni roboczych
**zapisują wiersz w tabeli `notification_outbox` w tej samej transakcji co
zmiana biznesowa**. Osobny
proces roboczy opróżnia kolejkę z wykładniczym wycofaniem i dostarcza wiadomości
przez dostawców kanałów.

Konsekwencje tego kształtu:

- Powiadomienie nie może „zniknąć” przy awarii poczty - zostaje w kolejce.
- Zmiana biznesowa nie może się udać, a powiadomienie nie powstać (ani odwrotnie).
- Kanał jest punktem rozszerzenia: dziś `email`, kolejne kanały wpinają się w tę
  samą kolejkę bez dotykania logiki biznesowej.

Dostarczanie jest **co najmniej raz**. Proces roboczy zajmuje partię pod
dzierżawą, wysyła każdą wiadomość bez otwartej transakcji i zapisuje każdy wynik
osobno, więc proces, który zginie w trakcie, powtórzy najwyżej jedną wiadomość -
nigdy całą partię. Każda wiadomość niesie identyfikator wiersza kolejki jako
stabilny klucz idempotencji, który dostawca SMTP wydaje jako stałe `Message-ID`,
więc powtórka jest rozpoznawalna jako ta sama wiadomość.

Serwer SMTP jest **usługą zewnętrzną** - projekt nie hostuje poczty. Bez
skonfigurowanego hosta SMTP wiadomości są oznaczane jako `skipped` z powodem
zapisanym w kolejce. Aplikacja wysyła z logowaniem albo bez niego, przez
przekaźnik, który ufa jej nazwie z EHLO, patrz
[Serwer SMTP](../wdrozenie/uruchomienie.md#serwer-smtp).

Każda wiadomość wychodzi w dwóch wersjach naraz (`multipart/alternative`):
jako zwykły tekst, który mówi wszystko sam, i jako HTML w jasnym motywie
aplikacji - z tym samym oznaczeniem ról (PRIMARY, SECONDARY, 11–19), tymi
samymi kolorami i datami w postaci `czw 24-09-2026`, jaką pokazują ekrany.
Wersja HTML jest pisana pod Outlook 365: układ na tabelach, style wpisane w
elementy, bez czcionek webowych i przezroczystości. Jedyny obrazek, logo w
nagłówku, podróżuje w samej wiadomości (obraz osadzony, `cid:`), więc widać je
także poza siecią instalacji i nie ma go na liście załączników. Nazwa i
podtytuł w nagłówku wiadomości pochodzą z `ONCALL_APP_NAME` i
`ONCALL_APP_SUBTITLE`, a przyciski prowadzą pod `ONCALL_PUBLIC_BASE_URL`.

Korekta koordynatora - pojedyncza albo wsadowa (np. przy zakończeniu rotacji) -
powiadamia obie strony każdego przepisanego slotu: osobę zdejmowaną i
przejmującą. Przy korekcie wsadowej każda osoba dostaje jedną wiadomość z listą
wyłącznie tych slotów, które oddała albo przejęła, oraz z powodem korekty.

Wiadomość o publikacji grafiku dostaje każda osoba z zespołu aktywna w jego
zakresie. Wymienia wyłącznie jej własne dyżury (dzień i rola) albo mówi, że w
tym grafiku nie ma żadnego, i prowadzi do ekranu **Moje** (`/moje`).

Kto zaczyna dyżur w którejkolwiek roli - PRIMARY, SECONDARY albo 11–19 -
dostaje dwie wiadomości o godzinie `ONCALL_HANDOVER_REMINDER_HOUR` (czasu
warszawskiego, domyślnie 9): zapowiedź w ostatni polski dzień roboczy przed
pierwszym dniem dyżuru i przypomnienie w sam pierwszy dzień. Dyżur zaczynający
się w poniedziałek albo w weekend zapowiada więc piątek, a zaczynający się po
święcie - ostatni dzień roboczy przed nim. Osoba oddająca dyżur nie dostaje
o tym wiadomości.

Kolejne dni tej samej roli u tej samej osoby to jeden dyżur: wiadomości
przychodzą tylko na jego początku i podają jego ostatni dzień. Dla 11–19
weekendy i święta, w które tej zmiany nie ma, nie przerywają ciągłości.
Przejście z PRIMARY na SECONDARY zaczyna nowy dyżur, a więc kolejną zapowiedź
i przypomnienie. Role, które ta sama osoba zaczyna tego samego dnia (np.
SECONDARY i 11–19), są w jednej wiadomości, każda z własnym ostatnim dniem.

Gdy wśród zaczynanych ról jest PRIMARY, przypomnienie z pierwszego dnia prosi
o przełączenie numeru on-call, a jeśli ustawiono `ONCALL_SWITCH_URL`, jego
przycisk prowadzi na stronę przełączania. Gdy automatyczne przekierowanie
przez Orange WCO działa w trybie `live`, ta wiadomość i korekta zmieniająca
PRIMARY mówią zamiast tego, że numer przełącza się sam o godzinie
`ONCALL_HANDOVER_REMINDER_HOUR`. Każda z dwóch wiadomości wychodzi do
osoby najwyżej raz, więc kolejne przebiegi procesu roboczego w ciągu dnia
niczego nie dublują.

Każdy koordynator i administrator dostaje w każdy polski dzień roboczy,
o godzinie `ONCALL_COORDINATOR_DIGEST_HOUR` (czasu warszawskiego, domyślnie 8),
wiadomość „Dyżury na dziś”: kto ma dziś PRIMARY, SECONDARY i 11–19, bez
numerów telefonów. Nie da się z niej zrezygnować. Gdy po tym dniu następują dni
wolne od pracy - weekend, święto - wiadomość obejmuje także je, dzień po dniu,
aż do następnego dnia roboczego: piątkowa mówi o piątku, sobocie i niedzieli,
a czwartkowa przed świątecznym piątkiem o czterech dniach. Ma wtedy temat
w rodzaju „Dyżury od 9 do 11 października” i dopisek, że grafik na kolejne dni
może się jeszcze zmienić. W dzień wolny od pracy wiadomość nie wychodzi,
także zaległa. Rola, której nikt nie ma, jest opisana jako „brak obsady”,
a 11–19 w dzień wolny od pracy jako „brak dyżuru (dzień wolny)”. Gdy na te dni
nie ma opublikowanego grafiku, wiadomość i tak wychodzi i mówi o tym wprost.
Jeśli proces roboczy nie działał o tej godzinie, wiadomość wychodzi później
tego samego dnia roboczego; każda osoba dostaje ją najwyżej raz w danym dniu
roboczym, także koordynator dodany już po tej godzinie. Bez
skonfigurowanego hosta SMTP ta wiadomość w ogóle nie trafia do kolejki, więc
po włączeniu poczty nie wychodzą zaległe wiadomości z minionych dni.

## Przełączanie numeru on-call (Orange WCO)

Numer on-call jest przekierowywany w centrali Orange WCO na telefon osoby,
która ma dyżur PRIMARY. Proces roboczy co kilka sekund porównuje numer
wynikający z grafiku z numerem, który WCO potwierdziło ostatnio, i zmienia
go, gdy się różnią. Dzień dyżuru zmienia się o godzinie przypomnienia o
dyżurze (`ONCALL_HANDOVER_REMINDER_HOUR`, domyślnie 9 czasu warszawskiego):
przed nią numer należy do wczorajszej osoby na PRIMARY, od niej do
dzisiejszej, więc przełączenie następuje w tej samej minucie co
przypomnienie „masz dziś dyżur”, a korekta albo zamiana w ciągu dnia zmienia
numer przy najbliższym przebiegu.

Źródłem numeru jest telefon z konta osoby (`+48` i dziewięć cyfr), wysyłany
do WCO bez zmian. Dane konta WCO (adres, numer centrali, login,
identyfikator użytkownika WCO, hasło) i tryb (wyłączone, próbny, włączone)
ustawia administrator na ekranie
[Przełączanie numeru](../uzytkownik/administracja.md#przełączanie-numeru-przelaczanie-administrator).
Hasło leży w bazie zaszyfrowane kluczem `ONCALL_SECRETS_KEY`; bez klucza
funkcji nie da się włączyć. Tryb próbny loguje się, odczytuje numer i
zapisuje w audycie, co by ustawił, ale niczego w WCO nie zmienia - to brama
przed włączeniem.

Gdy WCO zgłosi wygaśnięcie hasła, proces w trybie włączonym sam ustawia nowe
(20 znaków, cztery klasy znaków), zapisując je najpierw jako oczekujące, a
dopiero po udanym logowaniu nim jako bieżące, więc przerwany przebieg nigdy
nie zostawia WCO z hasłem, którego aplikacja nie zna. Gdy WCO odrzuci każde
zapisane hasło, proces przestaje się logować do czasu wpisania nowego hasła
przez administratora, żeby nie zablokować konta WCO.

Niepowodzenia: błąd trwały (odrzucone logowanie, odrzucona zmiana numeru,
brak osoby na PRIMARY, brak numeru) od razu, a przejściowy (sieć, błąd
serwera) po 10 minutach prób wysyła e-mail „Numer on-call” do aktywnych
koordynatorów i administratorów oraz do osoby na PRIMARY, raz dziennie na
cel: kto ma odbierać, na co WCO przekierowuje, co zawiodło i co zrobić. Gdy
przełączenie uda się po alarmie, koordynatorzy i administratorzy dostają
krótką wiadomość o powrocie. W trybie próbnym alarmy nie wychodzą. Żadna
wiadomość, wpis audytu ani stan nie zawiera hasła, ciasteczek ani treści
odpowiedzi WCO, tylko nazwę wywołania i kod HTTP.

Połączenie z WCO jest zawsze weryfikowane; firmowe CA dochodzi z pliku
`ONCALL_CA_FILE` ([Uruchomienie](../wdrozenie/uruchomienie.md#plik-ca)).
Historia jest w audycie pod akcjami `forwarding.*` (przełączono,
niepowodzenie, pominięto, zmiana hasła, odsłonięcie hasła, sprawdzenie
połączenia, zmiana ustawień), a bieżący stan pokazuje ekran administratora.
Wpisy audytu podlegają retencji, dlatego stan potrzebny na zawsze leży na
własnych wierszach. Gdy automat zawiedzie, administrator odsłania hasło WCO
i przełącza numer sam: [Ręczne przełączenie
numeru](../uzytkownik/administracja.md#ręczne-przełączenie-numeru).

## Kanały ICS

Aplikacje kalendarzowe subskrybują odwoływalne adresy tokenowe pod `/calendar`.

| Kanał | Kto tworzy | Zawartość |
| --- | --- | --- |
| osobisty | członek zespołu (sekcja „Subskrypcja kalendarza” na ekranie „Moje”) | wyłącznie własne dyżury |
| dla linku podglądowego | administrator | grafik przycięty do zakresu i ważności linku |

Dyżury są wydarzeniami całodniowymi, a **wersja grafiku jest numerem sekwencji
wydarzenia**, więc aplikacje kalendarzowe widzą korekty i zamiany jako
aktualizacje istniejącego wpisu, a nie jako nowe wpisy.

Kanał można odwołać w dowolnym momencie; adres przestaje działać natychmiast.

## Linki podglądowe

Opisane w [Role i dostęp](role-i-dostep.md#dostęp-czasowy-bez-konta): link
związany z odbiorcą, zakresem dat i wygaśnięciem do 30 dni, wymieniany na
ograniczoną sesję podglądową.

## Import historii

Koordynator i administrator wgrywają CSV w kodowaniu UTF-8 (do 5000 wierszy).

Wymagane kolumny:

| Kolumna | Format | Uwagi |
| --- | --- | --- |
| `service_date` | `RRRR-MM-DD` | data dyżuru |
| `role` | `primary`, `secondary`, `late_shift` | `late_shift` tylko w polskie dni robocze |
| `assignee_name` | dokładna nazwa wyświetlana osoby | musi istnieć w zespole |

Podgląd przed importem wykrywa duplikaty slotów, nieznane osoby i konflikty.
Gotowy przykład leży w `examples/history.csv`, a
szablon do pobrania jest na ekranie importu.

Import zasila historię, z której liczą sprawiedliwość i generator, więc jest to
sposób na uruchomienie aplikacji z sensownym bilansem od pierwszego dnia.

## Raport miesięczny dla kadr

Koordynator i administrator pobierają CSV za wybrany miesiąc. Jeden wiersz to
jedna osoba. Kodowanie UTF-8 z BOM, układ kolumn stabilny i wersjonowalny:

| Kolumna | Znaczenie |
| --- | --- |
| `miesiac` | miesiąc rozliczenia (`RRRR-MM`) |
| `osoba` | nazwa wyświetlana |
| `primary_dni_robocze` | dyżury `PRIMARY` w zwykłe dni robocze |
| `primary_weekendy` | dyżury `PRIMARY` w soboty i niedziele |
| `primary_swieta` | dyżury `PRIMARY` w święta ustawowe |
| `secondary_dni_robocze` | jak wyżej, dla `SECONDARY` |
| `secondary_weekendy` | |
| `secondary_swieta` | |
| `oncall_dni_robocze_razem` | suma on-call w dni robocze |
| `oncall_weekendy_razem` | suma on-call w weekendy |
| `oncall_swieta_razem` | suma on-call w święta |
| `oncall_weekendy_swieta_razem` | dni dyżurowe w weekendy i święta razem (`PRIMARY` + `SECONDARY`) |
| `oncall_dni_razem` | wszystkie dni dyżurowe (`PRIMARY` + `SECONDARY`, w dni robocze oraz w weekendy i święta) |
| `zmiany_11_19` | liczba roboczych zmian `11–19` |
| `primary_punkty` | punkty za `PRIMARY` (X / 2X) |
| `secondary_punkty` | punkty za `SECONDARY` |
| `punkty_razem` | suma punktów |

Dzień dyżurowy to jeden dyżur `PRIMARY` lub `SECONDARY`; zmiany `11–19` nie są
dniami dyżurowymi i mają tylko własną kolumnę. Każdy slot jest liczony z
efektywnej wersji grafiku, po override'ach i zamianach. Święto przypadające w
sobotę lub niedzielę jest liczone raz, jako weekend. Ekran ostrzega, gdy opublikowany grafik nie pokrywa całego miesiąca,
i podaje, ile dni pokrywa.

Przyszłe formaty (XLSX, Word) mają korzystać z tego samego modelu raportowego, a
nie z osobnej logiki liczenia.

## Audyt

Istotne operacje - logowania i nieudane logowania, zmiany dostępności, cykl
zamian, generowanie szkiców, publikacje, korekty, zmiany polityki, importy
historii, linki i kanały, administracja kontami - są zapisywane w tabeli
`audit_events` **w tej samej transakcji co sama zmiana**.

Etykieta aktora jest zdenormalizowana, więc ślad przetrwa usunięcie konta i
opisze także aktorów niebędących użytkownikami, na przykład link podglądowy.
Administrator przegląda i filtruje dziennik na ekranie „Audyt”, a wynik filtra
może wyeksportować do CSV.

Dziennik nie rośnie bez końca: proces roboczy usuwa wpisy o operacjach
starsze niż `ONCALL_RETENTION_AUDIT_DAYS` (domyślnie 365 dni) oraz zwykłe
logowania i nieudane próby starsze niż `ONCALL_RETENTION_LOGIN_AUDIT_DAYS`
(domyślnie 90 dni). Wpisy o korektach grafiku podlegają temu samemu
terminowi, bo kogo zastąpiła korekta, ponowna publikacja odczytuje z samego
dyżuru, a nie z dziennika. Ekran „Audyt”
pokazuje obowiązujące czasy; pozostałe tabele i ustawienia opisuje
[Retencja danych](../wdrozenie/uruchomienie.md#retencja-danych).

## Metryki procesu roboczego

Proces roboczy raportuje na własnym loggerze `oncall.metrics`, jeden rekord
logfmt na pomiar. Nic z tego nie trafia do bazy, a proces API nie emituje
żadnego z tych rekordów - wartość tych liczb jest wartością logów procesu
roboczego, więc warto je zbierać.

| Rekord | Pola |
| --- | --- |
| `queue` | `queued`, `running`, `oldest_queued_seconds`, `stalest_running_seconds` |
| `outbox` | `eligible`, `oldest_eligible_seconds`, `retrying`, `attempts_max`, `waiting`, `dead` |
| `generation` | `run`, `outcome`, `queued_seconds`, `run_seconds` |
| `generation_abandoned` | `runs` - ile uruchomień zwolniono po procesie, który zginął (ostrzeżenie) |
| `retention` | `audit`, `logins`, `outbox`, `runs`, `sessions`, `tokens` - ile wierszy usunął przebieg; `capped` - ile tabel doszło do limitu paczek i ma jeszcze zaległość; `seconds` |
| `forwarding` | `outcome` (`applied`, `unchanged`, `failed`, `skipped_no_primary`, `skipped_no_phone`, `dry_run`), `rotated` - `1`, gdy przebieg zmienił wygasłe hasło Orange WCO; `seconds`, `attempts` - kolejne nieudane próby; przebieg, który nic nie zrobił, nie emituje rekordu |

`queue` i `outbox` są próbkowane na zegarze (`ONCALL_METRICS_INTERVAL_SECONDS`,
domyślnie 60) niezależnie od tego, czy cokolwiek się dzieje - **luka w nich
oznacza, że zatrzymał się sam proces roboczy**. `retention` pojawia się co
`ONCALL_RETENTION_INTERVAL_SECONDS` (domyślnie 3600), także po przebiegu,
który nic nie usunął; `dead` w `outbox` liczy nieudane wiadomości, których
retencja jeszcze nie usunęła.

`outcome` przyjmuje wartości: `completed`, `infeasible` (obsada i reguły twarde
są sprzeczne - muszą zmienić się dane wejściowe), `requester_missing`, `error`
(defekt aplikacji) oraz `reclaimed` (solve skończył się po uznaniu uruchomienia
za porzucone, więc wynik wyrzucono; `ONCALL_STALE_RUN_SECONDS` jest za ciasny
dla tej obsady).
