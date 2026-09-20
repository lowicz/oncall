# Raport testów QA - Erste On-call

Autor: starszy inżynier testów (sesja Claude Code)
Data wykonania: 2026-09-05
Wersja testowana: `main` (docker compose, obraz zbudowany lokalnie)
Środowisko: Docker Compose (`db`, `api`, `worker`, `web`), frontend pod `http://localhost:8080`

Raport zawiera plan testów, wyniki wykonania, listę defektów oraz plan naprawczy.
Plan naprawczy znajduje się w rozdziale 11.

---

## 1. Poświadczenia testowe

Wszystkie konta poza `admin` zostały utworzone skryptem `seed_qa.py` (opis w rozdziale 2).
Hasło dla kont QA: **`TestOncall2026!`**
Hasło konta `admin` pochodzi z `.env` (`ONCALL_ADMIN_PASSWORD`): **`Qwertyuiop1!`**

| Login | Hasło | Rola | W rotacji | Uwagi |
| --- | --- | --- | --- | --- |
| `admin` | `Qwertyuiop1!` | admin | nie | konto bootstrapowane z `.env` |
| `admin2` | `TestOncall2026!` | admin | nie | drugi administrator (test "ostatni admin") |
| `koord` | `TestOncall2026!` | coordinator | nie | koordynator spoza rotacji |
| `anna` | `TestOncall2026!` | coordinator | tak | koordynator, który sam dyżuruje |
| `marek` | `TestOncall2026!` | member | tak | ma twardą niedostępność (urlop) |
| `ola` | `TestOncall2026!` | member | tak | preferencja "wolę nie" |
| `piotr` | `TestOncall2026!` | member | tak | preferencja "chętnie wezmę" |
| `kasia` | `TestOncall2026!` | member | tak | twarda niedostępność (krótka) |
| `tomek` | `TestOncall2026!` | member | tak | - |
| `ewa` | `TestOncall2026!` | member | tak | eligibility bez `primary` |
| `jakub` | `TestOncall2026!` | member | tak | eligibility bez `late_shift` |
| `magda` | `TestOncall2026!` | member | tak | - |
| `rafal` | `TestOncall2026!` | member | tak | wszedł do rotacji 90 dni temu (test neutralnego bilansu) |
| `viewer` | `TestOncall2026!` | viewer | nie | - |
| `viewer2` | `TestOncall2026!` | viewer | nie | - |

Uwaga operacyjna: bootstrap `admin` synchronizuje hasło z `.env` przy każdym starcie kontenera `api`.
Zmiana hasła `admin` w bazie zostanie nadpisana po `docker compose restart api`.

---

## 2. Dane testowe i sposób ich odtworzenia

Skrypt `docs/qa-suite/seed_qa.py` tworzy powtarzalny zestaw danych.
Domyślny `seed_demo.py` nie nadaje się do testów, bo tworzy tylko 4 osoby w rotacji i **nie zakłada żadnego konta koordynatora**, więc połowa funkcji jest nieosiągalna.

Zawartość zestawu QA:

- 14 kont pokrywających wszystkie cztery role, w tym dwóch administratorów, dwóch koordynatorów i dwóch viewerów.
- 10 członków rotacji, w tym trzy przypadki brzegowe: `ewa` bez eligibility `primary`, `jakub` bez `late_shift`, `rafal` z wejściem do rotacji 90 dni temu.
- 12 miesięcy opublikowanej historii w trzech publikacjach, z celową częściową republikacją wewnątrz starszego zakresu, żeby sprawdzić rozstrzyganie per slot.
- Historia obejmuje także dyżury `rafal` sprzed jego wejścia do rotacji. To celowe: pokazuje, że aplikacja liczy takie dyżury do wykonania (`actual` 29), a udział oczekiwany wylicza proporcjonalnie do 91 dni członkostwa (`expected` 14.19). Duże dodatnie odchylenie tej jednej osoby po zasianiu danych **nie jest defektem wyliczenia**, tylko ilustracją HGH-04: nic nie broni zapisania dyżuru poza okresem członkostwa.
- Bieżący grafik na 28 dni do przodu oraz wpisy dostępności wszystkich trzech typów.

Uruchomienie:

```bash
docker compose cp seed_qa.py api:/tmp/seed_qa.py
docker compose exec api python /tmp/seed_qa.py
```

## 3. Zakres i metoda testów

| Obszar | Metoda | Liczba przypadków |
| --- | --- | --- |
| Uwierzytelnianie, sesje, CSRF | API (`httpx`) | 15 |
| Macierz RBAC (13 endpointów x 5 sesji) | API | 65 |
| Próby eskalacji uprawnień | API | 6 |
| Generator, workflow szkicu, blokada optymistyczna | API | 24 |
| Cykl życia zamian i override'ów | API | 28 |
| Tożsamość po zmianie nazwiska (bilans, zamiany, reguły twarde) | API | 12 |
| Sprawiedliwość i raport miesięczny CSV | API | 22 |
| Import historii, linki viewer, ICS, audyt | API | 45 |
| Przypadki brzegowe i walidacja | API | 30 |
| Wydajność i współbieżność | API + `docker stats` | 14 |
| Współbieżność zamian i publikacji | API | 8 |
| Testy eksploracyjne i użyteczności UI | Chrome DevTools (`chrome-devtools-axi`) | 5 ról, 9 ekranów |
| Dostępność: kontrast, klawiatura, drzewo dostępności | Chrome DevTools + skrypt kontrastu | 4 przebiegi |

Środowisko wydajnościowe: kontenery ograniczone do docelowego sprzętu przez `docker update`.
`api` 2 rdzenie / 4 GB, `db` 1 rdzeń / 2 GB, `worker` 0.5 rdzenia / 1 GB, `web` 0.5 rdzenia / 512 MB.
Razem 4 rdzenie i 7.5 GB, czyli górny wariant docelowy z zapytania.
Generator obciążenia działał na tym samym hoście, więc wyniki traktuj jako ostrożne oszacowanie, a nie pomiar laboratoryjny.

## 4. Podsumowanie wyników

Aplikacja jest dojrzalsza, niż sugerowałby jej wiek.
Warstwa bezpieczeństwa jest mocna: 65 na 65 przypadków macierzy RBAC przeszło, CSRF jest egzekwowane, sesje giną przy dezaktywacji konta i przy resecie hasła, link jednorazowy działa dokładnie raz, a odwołanie linku natychmiast unieważnia żywą sesję.
Reguły twarde są dotrzymane **przez sam solver**: na grafiku 91-dniowym zero naruszeń pokrycia, eligibility, niedostępności i rozłączności ról.
Historia jest liczona raz mimo nakładających się publikacji, a raport miesięczny zgadza się co do sztuki z kalendarzem.
Nawigacja klawiaturą po macierzy jest zrobiona porządnie: 300 komórek, jeden przystanek Tab, strzałki, PageUp/PageDown, Home/End.
Kontrast w obu motywach jest praktycznie czysty.

Problemy leżą gdzie indziej, a jeden z nich dotyczy właśnie reguł twardych: solver ich nie łamie, ale ścieżka zamian potrafi je obejść (BLK-05).
Pięć defektów blokuje normalną pracę zespołu i trzy z nich wymagają przeprojektowania, a nie poprawki.
Dwa z nich łamią regułę, którą `PLAN.md` par. 3 stawia jako twardą.

| Waga | Liczba |
| --- | --- |
| Blokujące | 5 |
| Wysokie | 7 |
| Średnie | 14 |
| Niskie | 6 |

---

## 5. Defekty blokujące

### BLK-01 Generowanie grafiku zamraża całą aplikację dla wszystkich użytkowników

**Obszar:** architektura, `routes/scheduling.py:189`, `scheduler.py:generate_schedule`
**Rola:** dowolna (ofiarą jest każdy zalogowany użytkownik)

`generate_draft` jest korutyną `async`, ale wywołuje synchroniczny, blokujący `generate_schedule()`.
Uvicorn działa w jednym procesie i bez `--workers`, więc pętla zdarzeń stoi przez cały czas rozwiązywania.

Pomiar na docelowym sprzęcie (api = 2 rdzenie):

| Metryka | Bez generowania | W trakcie generowania |
| --- | --- | --- |
| `GET /api/v1/health`, maksimum | 3 ms | **30 065 ms** |
| `GET /api/v1/health`, średnia | 3 ms | 6 015 ms |

Nie chodzi o wolny endpoint, tylko o `health check`, który nie dotyka bazy.
Przy 10 równoczesnych użytkownikach każde uruchomienie generatora to 30 sekund pełnego przestoju: nikt nie sprawdzi, kto dyżuruje, nikt nie wyśle prośby o zamianę, a monitoring uzna aplikację za martwą.

`docs/SOLVER.md` wymienia synchroniczne działanie solvera jako świadome ograniczenie, ale nie odnotowuje jego rzeczywistego skutku.
Skutkiem nie jest „długie uruchomienie”, tylko globalna niedostępność.

**Reprodukcja:** zaloguj się jako `koord`, uruchom generowanie 91 dni, równolegle odpytuj `http://localhost:8080/api/v1/health` z drugiej karty.

---

### BLK-02 Dwa generowania naraz kończą się błędem 504 i zostawiają szkice-widma

**Obszar:** architektura + `frontend/nginx.conf`
**Rola:** coordinator, admin

Konsekwencja BLK-01.
Drugie żądanie czeka w kolejce, a odpowiedź pierwszego nie zostaje wypchnięta, dopóki pętla zdarzeń jest zajęta drugim.
Oba przekraczają domyślny `proxy_read_timeout` nginx (60 s).

Zmierzone: dwa generowania 61-dniowe uruchomione jednocześnie przez `koord` i `anna`.

```
wall=60.1s
(600, 60.1, 504, '504 Gateway Time-out')
(700, 60.1, 504, '504 Gateway Time-out')
nowe szkice utworzone w bazie: 2
```

Obaj koordynatorzy widzą błąd, a w bazie powstają dwa kompletne szkice, o których nikt nie wie.
W trakcie sesji testowej w ten sposób osadziły się cztery szkice-widma.
`nginx.conf` nie ustawia żadnego `proxy_read_timeout`, więc obowiązuje domyślne 60 s, czyli dokładnie dwa razy `SOLVE_SECONDS`.

---

### BLK-03 Zatwierdzenie jednej zamiany unieważnia wszystkie pozostałe i blokuje ich sloty na zawsze

**Obszar:** `routes/swaps.py:approve_swap`, `routes/swaps.py:create_swap`
**Rola:** member, coordinator
**Klasyfikacja:** błąd projektowy, blokada optymistyczna na złym poziomie granulacji

`SwapRequest.schedule_version` zapisuje wersję **całego grafiku** w chwili utworzenia prośby.
`approve_swap` wymaga, żeby wersja nadal się zgadzała.
Wersję grafiku podbija natomiast każda zatwierdzona zamiana i każdy override, także dotyczące zupełnie innego dnia i innej roli.

Skutek: **funkcja zamian unieważnia samą siebie**, bez udziału jakiejkolwiek innej operacji.

Scenariusz A, zmierzony end-to-end, wyłącznie na zamianach:

1. `piotr` prosi o zamianę PRIMARY na 2026-09-08, zastępca akceptuje.
2. `piotr` prosi o zamianę PRIMARY na 2026-09-17, zastępca akceptuje.
3. Koordynator zatwierdza pierwszą: **200**, wersja grafiku rośnie.
4. Koordynator zatwierdza drugą, dotyczącą **innego dnia**: **409 „Grafik zmienił się; utwórz nową zamianę”**.
5. Autor próbuje utworzyć nową prośbę na ten sam slot: **409 „Dla tego slotu istnieje aktywna zamiana”**.

Scenariusz B, ten sam efekt wywołany zwykłym override'em koordynatora na niezwiązanym dniu, również zmierzony.

W obu przypadkach slot jest nie do ruszenia.
Nie da się zatwierdzić starej prośby ani utworzyć nowej.
Prośba zostaje `pending_coordinator` w nieskończoność i dalej blokuje slot.
Jedynym wyjściem jest ręczne wycofanie przez autora, o czym komunikat nie mówi ani słowa, a koordynator nie ma nawet uprawnienia, żeby to zrobić za niego.

Dwie zamiany naraz to dla dziesięcioosobowej rotacji stan normalny, a nie brzegowy.
Praktycznie oznacza to, że koordynator może zatwierdzić dokładnie **jedną** zamianę na sesję, a każda kolejna wymaga wycofania i zgłoszenia od zera, razem z ponowną akceptacją zastępcy.

Blokada powinna dotyczyć konkretnego przydziału (`assignments.id` albo trójki `schedule_id, service_date, role`), a nie całego grafiku.

### BLK-04 Wyjście osoby z rotacji osieroca opublikowane dyżury, które znikają z widoku

**Obszar:** `routes/admin.py:update_team_member`, `routes/calendar.py:calendar_matrix`, `lib/calendar.ts:coverageGaps`
**Rola:** admin
**Klasyfikacja:** błąd projektowy, utrata integralności danych operacyjnych

`PATCH /api/v1/admin/team-members/{id}` z `active_until` nie sprawdza, czy osoba ma jeszcze przypisane przyszłe dyżury w opublikowanym grafiku.

Zmierzone: `Tomasz Wójcik` miał **34 przyszłe dyżury**; ustawienie `active_until` na jutro przeszło z kodem 200.
Po operacji:

- 34 dyżury nadal wskazują na niego w opublikowanym grafiku,
- macierz kalendarza **nie pokazuje już jego wiersza** (członkowie są filtrowani po `active_until`), więc 7 dyżurów w widocznym oknie należy do nikogo,
- **detektor braków obsady ich nie wykrywa**, bo slot formalnie ma przydział,
- baner ostrzegawczy o niepełnej obsadzie znika,
- „Kto jest teraz?” dalej pokaże osobę, która odeszła z zespołu.

Dowód wizualny: `docs/qa-shots/16-orphan.png`.
W kolumnie czw 10-09 nie ma ani jednego `P`, a aplikacja twierdzi, że obsada jest kompletna.

To najgroźniejszy defekt w raporcie, bo powstaje przy rutynowej czynności administracyjnej i nie daje żadnego sygnału.
Rzeczywisty skutek: incydent w nocy bez dyżurnego, a grafik pokazuje pełne pokrycie.

---

### BLK-05 Zmiana nazwiska pozwala obsadzić jedną osobę jednocześnie jako primary i secondary

**Obszar:** `models.py:Assignment.assignee_name`, `routes/swaps.py:_conflicts_with_other_oncall_role`, `routes/swaps.py:replacement_options`, `routes/scheduling.py:_validate_complete`
**Rola:** member + coordinator (bez żadnych podwyższonych uprawnień poza samą zmianą nazwiska)
**Klasyfikacja:** złamanie reguły twardej z `PLAN.md` par. 3, błąd projektowy w modelu tożsamości

`Assignment.assignee_name` to zdenormalizowana etykieta, która **nigdy nie jest aktualizowana przy zmianie nazwiska**.
Wszystkie zabezpieczenia przed podwójnym obsadzeniem porównują właśnie tę etykietę z aktualnym `display_name` osoby, zamiast porównywać `member_id`.
Po zmianie nazwiska obie wartości przestają się zgadzać i każde z tych zabezpieczeń przepuszcza operację.

Zmierzony przebieg (wyłącznie normalne ścieżki interfejsu):

1. Na 2026-09-09 primary to `Katarzyna Lewandowska`, secondary to `Jakub Szymański`.
2. Administrator zmienia nazwisko Jakuba (ślub, korekta literówki, cokolwiek).
3. `GET /api/v1/swaps/options` dla PRIMARY tego dnia **oferuje Jakuba jako zastępcę**, mimo że tego samego dnia jest już secondary.
4. `POST /api/v1/swaps` przechodzi z kodem **201**; `_conflicts_with_other_oncall_role` porównuje „Jakub Zmieniony” ze starą etykietą „Jakub Szymański” i nie widzi kolizji.
5. Zastępca akceptuje, koordynator zatwierdza: **200**.

Stan w bazie po operacji:

```
 service_date |   role    |  assignee_name  |              member_id               | aktualna_nazwa
--------------+-----------+-----------------+--------------------------------------+-----------------
 2026-09-09   | primary   | Jakub Zmieniony | bab976e2-211e-4356-9d96-2bb5d068cad2 | Jakub Szymański
 2026-09-09   | secondary | Jakub Szymański | bab976e2-211e-4356-9d96-2bb5d068cad2 | Jakub Szymański
```

**Ten sam `member_id` pełni obie role on-call tej samej nocy.**
Grafik pokazuje dwa różne nazwiska, więc ani aplikacja, ani człowiek patrzący na macierz nie zauważy problemu.

Aplikacja nie ma jak tego wykryć, bo `_validate_complete`, czyli walidacja przy publikacji, porównuje dokładnie te same etykiety tekstowe:

```python
if assignments[AssignmentRole.primary] == assignments[AssignmentRole.secondary]:
```

Republikacja takiego grafiku przejdzie bez zastrzeżeń.

Operacyjny skutek: w nocy incydentowej nie ma eskalacji, bo primary i secondary to ta sama osoba i ten sam telefon.

**Reprodukcja:** `docs/qa-suite/t13_rename_doublebook.py`.

---

## 6. Defekty wysokie

### HGH-01 Generowanie zawsze zużywa cały 30-sekundowy budżet i nigdy nie kończy się statusem OPTIMAL

**Obszar:** `scheduler.py`
**Kryterium z `PLAN.md` par. 8:** „90-dniowy grafik w mniej niż 30 sekund”

Pomiary (10 osób w rotacji, 12 miesięcy historii):

| Zakres | Czas | Status CP-SAT |
| --- | --- | --- |
| 91 dni, host bez limitów | 30.14 s | FEASIBLE |
| 91 dni, powtórzenie | 30.12 s | FEASIBLE |
| 91 dni, api = 2 rdzenie | 30.18 s | FEASIBLE |
| **30 dni**, api = 2 rdzenie | **30.10 s** | FEASIBLE |

Kryterium nie jest spełnione i nigdy nie będzie, bo drugi przebieg dostaje cały pozostały czas ścienny i zawsze go wyczerpuje.
Zwróć uwagę na czwarty wiersz: **zakres 30-dniowy trwa tyle samo co 91-dniowy**.
Czas nie zależy od trudności problemu, tylko od stałej `SOLVE_SECONDS`.
Krótki grafik na dwa tygodnie kosztuje tyle samo przestoju co kwartalny.

Determinizm natomiast jest spełniony: dwa przebiegi z identycznym wejściem dały identyczny grafik co do przydziału.

### HGH-02 Koordynator nie może obsadzić dnia bez obsady z poziomu macierzy

**Obszar:** `components/CalendarMatrix.tsx:440` (`disabled={!selectedAssignment || override.isPending}`)
**Rola:** coordinator, admin

Aplikacja wykrywa lukę w pokryciu, wyświetla żółty baner „2 dni w tym zakresie nie ma pełnej obsady”, daje przycisk „Pokaż pierwszy”, który przewija do właściwej komórki.
Po kliknięciu komórki dialog potwierdza problem: „Ten dzień nie ma pełnej obsady: PRIMARY, SECONDARY”.
I na tym się kończy, bo przycisk **„Przypisz bezpośrednio” jest wyszarzony**, bez wyjaśnienia i bez alternatywy.

Przycisk jest wyłączony dokładnie wtedy, gdy dla wybranej roli nie ma opublikowanego przydziału, czyli w jedynym przypadku, w którym koordynator naprawdę potrzebuje go użyć.
Cała ścieżka prowadzi użytkownika do ślepego zaułka.

Dowód: `docs/qa-shots/05-gap-dialog.png`.

Przyczyna jest po stronie API: `POST /api/v1/calendar/override` wymaga istniejącego wiersza `Assignment` i tylko go modyfikuje.
Nie ma żadnego sposobu, żeby przez interfejs utworzyć brakujący przydział w opublikowanym grafiku.

### HGH-03 Zmiana nazwiska rozspójnia grafik, bilans i podgląd wpływu zamiany

**Obszar:** `fairness.py:duty_points`, `routes/swaps.py:swap_impact`, `models.py:Assignment.assignee_name`
**Rola:** member, coordinator, admin

Ta sama przyczyna co BLK-05 (etykieta `assignee_name` nie idzie za zmianą nazwiska), ale skutki widoczne dla użytkownika są osobne i każdy wymaga własnej poprawki.

**a) Opublikowany grafik pokazuje nieaktualne nazwisko.**
Po zmianie nazwiska `GET /api/v1/schedules/published` nadal zwraca starą etykietę dla wszystkich już opublikowanych dyżurów.
Macierz kalendarza i sekcja „Kto jest teraz?” pokazują nazwisko, którego nie ma już w katalogu firmowym.
Nowe nazwisko pojawia się dopiero na dyżurach zmienionych po zmianie, więc jedna osoba figuruje w grafiku pod dwoma nazwiskami naraz.

**b) Podgląd wpływu zamiany przestaje działać.**
`swap_impact` odczytuje `Assignment.assignee_name`, a potem szuka `TeamMember.display_name == current_name`.
Po zmianie nazwiska dopasowanie zawodzi:

```
GET /api/v1/swaps/impact?service_date=2026-09-13&role=secondary&...
409 {"detail":"Osoba z tego slotu nie jest członkiem zespołu"}
```

To samo żądanie przed zmianą nazwiska zwracało 200.
`PLAN.md` par. 4 stawia podgląd punktów obowiązkowo między wyborem zastępcy a wysłaniem prośby; po zmianie nazwiska ten krok jest niedostępny dla każdego wcześniej opublikowanego dyżuru.
Samo utworzenie prośby działa, bo `create_swap` używa `matches_member` i porównuje `member_id`, co dobrze pokazuje, że poprawny wzorzec jest już w kodzie i po prostu nie wszędzie zastosowany.

**c) Rozwinięcie bilansu pokazuje zero dyżurów.**
`compute_fairness` dopasowuje po `member_id`, a `duty_points`, zasilające listę „Dyżury: <osoba>”, porównuje wyłącznie `assignee_name`.

| | Przed zmianą nazwiska | Po zmianie |
| --- | --- | --- |
| PRIMARY w podsumowaniu | 94.0 pkt | 94.0 pkt |
| Wiersze w rozwinięciu | 127 | **0** |

Na jednym ekranie użytkownik widzi „94 punkty” i pustą listę dyżurów, które się na nie składają.

Raport miesięczny CSV i kanał ICS działają poprawnie, bo obydwa idą przez `member_id`.

**Reprodukcja:** `docs/qa-suite/t05_fairness_reports.py` (punkt c) oraz `docs/qa-suite/t12_rename_swaps.py` (punkty a i b).

### HGH-04 Import historii przyjmuje dane łamiące reguły twarde i jest nieodwracalny

**Obszar:** `routes/history.py:commit_history`, `routes/scheduling.py:delete_schedule`
**Rola:** coordinator, admin

Import waliduje tylko trzy rzeczy: format, istnienie osoby w zespole i duplikat pary (data, rola).
Przeszły natomiast, z kodem **201**:

| Wiersz | Co narusza | Wynik |
| --- | --- | --- |
| ta sama osoba jako `primary` i `secondary` tego samego dnia | regułę twardą z `PLAN.md` par. 3 | zapisane, liczy podwójne punkty |
| `late_shift` w sobotę | regułę „11–19 tylko w dni robocze” | zapisane, potem po cichu filtrowane przy odczycie |
| dyżur z 2020 roku dla osoby, która weszła do rotacji 90 dni temu | okres członkostwa | zapisane |

Drugi przypadek jest szczególnie mylący: import raportuje „zaimportowano N wierszy”, a część z nich nigdy się nie pojawi, bo `effective_assignments` je odfiltrowuje.

Do tego **importu nie da się cofnąć**.
Import tworzy grafik ze statusem `superseded`, a `DELETE /api/v1/scheduling/{id}` odrzuca wszystko poza `draft` i `proposed`.
Pomyłkowy import (zły rok, zły plik) trwale zniekształca raport sprawiedliwości i nie ma ścieżki naprawczej w interfejsie.
Ekran „Import historii” nie pokazuje też żadnej listy wcześniejszych importów.

### HGH-05 Koordynator nie dostaje powiadomienia o zamianie czekającej na akceptację, a pominięte powiadomienia przepadają

**Obszar:** `notifications/triggers.py:notify_swap_accepted`, `notifications/service.py:drain_outbox`

Po akceptacji zastępcy prośba przechodzi w `pending_coordinator`.
`notify_swap_accepted` wysyła wiadomość **tylko do autora prośby**.
Nikt nie informuje koordynatora, że coś czeka na jego decyzję.
Zamiana wisi, aż koordynator z własnej inicjatywy otworzy zakładkę.

Drugi problem: gdy `ONCALL_SMTP_HOST` jest pusty, wiersze dostają status `skipped`, a `drain_outbox` pobiera wyłącznie `pending`.
`skipped` jest więc stanem końcowym.
W tej instancji 68 powiadomień ma ten status i po skonfigurowaniu SMTP żadne z nich nie zostanie wysłane.
Domyślna konfiguracja z `.env.example` nie ma SMTP, więc każde wdrożenie zaczyna od cichej utraty powiadomień.

Trzeci wątek: nie ma **żadnego** powiadomienia w aplikacji, tylko e-mail.
Bez SMTP cały proces zamian nie ma kanału informacyjnego.

### HGH-06 Bezpośrednia zmiana obsady w opublikowanym grafiku bez potwierdzenia, a błąd wyświetla się poza dialogiem

**Obszar:** `components/CalendarMatrix.tsx`
**Rola:** coordinator, admin

„Przypisz bezpośrednio” natychmiast zmienia opublikowany grafik, podbija wersję, wysyła powiadomienia i zapisuje wpis audytowy.
Nie ma potwierdzenia ani cofnięcia, mimo że komponent `ConfirmDialog` istnieje w projekcie i jest używany przy publikacji.

Dialog nie mówi też, **kogo** przypisze.
Widać tytuł z nazwiskiem osoby z klikniętego wiersza, listę ról i wiersz „Obecnie: <ktoś inny>”.
Który z tych dwóch nazwisk trafi na dyżur po kliknięciu przycisku, trzeba wywnioskować.

Jeśli API odrzuci zmianę (brak eligibility, niedostępność), błąd renderuje się w `<Alert>` **nad tabelą**, poza otwartym dialogiem.
Przy przewiniętej stronie użytkownik nie zobaczy komunikatu w ogóle: dialog zostaje otwarty, przycisk wraca do stanu wyjściowego i wygląda, jakby nic się nie stało.

Dialog nie filtruje też kandydatów po eligibility i dostępności, więc do odrzucenia dochodzi rutynowo.

### HGH-07 Przypomnienie o przekazaniu numeru omija wspólne rozstrzyganie i może wskazać złą osobę

**Obszar:** `worker.py:_primary_on` (linia 35)

Cała aplikacja opiera się na jednym wspólnym rozstrzyganiu per slot (`effective.effective_assignments`), właśnie po to, żeby kalendarz, bilans, ICS i raporty nigdy się nie rozjechały.
`worker._primary_on` jest **jedynym miejscem, które to omija**:

```python
select(Assignment)
  .join(Schedule, ...)
  .where(Assignment.service_date == day,
         Assignment.role == AssignmentRole.primary,
         Schedule.status == ScheduleStatus.published)
  .order_by(Schedule.published_at.desc())
  .limit(1)
```

Filtruje po `status == published`, więc pomija grafiki `superseded`, i wybiera najnowszą publikację, zamiast rozstrzygać slot.
Po częściowej republikacji albo w dniu pokrytym przez starszą publikację funkcja zwróci osobę z innego grafiku niż ta, którą aplikacja pokazuje jako dyżurną.

Skutek: e-mail „przekaż numer” trafia do niewłaściwej osoby albo nie zostaje wysłany wcale, bo `incoming == outgoing` wyliczone z błędnego źródła.
`scan_handover` wybiera też grafik osobno od `_primary_on`, więc oba mogą wskazywać różne publikacje.

Poprawka jest mechaniczna: użyć `effective_assignments(db, day, day)` i odczytać slot `(day, primary)`, tak jak robią wszystkie pozostałe ścieżki odczytu.

---

## 7. Defekty średnie

### MED-01 „Brak przydziału” dla zmiany 11–19 w dni wolne

Ekran „Kto jest teraz?” w sobotę pokazuje kartę `[11–19]` z napisem **„Brak przydziału”** i pomarańczowym paskiem sygnalizującym problem.
Zmiana 11–19 z definicji nie występuje w soboty, niedziele i święta (`PLAN.md` par. 3), więc nie brakuje niczego.
Karta powinna mówić „nie dotyczy: dzień wolny” w neutralnej stylizacji albo nie pojawiać się wcale.
Ten sam komunikat oznacza dziś dwie różne rzeczy: „reguła nie przewiduje tej roli” i „ktoś zapomniał obsadzić”.
Dowód: `docs/qa-shots/02-duty-koord.png`.

### MED-02 Baner „[READ ONLY] ... Konto nie jest członkiem rotacji” pokazuje się koordynatorowi, który może edytować

Pod macierzą koordynator widzi komunikat, że to wersja tylko do odczytu.
W tej samej chwili kliknięcie komórki otwiera dialog z działającym przyciskiem zmiany obsady.
Komunikat myli rolę konta (poza rotacją) z uprawnieniem do edycji.
Dowód: `docs/qa-shots/03-matrix.png` (baner) i `docs/qa-shots/04-daydrawer.png` (edycja działa).

### MED-03 Dialog dnia nie zawiera szczegółów dnia, a członek dostaje link bez kontekstu

`PLAN.md` par. 6 wymaga, żeby kliknięcie komórki otwierało szczegóły dnia i pozwalało członkowi rozpocząć prośbę o zamianę własnego slotu.

Członek dostaje dialog z tytułem, jednym linkiem „Przejdź do zamian” i przyciskiem „Zamknij”.
Nie ma obsady dnia, okna pokrycia ani informacji, której roli dotyczy.
Link prowadzi do `/zamiany` **bez daty i roli**, więc użytkownik musi wybrać swój dyżur jeszcze raz z listy.
Do tego jest to `href` na komponencie MUI `Button`, więc powoduje pełne przeładowanie strony zamiast nawigacji SPA.

Kryterium UX z `PLAN.md` par. 7 mówi o wysłaniu zamiany w 60 sekund.
Utrata kontekstu przy przejściu działa bezpośrednio przeciwko temu.
Dowód: `docs/qa-shots/12-member-duty.png`.

### MED-04 Brak walidacji wpisów dostępności

`POST /api/v1/availability/me` przyjmuje z kodem 201:

| Przypadek | Wynik |
| --- | --- |
| „chętnie wezmę” na dokładnie ten sam zakres co istniejące „nie mogę” | 201 |
| dokładny duplikat istniejącego wpisu | 201 |
| wpis w całości w przeszłości (rok wstecz) | 201 |

Odwrócony zakres jest poprawnie odrzucany (422).
Sprzeczne wpisy solver rozstrzyga po cichu na korzyść `unavailable`, więc użytkownik jest przekonany, że zgłosił „chętnie wezmę”, a system rozumie „nie mogę”, bez żadnego ostrzeżenia.

### MED-05 Odznaka „0” przy „Wymaga Twojej akcji” i niewidzialne „0” w nawigacji

`screens/Swaps.tsx:302` używa `showZero`, więc obok nagłówka „Wymaga Twojej akcji” wisi pomarańczowa (ostrzegawcza) odznaka **„0”**, bezpośrednio nad zdaniem „Nic nie czeka na Twoją decyzję”.
Kolor ostrzegawczy i zero to sprzeczny komunikat.
Dowód: `docs/qa-shots/14-swap-impact.png`.

`components/AppShell.tsx:137` opakowuje **każdą** pozycję nawigacji w `Badge badgeContent={0}`.
Odznaka jest wizualnie ukryta (`MuiBadge-invisible`, `transform: scale(0)`), ale tekst „0” zostaje w DOM i w drzewie dostępności.
Zweryfikowane w przeglądarce: cztery odznaki, każda z `textContent === "0"`.
Czytnik ekranu przeczyta „Dyżury 0, Zamiany 0, Generator 0, Sprawiedliwość 0”.
`PLAN.md` par. 7 stawia cel WCAG 2.2 AA.

### MED-06 Ekran sprawiedliwości: brak opisu słownego, brak sortowania, tabela na 58% szerokości

`PLAN.md` par. 6: „Ekran sprawiedliwości nie eksponuje liczb bez kontekstu. Dla każdej kategorii pokazuje »wykonane«, »uczciwy udział do dziś« i **różnicę opisaną słowami**”.

Tabela pokazuje `97 / 58.23` i `+38.77` z paskiem.
Różnica nie jest opisana słowami nigdzie.
Co ciekawe, prognoza szkicu w generatorze robi to poprawnie („bliżej równowagi o 4.86”, „dalej od równowagi o 1.9”), więc gotowy wzorzec jest w kodzie i wystarczy go tu zastosować.

Dodatkowo:

- sortowanie wyłącznie alfabetyczne, a zadaniem ekranu jest znalezienie osób najbardziej odchylonych,
- brak wiersza sum,
- tabela kończy się na 935 px przy oknie 1600 px, prawa połowa ekranu jest pusta.

Dowód: `docs/qa-shots/17-fairness.png`.

### MED-07 Nie da się usunąć okresu eligibility ani konta

`DELETE /api/v1/admin/eligibility/{id}` → 405.
`DELETE /api/v1/admin/users/{id}` → 405.

Eligibility nadane przez pomyłkę można wyłącznie ograniczyć datą, co zostawia ślad w historii i wpływa na wyliczenie udziału.
Konto można dezaktywować, ale nie usunąć ani zanonimizować.
Aplikacja przechowuje imię, nazwisko, e-mail i numer pracownika, więc brak ścieżki usunięcia lub anonimizacji jest problemem także poza wygodą.

### MED-08 Raport miesięczny bez podglądu i z domyślnym bieżącym miesiącem

Ekran to jedno pole miesiąca i przycisk pobierania na pustej stronie.
Nie ma podglądu, sum ani ostrzeżenia, gdy wybrany miesiąc nie jest pokryty żadnym opublikowanym grafikiem.
Dla miesiąca bez danych pobierze się CSV z samymi zerami, nieodróżnialny od miesiąca, w którym nikt nie dyżurował.

Pole domyślnie wskazuje **miesiąc bieżący**, który jest w połowie.
Raport rozliczeniowy dla kadr niemal zawsze dotyczy miesiąca zamkniętego, więc domyślną wartością powinien być miesiąc poprzedni.
Dowód: `docs/qa-shots/21-raporty.png`.

### MED-09 Panel audytu nie nadaje się do prowadzenia dochodzenia

- Jedyny filtr to „Akcja”. Nie ma zakresu dat, nie ma filtru po osobie, nie ma wyszukiwania pełnotekstowego.
- Brak stronicowania w interfejsie, mimo że API obsługuje `offset`. Widać 100 najnowszych wpisów i nic więcej.
- Kolumna `details` nigdy nie jest pokazywana. `admin.user_updated` zapisuje wartości sprzed zmiany, ale użytkownik widzi tylko „Zaktualizowano konto X”, bez informacji co się zmieniło.
- `auth.login` zapisuje każde logowanie, więc przy 10 osobach zwykły ruch wypycha zdarzenia merytoryczne poza pierwsze 100 wpisów w ciągu jednego dnia pracy.
- Znaczniki czasu bez strefy. Aplikacja pokazuje czas lokalny, baza trzyma UTC, a ślad audytowy nie mówi, który to.
- Brak eksportu.

Dowód: `docs/qa-shots/21-audyt.png`.

### MED-10 Linki viewer: stan aktywny nie ma żadnego oznaczenia

Lista linków oznacza chipem tylko stany „Odwołany” i „Użyty”.
Link aktywny i niewykorzystany nie ma chipa, więc **brak oznaczenia oznacza stan aktywny**, czyli najważniejszy stan jest komunikowany jego brakiem.
Link wygasły, ale nieodwołany, też nie ma oznaczenia; trzeba w pamięci porównać datę „wygasa” z dzisiejszą.
Akcje przy odwołanych linkach są wyszarzonym tekstem, nieodróżnialnym od wyłączonego przycisku.
Odwołane linki zostają na liście na zawsze, bez możliwości archiwizacji.
Dowód: `docs/qa-shots/21-udostepnienia.png`.

### MED-11 Brak limitu serii i odpoczynku daje skrajnie nierówne rozłożenie w krótkim oknie

`PLAN.md` par. 3 mówi, że solver „ogranicza serie”.
`docs/SOLVER.md` przyznaje, że limitów serii i odpoczynku nie ma; to zgodne z dokumentacją, ale skutek jest większy, niż sugeruje jedno zdanie.

W wygenerowanym szkicu 14-dniowym (10 osób w rotacji) `Anna Kowalska` dostała SECONDARY **i** 11–19 przez 9 z 14 dni, w tym pięć pod rząd, a `Jakub Szymański` pięć PRIMARY pod rząd.
Jednocześnie `Rafał Woźniak` i `Aleksandra Wiśniewska` nie dostali ani jednego dyżuru.
Solver „nadrabia” dług historyczny w najkrótszym możliwym oknie, bo nic mu tego nie zabrania.
Dowód: `docs/qa-shots/09-draft-matrix.png`.

Sam mechanizm nadrabiania jest poprawny; brakuje ograniczenia tempa.

### MED-12 Etykieta „Rotacja do zmiany” wybiera rolę, nie rotację

Pole `select` w dialogu dnia jest podpisane „Rotacja do zmiany”, a jego wartości to `PRIMARY`, `SECONDARY`, `11–19`, czyli role dyżurowe.
„Rotacja” w tej aplikacji znaczy co innego (przynależność do zespołu dyżurowego, ekran „Osoby” używa tego słowa w tym znaczeniu).
Powinno być „Rola do zmiany”.

### MED-13 Karta osoby: trzy osobne przyciski zapisu, przycięty ostatni wiersz, brak ostrzeżenia o niezapisanych zmianach

Dialog „Osoby → Szczegóły” ma sekcje Konto, Rotacja i Eligibility, każdą z własnym przyciskiem zapisu (a Eligibility po jednym na okres).
Administrator, który zmieni rolę i okres rotacji, a naciśnie tylko jeden przycisk, po cichu straci drugą zmianę.
Zamknięcie dialogu nie ostrzega o niezapisanych zmianach.
Ostatni wiersz formularza (dodanie nowego okresu eligibility) jest przycięty przez przyklejony pasek akcji.
„Wygeneruj reset hasła” to zwykły link tekstowy obok „Zapisz konto”, bez potwierdzenia.
Dowód: `docs/qa-shots/20-osoba-detail.png`.

### MED-14 Lista „Osoby” sortowana po loginie, a wyświetlana po nazwisku

`GET /api/v1/admin/users` sortuje po `User.username`.
Tabela pokazuje imię i nazwisko jako główną informację.
Efekt: „Aleksandra Wiśniewska” (login `ola`) ląduje między „Marek Nowak” a „Piotr Zieliński”.
Przy 15 kontach lista wygląda na losową.
Nie ma też wyszukiwania ani filtru po roli i statusie.
Dowód: `docs/qa-shots/19-osoby.png`.

---

## 8. Defekty niskie

| ID | Opis |
| --- | --- |
| LOW-01 | Angielskie „eyebrow” nad polskimi nagłówkami: `[DRAFT GENERATOR]`, `[AUDIT TRAIL]`, `[PAYROLL EXPORT]`, `[MY INPUT]`, `[VIEWER ACCESS]`, `[HISTORY INPUT]`, `[FAIRNESS 12M]`, `[AUTHENTICATION]`. `[KALENDARZ OPERACYJNY]` jest po polsku, więc konwencja jest niespójna sama ze sobą. Zgłoszone już w `UI-REVIEW.md`, poprawione tylko częściowo. |
| LOW-02 | Ekran logowania nie ma żadnej ścieżki odzyskania hasła ani informacji, do kogo się zwrócić. Reset wydaje wyłącznie administrator. Brak przełącznika pokazania hasła. |
| LOW-03 | Odwołane subskrypcje ICS zostają na liście „Moje” na zawsze z etykietą „Odwołana”, bez możliwości ukrycia. |
| LOW-04 | Ekran „Import historii” nie pokazuje historii wcześniejszych importów, choć dane są w bazie i w audycie. |
| LOW-05 | Kontrast znaku „/” w logo: 3.75:1 przy wymaganych 4.5:1 (rgb(143,200,255) na rgb(0,94,168)). Poza tym kontrast w obu motywach jest czysty. |
| LOW-06 | „Powód jest prywatny - zobaczy go tylko koordynator” na ekranie „Moje”. Kod udostępnia notatkę także administratorom (`calendar.py`, `can_view_team_availability`). |

---

## 9. Wyniki testów wydajnościowych

Warunki: 10 członków rotacji, 12 miesięcy historii (ok. 1200 dyżurów), 12 równoczesnych sesji.
Limity kontenerów: `api` 2 rdzenie / 4 GB, `db` 1 rdzeń / 2 GB, `worker` 0.5 / 1 GB, `web` 0.5 / 512 MB.

### 9.1 Ścieżki odczytu pod obciążeniem

12 użytkowników odpytujących w pętli przez 30 sekund, bez pauz.

| Scenariusz | n | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| `GET /schedules/published` | 478 | 113 ms | 198 ms | 307 ms |
| `GET /calendar` 30 dni | 479 | 123 ms | 217 ms | 351 ms |
| `GET /calendar` 90 dni | 479 | 129 ms | 222 ms | 351 ms |
| `GET /fairness` | 479 | 139 ms | 230 ms | 349 ms |
| `GET /team` | 476 | 94 ms | 178 ms | 263 ms |
| `GET /swaps` | 478 | 104 ms | 177 ms | 309 ms |

**2869 żądań w 30 s (96 req/s), zero błędów.**
To znacznie powyżej realnego obciążenia dla dziesięcioosobowego zespołu.
Ścieżki odczytu nie są wąskim gardłem i nie wymagają żadnych działań.

Zwróć uwagę, że kalendarz 90-dniowy kosztuje praktycznie tyle samo co 30-dniowy, co potwierdza, że dominuje narzut żądania, a nie objętość danych.

### 9.2 Raport miesięczny

| Miesiąc | średnia z 5 przebiegów | maksimum |
| --- | --- | --- |
| 2026-08 | 7 ms | 8 ms |
| 2025-12 | 6 ms | 6 ms |

Generowanie raportu miesięcznego jest **nieistotne wydajnościowo**.
Zapytanie było głównym podejrzanym w zapytaniu o testy, więc warto to zapisać wprost: przy 10 osobach i 12 miesiącach historii koszt jest rzędu pojedynczych milisekund i nie skaluje się w niebezpieczny sposób, bo `effective_assignments` ogranicza zakres do jednego miesiąca.

### 9.3 Raport sprawiedliwości pod obciążeniem

50 raportów wygenerowanych przez 10 równoczesnych użytkowników: czas ścienny 1.74 s, średnia 311 ms, maksimum 631 ms.
Raport przelicza 365 dni x 5 soczewek x 10 osób w Pythonie i mimo to mieści się grubo poniżej sekundy.

### 9.4 Logowanie (Argon2id)

| | Wynik |
| --- | --- |
| 12 logowań po kolei | średnia 76 ms, maks. 92 ms |
| 12 logowań równocześnie | czas ścienny 1.05 s, maks. 1.05 s |

Argon2id z domyślnymi parametrami jest zauważalny, ale bezpieczny.
Przy 12 jednoczesnych logowaniach na 2 rdzeniach ostatni użytkownik czeka sekundę.
Przy większym zespole warto to obserwować, bo koszt rośnie liniowo i blokuje pętlę zdarzeń tak samo jak solver, tylko na 80 ms zamiast 30 s.

### 9.5 Generowanie grafiku

| Scenariusz | Czas | Status | Uwaga |
| --- | --- | --- | --- |
| 91 dni, host bez limitu | 30.14 s | FEASIBLE | pełne zużycie budżetu |
| 91 dni, powtórka (determinizm) | 30.12 s | FEASIBLE | wynik identyczny |
| 91 dni, `api` = 2 rdzenie | 30.18 s | FEASIBLE | bez pogorszenia |
| 30 dni, `api` = 2 rdzenie | 30.10 s | FEASIBLE | tyle samo co 91 dni |
| 2 x 61 dni równolegle | 60.1 s | **504 x2** | patrz BLK-02 |

Zużycie zasobów podczas generowania: **CPU 100% dokładnie jednego rdzenia** (`num_search_workers = 1`), pamięć procesu API 337 MiB szczytowo przy limicie 4 GB.

Wniosek dla docelowego sprzętu: **pamięć nie jest ograniczeniem, 8 GB to z dużym zapasem wystarczająco**.
Ograniczeniem jest jeden rdzeń zajęty przez 30 sekund w procesie, który obsługuje wszystkich użytkowników.
Dołożenie rdzeni nic nie zmieni, dopóki solver zostaje w procesie API z jednym workerem.

### 9.6 Zalecany profil docelowy

Po naprawie BLK-01 (przeniesienie solvera poza proces API):

| Komponent | CPU | RAM | Uzasadnienie |
| --- | --- | --- | --- |
| `api` (uvicorn, 2 workery) | 1 rdzeń | 1 GB | zmierzone 96 req/s na 2 rdzeniach przy zerowym obciążeniu solverem |
| `worker` + solver | 2 rdzenie | 2 GB | CP-SAT może wtedy dostać `num_search_workers > 1` |
| `db` (PostgreSQL 17) | 1 rdzeń | 2 GB | zmierzone szczytowe zużycie 76 MiB |
| `web` (nginx) | 0.5 rdzenia | 256 MB | statyka |

Razem mieści się w 4 rdzeniach i 8 GB z rezerwą.

---

## 10. Co działa dobrze

Ta lista nie jest kurtuazją, tylko wskazaniem, czego nie ruszać przy naprawach.

- **RBAC.** 65 na 65 przypadków macierzy uprawnień przeszło. Viewer nie widzi zespołu, punktów, zamian ani polityk. Sesja linku jednorazowego jest odcięta od wszystkiego poza opublikowanym grafikiem przyciętym do zakresu linku.
- **Zarządzanie sesją.** CSRF egzekwowane na każdej mutacji. Reset hasła kasuje istniejące sesje. Dezaktywacja konta unieważnia żywą sesję natychmiast. Odwołanie linku viewer zabija sesję w tej samej sekundzie.
- **Blokada optymistyczna publikacji.** Publikacja jest serializowana `pg_advisory_xact_lock`, waliduje pełne pokrycie i supersedes tylko grafiki w pełni zawarte w nowym zakresie. Przejścia `draft → proposed → published` odrzucają nieaktualną wersję.
- **Reguły twarde solvera.** Na wygenerowanym grafiku 91-dniowym: pełne pokrycie 91 dni, primary zawsze różny od secondary, zero zmian 11–19 w dni wolne, twarda niedostępność uszanowana co do dnia, eligibility ról uszanowane (osoba bez `primary` nigdy nie dostała `primary`).
- **Determinizm.** Dwa przebiegi z identycznym wejściem dały identyczny grafik.
- **Rozstrzyganie per slot.** Częściowa republikacja wewnątrz starszego zakresu nie liczy dyżuru dwa razy. Sumy `actual` i `expected` zgadzają się we wszystkich pięciu soczewkach z dokładnością do 0.03.
- **Raport miesięczny CSV.** Zweryfikowany krzyżowo z kalendarzem: liczba dni PRIMARY równa liczbie dni miesiąca, liczba zmian 11–19 równa liczbie dni roboczych, kategorie dni roboczych, weekendów i świąt sumują się dokładnie do `dni x 2`. BOM UTF-8, poprawny nagłówek pobrania.
- **Neutralny bilans nowej osoby.** `rafal` z 90-dniowym stażem ma udział oczekiwany 14.19 wobec 58.23 dla osoby z pełnym rokiem. Osoba bez eligibility do roli ma udział 0, a nie sztuczny dług.
- **Nawigacja klawiaturą po macierzy.** 300 komórek, jeden przystanek Tab (roving tabindex), strzałki, PageUp/PageDown o tydzień, Home/End na krańce wiersza. Etykiety komórek opisują treść, nie tylko współrzędne.
- **Kontrast.** Automatyczny audyt obu motywów znalazł jedno naruszenie (LOW-05). Motyw jasny nie ma już problemów z paskiem górnym opisanych w `UI-REVIEW.md`.
- **Responsywność.** Przy 390 px brak przepełnienia poziomego, macierz przełącza się na czytelną listę dni.
- **Prognoza wpływu szkicu.** Panel „Wpływ szkicu na sprawiedliwość” to najlepiej zaprojektowany element aplikacji: pokazuje saldo przed i po oraz opisuje różnicę słowami. Jest gotowym wzorcem dla MED-06.
- **Podgląd wpływu zamiany.** Czytelny, symetryczny, po obu stronach, z opisem kierunku zmiany.
- **Wybór własnego dyżuru w formularzu zamiany.** „niedz 06-09-2026 · PRIMARY (jutro)” to dobra etykieta; użytkownik nie wpisuje daty ręcznie.
- **Ślad audytowy.** Zapisywane są wszystkie istotne operacje, w tym nieudane logowania, w tej samej transakcji co zmiana biznesowa. Problem jest z przeglądaniem (MED-09), nie z zapisem.
- **Zero błędów w konsoli przeglądarki** na wszystkich odwiedzonych trasach.

---

## 11. Plan naprawczy

Kolejność wynika z tego, co blokuje pracę zespołu, a nie z tego, co najłatwiej naprawić.

### Etap N1. Odblokowanie codziennej pracy

**N1.1 Wyprowadzić solver poza proces API.** (BLK-01, BLK-02, HGH-01)

Rekomendowany kształt, w kolejności rosnącej pracochłonności i jakości:

1. *Minimum, jeden dzień pracy:* zawinąć `generate_schedule()` w `anyio.to_thread.run_sync()` i podnieść `uvicorn --workers 2`. Pętla zdarzeń przestaje stać, ale rdzeń nadal jest zajęty, a żądanie nadal trwa 30 s.
2. *Docelowo, zgodnie z `PLAN.md` par. 5:* generowanie staje się zadaniem workera. `POST /generate` zapisuje wiersz `schedule_run` ze statusem `queued` i zwraca **202** z identyfikatorem. Worker (już istniejący, dziś tylko drenuje outbox) podejmuje zadanie, zapisuje postęp i wynik. Frontend odpytuje status albo dostaje zdarzenie. Znika problem 504, znika limit nginx, znikają szkice-widma, a CP-SAT może dostać `num_search_workers = 2`.

Niezależnie od wariantu:

- Ustawić `proxy_read_timeout` w `nginx.conf` jawnie, zamiast polegać na domyślnych 60 s.
- Zmienić `SOLVE_SECONDS` z twardego budżetu na **limit górny**: jeśli pierwszy przebieg zwróci `OPTIMAL`, drugi przebieg dostaje krótki, ograniczony czas deterministyczny zamiast całej reszty zegara. Grafik 30-dniowy nie ma prawa trwać tyle co 91-dniowy.
- Wprowadzić preflight przed uruchomieniem: czy każdy dzień zakresu ma co najmniej dwie osoby eligible i dostępne. Dziś konflikt wykrywa się dopiero po 30 sekundach.

**N1.2 Przenieść blokadę optymistyczną zamian na poziom slotu.** (BLK-03)

- `SwapRequest` przechowuje `assignment_id` (albo trójkę `schedule_id, service_date, role`) i wersję **tego przydziału**, nie całego grafiku. Wymaga kolumny wersji na `assignments` albo warunku na `member_id` w chwili tworzenia prośby.
- Bez tej zmiany koordynator może zatwierdzić dokładnie jedną zamianę na sesję, co zmierzono w scenariuszu A defektu BLK-03.
- `approve_swap` sprawdza, czy slot nadal należy do wnioskodawcy; zmiany na innych dniach są nieistotne.
- Gdy slot faktycznie zmienił właściciela, prośba przechodzi automatycznie w `cancelled` z powodem systemowym, zamiast zostawać `pending_coordinator` na zawsze.
- Warunek „istnieje aktywna zamiana” musi pomijać prośby, których nie da się już zatwierdzić.
- Komunikat 409 powinien mówić, co zrobić, a nie proponować akcję, która jest zablokowana.

**N1.3 Domknąć cykl życia członka rotacji.** (BLK-04)

- `PATCH /admin/team-members/{id}` z `active_until` zwraca 409 z listą kolidujących dyżurów, jeśli osoba ma przydziały po tej dacie w opublikowanym grafiku.
- Interfejs pokazuje tę listę i oferuje dwie drogi: przepisać dyżury na inne osoby albo świadomie zwolnić sloty i oznaczyć je jako brak obsady.
- `coverageGaps` musi wykrywać przydział wskazujący na osobę spoza aktywnej rotacji jako lukę.
- Macierz kalendarza pokazuje wiersz osoby nieaktywnej, dopóki ma choć jeden dyżur w wyświetlanym zakresie, wyraźnie oznaczony jako „poza rotacją”.

### Etap N2. Spójność danych i domknięcie ścieżek

**N2.1 Obsadzanie pustego slotu z macierzy.** (HGH-02)
`POST /api/v1/calendar/override` tworzy przydział, gdy go nie ma, zamiast zwracać 404.
Przycisk w dialogu przestaje być wyłączony, a jego etykieta zmienia się na „Obsadź” dla pustego slotu.

**N2.2 Przejść w całości na `member_id` jako tożsamość dyżuru.** (BLK-05, HGH-03)

To jedna przyczyna dla dwóch defektów i wymaga jednej decyzji projektowej, a nie trzech łatek.

- `Assignment.assignee_name` przestaje być nośnikiem tożsamości i staje się wyłącznie etykietą historyczną dla wierszy importu, które nie mają `member_id`. Wszędzie indziej wyświetlana nazwa pochodzi z aktualnego `TeamMember.display_name`.
- Wymienić porównania po nazwie na `member_id` w: `_conflicts_with_other_oncall_role`, `replacement_options` (filtr `member.display_name != conflicting_assignee`), `swap_impact` (wyszukanie wnioskodawcy), `_validate_complete` (reguła primary != secondary), `direct_override` i `override_draft_assignment` (wykrywanie kolizji ról), `duty_points`. Wzorzec jest już w `effective.matches_member` i `create_swap` go używa.
- Migracja: uzupełnić brakujące `member_id` w istniejących wierszach dopasowaniem po nazwie **jednorazowo**, przed wdrożeniem nowych reguł.
- Przy zmianie nazwiska aktualizować `assignee_name` we wszystkich powiązanych wierszach (`admin.py:update_user` już podnosi `team_member.display_name`, brakuje kroku dla `assignments`). To naprawia wyświetlanie starego nazwiska w opublikowanym grafiku.
- Testy regresyjne: po zmianie nazwiska liczba wierszy rozwinięcia bilansu bez zmian, `swap_impact` zwraca 200, a próba obsadzenia tej samej osoby w obu rolach on-call kończy się 422 na każdej z trzech ścieżek (zamiana, override koordynatora, korekta szkicu).
- Dodatkowo wzmocnić `_validate_complete` o porównanie `member_id`, żeby publikacja wychwyciła kolizję niezależnie od etykiet.

**N2.3 Walidacja importu historii i odwracalność.** (HGH-04)
- Sprawdzać w `commit_history` te same reguły twarde co w publikacji: `primary != secondary` tego samego dnia, brak `late_shift` w dni wolne, data w okresie członkostwa osoby. Odrzucone wiersze pokazywać w podglądzie z numerem wiersza.
- Dopuścić `DELETE` grafiku o statusie `superseded`, jeśli powstał z importu i nie jest źródłem żadnego aktywnego slotu. Alternatywnie dodać status `revoked`, wykluczany z `RESOLVED_STATUSES`.
- Na ekranie importu pokazać listę wcześniejszych importów z liczbą wierszy, zakresem, autorem i akcją cofnięcia.

**N2.4 Powiadomienia.** (HGH-05)
- Dodać `notify_coordinator_pending_approval` przy przejściu w `pending_coordinator`, kierowane do wszystkich aktywnych kont `coordinator` i `admin` z adresem e-mail.
- Wprowadzić ponowne kolejkowanie wierszy `skipped` po skonfigurowaniu kanału, albo zapisywać je jako `pending` z odległym `next_attempt_at`, żeby nie przepadały.
- Dodać powiadomienie w aplikacji (licznik na „Zamiany” już istnieje, brakuje go dla koordynatora i trwałego wskaźnika po zalogowaniu).

**N2.7 Przypomnienie o przekazaniu numeru przez wspólne rozstrzyganie.** (HGH-07)
Zastąpić własne zapytanie w `worker._primary_on` wywołaniem `effective_assignments(db, day, day)` i odczytem slotu `(day, primary)`.
`scan_handover` powinien wybierać grafik z tego samego rozstrzygnięcia, a nie osobnym zapytaniem.

**N2.5 Walidacja dostępności.** (MED-04)
Odrzucać wpisy pokrywające się z istniejącym wpisem tej samej osoby o innym rodzaju, odrzucać duplikaty i ostrzegać przy wpisie w całości w przeszłości.

**N2.6 Ograniczenie serii w solverze.** (MED-11)
Dodać twarde ograniczenie maksymalnej liczby kolejnych dni z dyżurem (proponowana wartość konfigurowalna, domyślnie 3 dla ról on-call) oraz minimalny odstęp po dyżurze weekendowym.
`docs/SOLVER.md` już przewiduje to jako brak; skutek zmierzony w MED-11 uzasadnia priorytet.

### Etap N3. Interfejs i użyteczność

**N3.1 Dialog dnia przebudować w szczegóły dnia.** (MED-01, MED-02, MED-03, HGH-06, MED-12)

Jeden dialog dla wszystkich ról, z zawartością zależną od uprawnień:

- nagłówek: data, dzień tygodnia, 2X lub nazwa święta, okno pokrycia,
- obsada wszystkich trzech ról tego dnia, z oznaczeniem override i zamiany,
- własna dostępność (dla członka) lub dostępność wskazanej osoby (dla koordynatora),
- dla członka: przycisk „Poproś o zamianę” prowadzący do formularza **z wypełnioną datą i rolą**, przez router SPA, nie przez `href`,
- dla koordynatora: wybór roli z etykietą „Rola do zmiany”, lista kandydatów **przefiltrowana po eligibility i dostępności**, jawne zdanie „Przypiszesz: <osoba>”, potwierdzenie w `ConfirmDialog`, a błąd renderowany wewnątrz dialogu,
- dla 11–19 w dniu wolnym: „nie dotyczy w dzień wolny” zamiast „Brak przydziału”,
- usunąć baner „[READ ONLY] Konto nie jest członkiem rotacji” dla ról, które mogą edytować.

**N3.2 Ekran sprawiedliwości.** (MED-06)
Przenieść opis słowny z panelu prognozy szkicu do tabeli głównej, dodać sortowanie po odchyleniu w każdej kategorii, dodać wiersz sum, rozciągnąć tabelę na pełną szerokość.

**N3.3 Panel audytu.** (MED-09)
Filtr zakresu dat i filtr po osobie, stronicowanie oparte na istniejącym `offset`, rozwijalny podgląd `details`, jawna strefa czasowa przy znaczniku, eksport CSV, domyślne ukrycie `auth.login` za osobnym przełącznikiem.

**N3.4 Raport miesięczny.** (MED-08)
Domyślnie miesiąc poprzedni, podgląd tabeli przed pobraniem, ostrzeżenie o dniach miesiąca bez opublikowanego grafiku.

**N3.5 Ekran osób.** (MED-13, MED-14)
Sortowanie po nazwisku, wyszukiwanie, filtr roli i statusu, jeden przycisk zapisu na dialog z podsumowaniem zmian, ostrzeżenie przy zamknięciu z niezapisanymi zmianami, naprawa przycięcia ostatniego wiersza formularza.

**N3.6 Linki viewer.** (MED-10)
Chip „Aktywny” i „Wygasł” obok istniejących „Odwołany” i „Użyty”, realne przyciski zamiast wyszarzonego tekstu, filtr ukrywający odwołane.

**N3.7 Odznaki.** (MED-05)
Usunąć `showZero` w `Swaps.tsx:302`.
W `AppShell.tsx:137` opakowywać w `Badge` tylko pozycję, która faktycznie ma licznik, albo dodać `aria-hidden` na pustej odznace.

**N3.8 Drobne.** (LOW-01 do LOW-06)
Ujednolicić język „eyebrow”, dodać na ekranie logowania informację o ścieżce odzyskania dostępu, ukryć odwołane subskrypcje ICS, podnieść kontrast znaku „/” w logo, poprawić zdanie o prywatności notatki.

### Etap N4. Braki funkcjonalne wobec planu

Nie są defektami, ale `PLAN.md` je obiecuje, a ich nie ma:

- porównanie wariantu dziennego i tygodniowego obok siebie z metrykami (`PLAN.md` par. 4 i par. 6 ekran 5); `docs/SOLVER.md` odnotowuje to jako brak,
- postęp generowania (dziś tylko napis „Generuję…” przez 30 s),
- wersjonowany i corocznie zatwierdzany kalendarz świąt (dziś biblioteka `holidays` bez procesu),
- usuwanie eligibility i usuwanie lub anonimizacja konta (MED-07).

---

## 12. Jak odtworzyć defekty samodzielnie

Skrypty testowe leżą w `docs/qa-suite/`, zrzuty ekranu w `docs/qa-shots/`.

Przygotowanie środowiska:

```bash
docker compose up -d --build
docker compose cp docs/qa-suite/seed_qa.py api:/tmp/seed_qa.py
docker compose exec api python /tmp/seed_qa.py
```

Skrypty korzystają z `httpx`, dostępnego w `backend/.venv`:

```bash
cd docs/qa-suite
../../backend/.venv/bin/python t01_auth_rbac.py        # RBAC i sesje
../../backend/.venv/bin/python t02_generator.py        # generator i workflow, ok. 2 min
../../backend/.venv/bin/python t03_blocking.py         # BLK-01: zamrożenie API
../../backend/.venv/bin/python t04_swaps.py            # cykl zamian
../../backend/.venv/bin/python t05_fairness_reports.py # HGH-03: zmiana nazwiska
../../backend/.venv/bin/python t06_import_share_ics.py # HGH-04: import, linki, ICS
../../backend/.venv/bin/python t07_perf.py             # wydajność, ok. 4 min
../../backend/.venv/bin/python t08_perf2.py            # BLK-02: 504 i szkice-widma
../../backend/.venv/bin/python t09_edge.py             # walidacja i przypadki brzegowe
../../backend/.venv/bin/python t10_orphan.py           # BLK-04: osierocone dyżury
../../backend/.venv/bin/python t11_deadlock.py         # BLK-03, scenariusz B (override)
../../backend/.venv/bin/python t12_rename_swaps.py     # HGH-03: zamiany po zmianie nazwiska
../../backend/.venv/bin/python t13_rename_doublebook.py # BLK-05: jedna osoba w obu rolach
../../backend/.venv/bin/python t14_swap_swap.py        # BLK-03, scenariusz A (dwie zamiany)
```

`t13_rename_doublebook.py` i `t14_swap_swap.py` celowo zostawiają zepsuty stan w bazie, żeby dało się go obejrzeć w interfejsie.
Po nich uruchom ponownie `seed_qa.py`.

`t10_orphan.py` zmienia dane i przywraca je częściowo.
Po jego uruchomieniu wykonaj `docker compose exec api python /tmp/seed_qa.py`, żeby wrócić do czystego stanu.

Odtworzenie warunków sprzętowych z rozdziału 9:

```bash
docker update --cpus=2   --memory=4g   --memory-swap=4g   oncall-api-1
docker update --cpus=1   --memory=2g   --memory-swap=2g   oncall-db-1
docker update --cpus=0.5 --memory=1g   --memory-swap=1g   oncall-worker-1
docker update --cpus=0.5 --memory=512m --memory-swap=512m oncall-web-1
# powrót do braku limitów
docker compose up -d --force-recreate api worker web
```

### Najkrótsze ścieżki ręczne

| Defekt | Kroki |
| --- | --- |
| BLK-01 | Zaloguj `koord`, uruchom generowanie 91 dni. W drugiej karcie odświeżaj `http://localhost:8080/`. Aplikacja stoi 30 s. |
| BLK-02 | Dwie karty, `koord` i `anna`, oba uruchamiają generowanie w tej samej chwili. Oba dostają błąd, a `#generator` pokazuje dwa nowe szkice. |
| BLK-03 | Dwie różne osoby zgłaszają zamiany na dwa różne dni, oba zastępcy akceptują. `koord` zatwierdza pierwszą: 200. `koord` zatwierdza drugą: 409. Autor drugiej próbuje zgłosić ją ponownie: 409. Slot jest zablokowany. |
| BLK-05 | Zapamiętaj, kto ma PRIMARY i SECONDARY danego dnia. Jako `admin` zmień nazwisko osoby z SECONDARY. Jako osoba z PRIMARY zgłoś zamianę i wybierz z listy tę właśnie osobę (będzie na liście). Zastępca akceptuje, `koord` zatwierdza. W grafiku ta sama osoba figuruje w obu rolach pod dwoma nazwiskami. |
| BLK-04 | Jako `admin` w `#osoby` otwórz szczegóły osoby z przyszłymi dyżurami, ogranicz każdy okres eligibility datą jutrzejszą, potem ustaw „Wyjście do” na jutro. Wróć na `#kalendarz`: wiersz zniknął, dyżury zniknęły, ostrzeżenie o braku obsady się nie pojawiło. |
| HGH-02 | Jako `koord` otwórz zakres z luką (np. `?od=2026-10-01&do=2026-10-06` po zaimportowaniu danych QA), kliknij dowolną komórkę w dniu oznaczonym `!`. Przycisk „Przypisz bezpośrednio” jest wyłączony. |
| HGH-03 | Jako `admin` zmień nazwisko `marek`. Jako `marek` otwórz `#sprawiedliwosc` i kliknij swoją pozycję: lista pusta, choć podsumowanie pokazuje punkty. Na `#zamiany` wybierz swój dyżur sprzed zmiany nazwiska: podgląd wpływu nie ładuje się (409). Na `#kalendarz` Twoje dyżury nadal mają stare nazwisko. |
| HGH-04 | Jako `koord` zaimportuj CSV z dwoma wierszami: `2024-03-01,primary,Marek Nowak` i `2024-03-01,secondary,Marek Nowak`. Import przechodzi. |

---

## 13. Uwagi metodyczne

- Wyniki wydajnościowe pochodzą z hosta, na którym działał także generator obciążenia. Bezwzględne liczby na dedykowanej maszynie będą lepsze; wnioski (co jest wąskim gardłem, a co nie) są od tego niezależne.
- `docs/SOLVER.md` wymienia synchroniczne działanie solvera, brak limitów serii i brak ekranu porównania wariantów jako świadome ograniczenia. Zgłaszam je mimo to, bo zmierzony skutek (globalny przestój, 504, skrajnie nierówny szkic w krótkim oknie) jest większy niż to, co dokumentacja sugeruje, a `PLAN.md` obiecuje te funkcje wprost.
- `docs/UI-REVIEW.md` zawiera wcześniejszy przegląd interfejsu. Zweryfikowałem jego kluczowe ustalenia: przełącznik motywu, kontrast paska górnego w motywie jasnym, format daty `DD-MM-YYYY`, roving tabindex w macierzy i brak przepełnienia poziomego na 390 px są **naprawione**. Otwarte pozostają angielskie „eyebrow” (LOW-01) i akcje destrukcyjne bez potwierdzenia (HGH-06, MED-13).
- Testy jednostkowe backendu i frontendu nie były uruchamiane w tej sesji; raport opiera się wyłącznie na czarnej skrzynce przez HTTP i przeglądarkę, uzupełnionej czytaniem kodu dla ustalenia przyczyn.
