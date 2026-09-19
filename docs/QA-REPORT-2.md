# Raport testów QA nr 2 - Erste On-call

Autor: starszy inżynier testów (sesja Claude Code)
Data wykonania: 2026-09-05, po wdrożeniu poprawek z [QA-REPORT.md](QA-REPORT.md)
Wersja testowana: `main` po przebudowie backendu i frontendu (obraz zbudowany lokalnie)
Środowisko: Docker Compose (`db`, `api`, `worker`, `web`), frontend pod `http://localhost:8080`

Raport powtarza w całości zakres z rundy 1, weryfikuje status każdego zgłoszonego defektu i opisuje defekty nowe.
Plan naprawczy znajduje się w rozdziale 8.

---

## 1. Poświadczenia testowe

Bez zmian względem rundy 1. Konta odtwarza `docs/qa-suite/seed_qa.py`.
Hasło kont QA: **`TestOncall2026!`**
Hasło konta `admin` z `.env` (`ONCALL_ADMIN_PASSWORD`): **`Qwertyuiop1!`**

| Login | Hasło | Rola | W rotacji | Uwagi |
| --- | --- | --- | --- | --- |
| `admin` | `Qwertyuiop1!` | admin | nie | konto bootstrapowane z `.env` |
| `admin2` | `TestOncall2026!` | admin | nie | drugi administrator |
| `koord` | `TestOncall2026!` | coordinator | nie | koordynator spoza rotacji |
| `anna` | `TestOncall2026!` | coordinator | tak | koordynator, który sam dyżuruje |
| `marek` | `TestOncall2026!` | member | tak | twarda niedostępność (urlop) |
| `ola` | `TestOncall2026!` | member | tak | preferencja „wolę nie” |
| `piotr` | `TestOncall2026!` | member | tak | preferencja „chętnie wezmę” |
| `kasia` | `TestOncall2026!` | member | tak | twarda niedostępność (krótka) |
| `tomek` | `TestOncall2026!` | member | tak | - |
| `ewa` | `TestOncall2026!` | member | tak | eligibility bez `primary` |
| `jakub` | `TestOncall2026!` | member | tak | eligibility bez `late_shift` |
| `magda` | `TestOncall2026!` | member | tak | - |
| `rafal` | `TestOncall2026!` | member | tak | wszedł do rotacji 90 dni temu |
| `viewer` | `TestOncall2026!` | viewer | nie | - |
| `viewer2` | `TestOncall2026!` | viewer | nie | - |

Uwaga: `anna` jest koordynatorem **i** członkiem rotacji.
Jeśli w scenariuszu zamian trafi jako zastępca, będzie mogła sama zatwierdzić zamianę i nie jest to błąd uprawnień.

---

## 2. Co zmieniło się w kodzie między rundami

Zmiany objęły niemal cały backend i większość ekranów frontendu.
Najważniejsze z punktu widzenia testów:

| Zmiana | Czego dotyczy |
| --- | --- |
| `uvicorn --workers 2` oraz `anyio.to_thread.run_sync` wokół solvera | BLK-01, BLK-02 |
| Nowe `POST /api/v1/scheduling/runs` (202) i `GET /runs/{id}` plus tabela `schedule_runs` | BLK-01, postęp generowania |
| `proxy_read_timeout 90s` w `nginx.conf` | BLK-02 |
| Blokada zamian przeniesiona na poziom slotu | BLK-03 |
| Kontrola dyżurów przy zamykaniu okresu rotacji | BLK-04 |
| Porównania po `member_id` zamiast po `assignee_name` w zamianach, override'ach i walidacji publikacji | BLK-05, HGH-03 |
| `MAX_CONSECUTIVE_ONCALL_DAYS = 3` jako ograniczenie twarde solvera | MED-11 |
| Refine solvera ograniczony do `min(remaining, 5.0)` | HGH-01 |
| Walidacja importu wobec reguł twardych i okresu członkostwa, `GET /api/v1/history/imports` | HGH-04 |
| `DELETE` dla kont i okresów eligibility | MED-07 |
| Powiadomienie koordynatorów o zamianie do zatwierdzenia, ponawianie wierszy `skipped` | HGH-05 |
| `worker._primary_on` przez `effective_assignments` | HGH-07 |
| Wersjonowany kalendarz świąt (`holiday_calendar_versions`, ekran `/swieta`) | brak z rundy 1, par. N4 |
| Porównanie wariantu dziennego i tygodniowego (`GET /scheduling/compare`, `ScheduleComparison.tsx`) | brak z rundy 1, par. N4 |
| Filtry, eksport CSV i strefa czasowa w audycie | MED-09 |
| Opis słowny odchylenia, podgląd raportu, statusy linków, wyszukiwarka osób | MED-06, MED-08, MED-10, MED-14 |

---

## 3. Zakres testów w rundzie 2

Powtórzono cały zestaw z rundy 1, plus przypadki dopisane pod defekty rundy 1.

| Obszar | Metoda | Przypadki |
| --- | --- | --- |
| Uwierzytelnianie, sesje, CSRF | API | 15 |
| Macierz RBAC (13 endpointów x 5 sesji) | API | 65 |
| Próby eskalacji uprawnień | API | 8 |
| Generator, workflow szkicu, blokada optymistyczna, generowanie asynchroniczne | API | 30 |
| Cykl życia zamian i override'ów | API | 32 |
| Tożsamość po zmianie nazwiska | API | 12 |
| Sprawiedliwość i raport miesięczny CSV | API | 29 |
| Import historii, linki viewer, ICS, audyt | API | 46 |
| Przypadki brzegowe i walidacja | API | 37 |
| Współbieżność zamian i publikacji | API | 8 |
| Wydajność | API + `docker stats` | 16 |
| Testy eksploracyjne i użyteczności UI | Chrome DevTools | 4 role, 11 ekranów |
| Dostępność: kontrast, klawiatura, drzewo dostępności | Chrome DevTools + skrypt kontrastu | 5 przebiegów |

Środowisko wydajnościowe identyczne jak w rundzie 1: `api` 2 rdzenie / 4 GB, `db` 1 / 2 GB, `worker` 0.5 / 1 GB, `web` 0.5 / 512 MB.

---

## 4. Podsumowanie

Runda 2 wypada bardzo dobrze.
**Wszystkie pięć defektów blokujących z rundy 1 jest naprawionych i potwierdzonych pomiarem.**
Z siedmiu defektów wysokich z rundy 1 pięć jest zamkniętych w całości, dwa częściowo.
Doszły natomiast dwa nowe defekty wysokie (NEW-01 i NEW-02), więc otwartych pozycji tej wagi jest teraz cztery: HGH-01, HGH-02, NEW-01 i NEW-02.

Automatyczny zestaw regresyjny, uruchamiany po zasianiu świeżych danych przed każdym skryptem: **243 przypadki zaliczone, 4 niezaliczone**.
Z tych czterech tylko jeden jest defektem aplikacji (NEW-02, usuwanie konta po użyciu generatora).
Pozostałe trzy to artefakty samego zestawu: viewer dostaje pustą listę subskrypcji ICS zamiast 403 (kwestia sporna, nie defekt) oraz dwa zdarzenia audytowe, których nie ma w oknie ostatnich 200 wpisów, bo skrypt je wytwarzający nie był częścią tej serii.

| Status | Liczba |
| --- | --- |
| Naprawione w całości | 20 |
| Naprawione częściowo | 7 |
| Bez zmian | 5 |
| **Razem z rundy 1** | **32** |
| Nowe defekty (regresje i skutki uboczne poprawek) | 5 |

Nowych defektów blokujących nie ma.
Dwa nowe defekty są wysokie i oba są bezpośrednim skutkiem ubocznym poprawek z rundy 1.

---

## 5. Status defektów z rundy 1

### 5.1 Blokujące: wszystkie naprawione

| ID | Defekt | Status | Dowód z rundy 2 |
| --- | --- | --- | --- |
| BLK-01 | Generowanie zamraża całą aplikację | **Naprawione** | `GET /health` w trakcie generowania: maks. **17 ms**, średnia 3 ms, 123 próbki. W rundzie 1 było 30 065 ms i 5 próbek. |
| BLK-02 | Dwa generowania naraz kończą się 504 i zostawiają szkice-widma | **Naprawione** | Dwa równoległe uruchomienia 61-dniowe: **201 i 201** w 30.1 s ścianowo (runda 1: 504 i 504 w 60.1 s). Liczba utworzonych szkiców zgadza się z liczbą udanych odpowiedzi. |
| BLK-03 | Zatwierdzenie jednej zamiany unieważnia wszystkie pozostałe | **Naprawione** | Scenariusz A (dwie zamiany na różne dni): zatwierdzenie pierwszej 200, drugiej **200**. Scenariusz B (niezwiązany override koordynatora, potem zatwierdzenie): **200**. |
| BLK-04 | Wyjście z rotacji osieroca opublikowane dyżury | **Naprawione** | `PATCH /admin/team-members/{id}` z `active_until` przy 28 przyszłych dyżurach zwraca **409** z listą kolidujących slotów: „Osoba ma dyżury po dacie wyjścia z rotacji. Najpierw przepisz lub zwolnij sloty: 2026-09-09 (late_shift), 2026-09-10 (primary), …”. |
| BLK-05 | Zmiana nazwiska pozwala obsadzić jedną osobę w obu rolach on-call | **Naprawione** | Po zmianie nazwiska osoby pełniącej SECONDARY: nie pojawia się na liście zastępców do PRIMARY, a `POST /swaps` zwraca **422 „Zastępca ma już drugi on-call tego dnia”**. Porównania idą teraz po `member_id`. |

### 5.2 Wysokie

| ID | Defekt | Status | Uwagi |
| --- | --- | --- | --- |
| HGH-01 | Generowanie zawsze zużywa cały budżet 30 s | **Częściowo** | Patrz 5.2.1. |
| HGH-02 | Koordynator nie może obsadzić dnia bez obsady | **Częściowo** | Patrz 5.2.2. |
| HGH-03 | Zmiana nazwiska rozspójnia grafik, bilans i podgląd zamiany | **Naprawione** | Wszystkie trzy objawy zamknięte: opublikowany slot pokazuje nowe nazwisko, `GET /swaps/impact` zwraca 200 (było 409), rozwinięcie bilansu zachowuje 127 wierszy (było 0). |
| HGH-04 | Import przyjmuje dane łamiące reguły twarde i jest nieodwracalny | **Naprawione** | Cztery przypadki testowe odrzucone kodem 422: ta sama osoba jako primary i secondary, `late_shift` w sobotę, dyżur przed wejściem do rotacji, duplikat pary (data, rola). Zaimportowany grafik jest usuwalny (`DELETE` 204). Powstał `GET /api/v1/history/imports`. |
| HGH-05 | Brak powiadomienia koordynatora, `skipped` jako stan końcowy | **Naprawione** | Po akceptacji zastępcy w kolejce pojawiają się wiadomości „Do zatwierdzenia…” do `anna`, `koord` i `admin2`. `drain_outbox` obejmuje teraz również wiersze `skipped`, więc po skonfigurowaniu SMTP zostaną wysłane. |
| HGH-06 | Zmiana obsady bez potwierdzenia, błąd poza dialogiem | **Naprawione** | Dodano dialog „Potwierdź obsadzenie slotu” z jawnym „Przypiszesz: <osoba>”. Sam dialog dnia również pokazuje „Przypiszesz”, a komunikat błędu renderuje się wewnątrz dialogu. |
| HGH-07 | Przypomnienie o przekazaniu numeru omija wspólne rozstrzyganie | **Naprawione** | `worker._primary_on` to teraz jedno wywołanie `effective_assignments(db, day, day)`. |

#### 5.2.1 HGH-01 częściowo: czas generowania zależy już od trudności, ale kryterium z planu nadal niespełnione

Poprawka `min(remaining, 5.0)` na drugim przebiegu zadziałała i zniknęło zjawisko „każdy zakres trwa dokładnie tyle samo”.

| Zakres | Runda 1 | Runda 2 | Status CP-SAT (runda 2) |
| --- | --- | --- | --- |
| 7 dni | nie mierzono | **2.52 s** | OPTIMAL |
| 14 dni | nie mierzono | 22.46 s | FEASIBLE |
| 30 dni | 30.10 s | 30.07 s | FEASIBLE |
| 60 dni | nie mierzono | 30.10 s | FEASIBLE |
| 91 dni | 30.14 s | 30.13 s | FEASIBLE |

Krótki zakres jest teraz szybki i kończy się statusem `OPTIMAL`, co jest realną poprawą.
Powyżej dwóch tygodni **pierwszy** przebieg nie zbiega w budżecie i wynik nigdy nie jest optymalny.
Kryterium `PLAN.md` par. 8 („90-dniowy grafik w mniej niż 30 sekund”) pozostaje niespełnione, ale przyczyna zmieniła się z pozornej na rzeczywistą: model jest po prostu trudny.

Warto odnotować zależność między poprawkami: dodanie twardego ograniczenia serii (MED-11) powiększa model i utrudnia zbieżność, więc poprawa jednego kryterium planu pogarsza drugie.

Skutek operacyjny jest jednak nieporównywalnie mniejszy niż w rundzie 1, bo generowanie nie blokuje już nikogo innego.

#### 5.2.2 HGH-02 częściowo: luka wewnątrz grafiku daje się obsadzić, luka poza grafikiem nie

Przycisk nie jest już wyłączony, ma sensowną etykietę „Obsadź”, a dialog pokazuje „Przypiszesz: <osoba>” i wymaga potwierdzenia.
`POST /api/v1/calendar/override` potrafi teraz **utworzyć** brakujący przydział, a nie tylko podmienić istniejący.

Zmierzone rozróżnienie:

| Przypadek | Wynik |
| --- | --- |
| Luka **wewnątrz** zakresu opublikowanego grafiku (usunięty slot 2026-09-24 PRIMARY) | **200**, slot obsadzony, oznaczony jako `manual_override` |
| Dzień **poza** zakresem jakiejkolwiek publikacji (2026-10-03, grafik kończy się 2026-10-02) | **404** „Nie znaleziono opublikowanego grafiku” |

Drugi przypadek to w praktyce częstszy rodzaj luki, bo najczęstszą przyczyną braku obsady jest po prostu koniec opublikowanego zakresu.
Baner ostrzegawczy zgłasza obie sytuacje identycznie („4 dni w tym zakresie nie ma pełnej obsady”), a przycisk „Pokaż pierwszy” prowadzi do komórki, w której akcja zakończy się błędem.
Poprawną odpowiedzią w tym przypadku jest wygenerowanie i opublikowanie kolejnego zakresu, ale interfejs tego nie mówi.

Warto zważyć proporcje.
Na świeżo zasianych danych opublikowany grafik kończy się 2026-10-02, a domyślny widok obejmuje 30 dni od dziś, więc **wszystkie luki, które baner zgłasza w stanie domyślnym, są tego drugiego rodzaju**.
Nowo odblokowany przycisk „Obsadź” zawodzi zatem w stu procentach przypadków osiągalnych przez „Pokaż pierwszy”, dopóki koordynator sam nie wejdzie w zakres, w którym luka leży wewnątrz publikacji.
Z perspektywy użytkownika HGH-02 wygląda więc nadal jak niedziałająca funkcja, mimo że mechanizm po stronie API jest już poprawny.

Patrz też NEW-03: sam błąd jest zasłonięty przez okno potwierdzenia.
Oba defekty mają jedną powierzchnię, bo NEW-03 wyzwala się właśnie na tej ścieżce 404; naprawa M2.1 usuwa większość jego osiągalności.

### 5.3 Średnie

| ID | Defekt | Status | Uwagi |
| --- | --- | --- | --- |
| MED-01 | „Brak przydziału” dla 11–19 w dzień wolny | **Bez zmian** | Sobota 05-09-2026 nadal pokazuje kartę `[11–19]` z napisem „Brak przydziału” i pomarańczowym paskiem, choć reguła nie przewiduje tej roli w dni wolne. |
| MED-02 | Baner „[READ ONLY]” u koordynatora, który może edytować | **Częściowo** | Etykieta zmieniona na `[STATUS GRAFIKU]`, ale zdanie „Konto nie jest członkiem rotacji” nadal stoi pod macierzą, w której koordynator swobodnie edytuje komórki. Obniżam do niskiego. |
| MED-03 | Dialog dnia bez szczegółów, link bez kontekstu | **Częściowo** | Link to teraz „Poproś o zamianę” z parametrami `?data=2026-09-06&rola=primary`, a ekran zamian **poprawnie preselekcjonuje** dyżur („niedz 06-09-2026 · PRIMARY (jutro)”). Nadal brakuje jednak szczegółów dnia: obsady pozostałych ról i okna pokrycia, czego wymaga `PLAN.md` par. 6. |
| MED-04 | Brak walidacji wpisów dostępności | **Naprawione** | Sprzeczny wpis nakładający się na istniejący, dokładny duplikat i wpis w całości w przeszłości są odrzucane. |
| MED-05 | Odznaka „0” | **Częściowo** | Odznaki w nawigacji zniknęły z DOM i z drzewa dostępności. Odznaka przy „Wymaga Twojej akcji” jest już niewidoczna wizualnie, ale nadal ma `textContent = "0"`, więc czytnik ekranu przeczyta „Wymaga Twojej akcji 0”. Obniżam do niskiego. |
| MED-06 | Ekran sprawiedliwości bez opisu słownego, sortowania i na 58% szerokości | **Częściowo** | Opis słowny dodany i poprawny („38.77 ponad udział”, „4.93 poniżej udziału”, „zgodnie z udziałem”). Nadal brak sortowania po odchyleniu (żaden nagłówek nie jest przyciskiem, brak `aria-sort`), brak wiersza sum (`tfoot` nie istnieje), tabela ma 878 px przy oknie 1600 px. |
| MED-07 | Nie da się usunąć eligibility ani konta | **Naprawione** | `DELETE /admin/eligibility/{id}` i `DELETE /admin/users/{id}` zwracają 204. Usunięcie konta ma dobre okno potwierdzenia: „Konto, sesje i dane osobowe zostaną trwale usunięte. Historyczne dyżury pozostaną jako zapis operacyjny.” Zastrzeżenie: patrz NEW-02. |
| MED-08 | Raport bez podglądu, domyślnie bieżący miesiąc | **Częściowo** | Domyślny miesiąc to teraz poprzedni (08-2026), doszedł podgląd tabeli. Podgląd pokazuje jednak wyłącznie sumy PRIMARY, SECONDARY i 11–19, bez rozbicia na dni robocze, weekendy i święta, czyli bez kolumn, które decydują o rozliczeniu. Nadal brak ostrzeżenia o miesiącu pokrytym tylko częściowo. |
| MED-09 | Panel audytu nie nadaje się do dochodzenia | **Naprawione** | Doszły: filtr osoby, wyszukiwanie pełnotekstowe, zakres dat, przełącznik „Pokaż zwykłe logowania”, „Eksportuj CSV”, rozwijane „Szczegóły”, przycisk „Załaduj więcej” (stronicowanie, którego brakowało) i jawna strefa „Europe/Warsaw” przy każdym znaczniku. Zastrzeżenie: patrz NEW-01. |
| MED-10 | Linki viewer bez oznaczenia stanu aktywnego | **Naprawione** | Doszedł chip „Aktywny” oraz przełącznik „Pokaż odwołane”, który domyślnie ukrywa odwołane pozycje. |
| MED-11 | Brak limitu serii | **Naprawione** | `MAX_CONSECUTIVE_ONCALL_DAYS = 3` jako ograniczenie twarde. Zmierzone na szkicu 14-dniowym: najdłuższa seria on-call **3 dni** dla każdej osoby (runda 1: 5 i więcej pod rząd). |
| MED-12 | Etykieta „Rotacja do zmiany” | **Naprawione** | Jest „Rola do zmiany”. |
| MED-13 | Karta osoby: wiele przycisków zapisu, przycięty ostatni wiersz | **Bez zmian** | Nadal pięć osobnych przycisków zapisu („Zapisz konto”, „Zapisz okres rotacji”, trzy razy „Zapisz okres”), brak ostrzeżenia o niezapisanych zmianach, ostatni wiersz formularza nadal przycięty przez przyklejony pasek akcji. Doszedł nowy drobiazg: link „Usuń” przy każdym okresie eligibility jest wyrzucony do osobnej linii pod nazwą roli, wizualnie oderwany od wiersza, którego dotyczy. |
| MED-14 | Lista osób sortowana po loginie | **Naprawione** | Sortowanie po nazwie wyświetlanej, doszła wyszukiwarka po osobie, loginie i numerze. Zastrzeżenie: patrz NEW-04. |

### 5.4 Niskie

| ID | Status | Uwagi |
| --- | --- | --- |
| LOW-01 angielskie „eyebrow” | **Naprawione** | Wszystkie sprawdzone ekrany mają polskie etykiety: `[OPUBLIKOWANY]`, `[ŚLAD AUDYTOWY]`, `[EKSPORT DLA KADR]`, `[DOSTĘP DLA ODBIORCY]`, `[BILANS 12 MIESIĘCY]`, `[GENERATOR SZKICU]`, `[KONTA I ROTACJA]`. |
| LOW-02 brak ścieżki odzyskania hasła | **Bez zmian** | Ekran logowania nadal nie mówi, do kogo się zwrócić po reset. |
| LOW-03 odwołane subskrypcje ICS zostają na liście | **Bez zmian** | Brak odpowiednika przełącznika „Pokaż odwołane”, który dodano dla linków viewer. |
| LOW-04 brak historii importów na ekranie | **Naprawione** | Zweryfikowane po zatwierdzeniu prawdziwego importu: ekran `#import` ma sekcję „Wcześniejsze importy” z nazwą pliku, zakresem dat, liczbą wierszy i przyciskiem **„Cofnij import”**. To domyka również odwracalność z HGH-04 po stronie interfejsu. Drobiazg językowy: liczebnik nie jest odmieniany („2 wierszy” zamiast „2 wiersze”). |
| LOW-05 kontrast znaku „/” w logo | **Naprawione** | Automatyczny audyt kontrastu: **zero naruszeń** w motywie ciemnym i zero w jasnym. |
| LOW-06 notatka „zobaczy ją tylko koordynator” | **Bez zmian** | Administrator również widzi notatkę. |

---

## 6. Nowe defekty

Wszystkie pięć to skutki uboczne poprawek z rundy 1.

### NEW-01 Filtr audytu „auth.login” zawsze zwraca pustą listę, a podpowiedź w tym stanie wprowadza w błąd

**Waga:** wysoka
**Obszar:** `routes/admin.py:list_audit_events`, `screens/admin/Audit.tsx`
**Rola:** admin

Poprawka MED-09 dodała przełącznik „Pokaż zwykłe logowania”, żeby logowania nie zasypywały dziennika.
Warunek działa jednak bezwarunkowo, także wtedy, gdy użytkownik jawnie odfiltrował po tej akcji:

```python
if not include_logins:
    query = query.where(AuditEvent.action != "auth.login")
```

Przy `action=auth.login` daje to `action = 'auth.login' AND action != 'auth.login'`, czyli zbiór pusty.

Zmierzone przy 221 wierszach `auth.login` w bazie:

| Żądanie | Wynik |
| --- | --- |
| `?action=auth.login&limit=5` | **0 wpisów** |
| `?action=auth.login&include_logins=true&limit=5` | 5 wpisów |
| `?q=Zalogowano&limit=5` | **0 wpisów** |
| `?actor=Marek&limit=50` | 23 wpisy, **w tym 0 logowań** |
| `?actor=Marek&include_logins=true&limit=50` | 50 wpisów, w tym 30 logowań |
| `?q=Marek&limit=50` | 42 wpisy, **w tym 0 logowań** |

Lista `AUDIT_ACTIONS` we froncie **zawiera `auth.login`** jako wybieralną opcję, więc administrator trafia w to naturalnie.
Po wybraniu tej opcji ekran pokazuje:

> Brak zdarzeń dla wybranego filtra
> Zmień filtr akcji albo wybierz „Wszystkie”, żeby zobaczyć pełny dziennik.

Podpowiedź jest nieprawdziwa: „Wszystkie” również ukrywa logowania.
Administrator badający incydent bezpieczeństwa dostanie zatem fałszywy dowód, że udane logowania nie są rejestrowane, podczas gdy są to najliczniejsze zdarzenia w tabeli.
Wyszukiwanie pełnotekstowe i filtr osoby milczą z tego samego powodu.
Tu jednak trzeba oddzielić dwie rzeczy.
Ukrywanie rutynowych logowań przy filtrze osoby i przy wyszukiwaniu jest obronne, bo taki był cel poprawki MED-09.
Defektem jest wyłącznie przypadek, w którym użytkownik **jawnie wybrał akcję `auth.login`** i dostaje sprzeczność, oraz stan pusty, który podpowiada nieistniejące rozwiązanie.

**Reprodukcja:** jako `admin` wejdź na `#audyt`, w polu „Akcja” wybierz `auth.login`, nie dotykaj przełącznika.

### NEW-02 Usunięcie konta kończy się błędem 500, jeśli konto kiedykolwiek uruchomiło generator

**Waga:** wysoka
**Obszar:** `models.py:ScheduleRun.requested_by_id`, `migrations/0016_schedule_runs.py`, `routes/admin.py:delete_user`
**Rola:** admin

Nowa tabela `schedule_runs` ma klucz obcy do `users` **bez reguły `ondelete`**:

```python
requested_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
```

```python
sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"]),
```

`delete_user` (poprawka MED-07) wykonuje `db.delete(user)` bez sprzątania powiązanych uruchomień, więc PostgreSQL odrzuca operację.

Zmierzone:

| Scenariusz | Wynik |
| --- | --- |
| Usunięcie konta, które nic nie robiło | **204** |
| Usunięcie konta po jednym `POST /scheduling/runs` | **500 Internal Server Error** |

W logach: `ForeignKeyViolationError: update or delete on table "users" violates foreign key constraint "schedule_runs_requested_by_id_fkey"`.

Znaczenie: generatora używają wyłącznie koordynatorzy i administratorzy, czyli dokładnie te konta, które w praktyce trzeba będzie kiedyś usunąć.
Ścieżka usuwania danych osobowych, dodana właśnie po to, żeby domknąć MED-07, jest dla nich niedostępna.
Do tego użytkownik dostaje surowy błąd 500 zamiast obsłużonego komunikatu, a okno potwierdzenia obiecało „trwałe usunięcie”.

**Reprodukcja:** `docs/qa-suite/t15_delete_after_run.py`.

### NEW-03 Nieudane obsadzenie slotu wygląda jak brak reakcji

**Waga:** średnia
**Obszar:** `components/CalendarMatrix.tsx`
**Rola:** coordinator, admin

Okno „Potwierdź obsadzenie slotu” otwiera się **nad** dialogiem dnia.
Gdy `POST /api/v1/calendar/override` zwróci błąd (na przykład 404 z HGH-02 dla dnia poza opublikowanym zakresem), komunikat renderuje się poprawnie, ale w dialogu dnia, który jest w tym momencie zasłonięty.

Zaobserwowane zachowanie: użytkownik klika „Obsadź”, potem „Obsadź” w potwierdzeniu, i **nic się nie dzieje**.
Okno potwierdzenia zostaje otwarte, przycisk wraca do stanu wyjściowego, żaden widoczny komunikat się nie pojawia.
Dopiero po zamknięciu potwierdzenia widać tekst „Nie znaleziono opublikowanego grafiku”.

Sprawdzone w DOM: `alerts` zawiera „Nie znaleziono opublikowanego grafiku”, a mimo to na ekranie widoczne jest wyłącznie okno potwierdzenia.
Oba okna mają w dodatku przycisk o tej samej etykiecie „Obsadź”, co utrudnia zorientowanie się, które z nich odpowiedziało.

### NEW-04 Filtry „Rola” i „Status” na ekranie osób są przycięte do jednej litery

**Waga:** średnia
**Obszar:** `screens/admin/People.tsx`
**Rola:** admin

Nowe pola filtrowania renderują się o szerokości **46 px** i pokazują „R…” oraz „S…” zamiast „Rola” i „Status”.
Zmierzone: pole wyszukiwania 262 px, oba selecty po 46 px przy oknie 1600 px.

Funkcja jest sprawna, ale nie da się odczytać, co filtruje.
Wygląda to jak błąd renderowania, a nie jak celowy kompaktowy układ.

Dowód: `docs/qa-shots-2/07-osoby.png`.

### NEW-05 Podgląd raportu miesięcznego nie pokazuje kolumn, które decydują o rozliczeniu

**Waga:** średnia
**Obszar:** `screens/admin/Reports.tsx`

Podgląd dodany w ramach MED-08 ma cztery kolumny: `Osoba`, `PRIMARY`, `SECONDARY`, `11–19`.
Pobierany CSV ma dwanaście kolumn, w tym rozbicie każdej roli na dni robocze, weekendy i święta.

Podgląd służy sprawdzeniu raportu przed wysłaniem go do kadr, a pokazuje wyłącznie sumy, które dla rozliczenia są najmniej istotne.
Koordynator nie zweryfikuje w aplikacji ani liczby weekendów, ani świąt, czyli dokładnie tego, co różnicuje wynagrodzenie.

Do tego tabela podglądu kończy się na 528 px przy oknie 1600 px, więc miejsca na brakujące kolumny jest aż nadto.

---

## 7. Wyniki testów wydajnościowych

Warunki identyczne jak w rundzie 1: 10 członków rotacji, 12 miesięcy historii, 12 równoczesnych sesji, `api` ograniczone do 2 rdzeni i 4 GB.

### 7.1 Ścieżki odczytu pod obciążeniem

| Scenariusz | p50 (r.1 → r.2) | p95 (r.1 → r.2) | max (r.2) |
| --- | --- | --- | --- |
| `GET /schedules/published` | 113 → **88 ms** | 198 → 216 ms | 303 ms |
| `GET /calendar` 30 dni | 123 → **99 ms** | 217 → 223 ms | 337 ms |
| `GET /calendar` 90 dni | 129 → **99 ms** | 222 → 229 ms | 353 ms |
| `GET /fairness` | 139 → 147 ms | 230 → 273 ms | 520 ms |
| `GET /team` | 94 → **52 ms** | 178 → 145 ms | 296 ms |
| `GET /swaps` | 104 → **73 ms** | 177 → 209 ms | 383 ms |

Przepustowość: **3419 żądań w 30 s (114 req/s)** wobec 2869 (96 req/s) w rundzie 1, przy zerze błędów w obu rundach.
Wzrost o 19% pochodzi z drugiego procesu uvicorn.
Mediany spadły, a p95 lekko wzrosło, co jest typowe dla dwóch procesów dzielących dwa rdzenie: więcej równoległości, ale i większa zmienność.

### 7.2 Raport miesięczny i bilans

| Pomiar | Runda 1 | Runda 2 |
| --- | --- | --- |
| `monthly.csv` 2026-08, średnia z 5 | 7 ms | 17 ms |
| `monthly.csv` 2025-12, średnia z 5 | 6 ms | 17 ms |
| 50 raportów sprawiedliwości przez 10 użytkowników, ścianowo | 1.74 s | **1.44 s** |
| Bilans, maksimum pod obciążeniem | 631 ms | 601 ms |

Raport miesięczny zwolnił z 7 do 17 ms, najpewniej przez odczyt zatwierdzonego kalendarza świąt z bazy zamiast z biblioteki.
W kategoriach bezwzględnych to nadal nieistotne i nie wymaga działania.

### 7.3 Logowanie (Argon2id)

| Pomiar | Runda 1 | Runda 2 |
| --- | --- | --- |
| 12 logowań po kolei, średnia | 76 ms | 125 ms |
| 12 logowań równocześnie, maksimum | 1.05 s | 1.84 s |

Pogorszenie wynika z dzielenia dwóch rdzeni między dwa procesy API.
Wartość nadal mieści się w rozsądnych granicach, ale przy większym zespole warto obserwować, bo koszt rośnie liniowo.

### 7.4 Generowanie grafiku

| Scenariusz | Runda 1 | Runda 2 |
| --- | --- | --- |
| 7 dni | nie mierzono | **2.52 s, OPTIMAL** |
| 91 dni, `api` = 2 rdzenie | 30.25 s, FEASIBLE | 30.25 s, FEASIBLE |
| Dwa generowania 61-dniowe równolegle | 60.1 s, **504 x2**, 2 szkice-widma | **30.19 s, 201 x2**, bez szkiców-widm |
| `GET /health` w trakcie generowania, maksimum | **30 065 ms** | **17 ms** |
| Generowanie asynchroniczne `POST /runs` | brak funkcji | **202 w 0.01 s**, worker startuje po ~1 s, wynik po 31 s |

To najważniejsza zmiana w całej rundzie.
Generowanie przestało być zdarzeniem, które unieruchamia zespół.

Ścieżka asynchroniczna zwraca `queued`, potem `running` z postępem 10, potem `completed` ze 100 i identyfikatorem szkicu.
Interfejs pokazuje pasek postępu oraz komunikat „Solver pracuje poza procesem API. Możesz korzystać z pozostałych ekranów.”
Postęp raportuje wyłącznie wartości 0, 10 i 100, więc pasek nie niesie informacji o zaawansowaniu; to drobiazg do dopracowania, nie defekt.

### 7.5 Wniosek sprzętowy

Rekomendacja z rundy 1 pozostaje aktualna i jest teraz osiągalna, bo solver można wypchnąć na workera przez `POST /runs`:

| Komponent | CPU | RAM |
| --- | --- | --- |
| `api` (uvicorn, 2 workery) | 1 rdzeń | 1 GB |
| `worker` + solver | 2 rdzenie | 2 GB |
| `db` (PostgreSQL 17) | 1 rdzeń | 2 GB |
| `web` (nginx) | 0.5 rdzenia | 256 MB |

Mieści się w docelowych 4 rdzeniach i 8 GB z zapasem.
Jeśli solver trafi w całości na workera, warto podnieść tam `num_search_workers` powyżej 1, co jest jedyną realną drogą do spełnienia kryterium 30 sekund z `PLAN.md` par. 8.

---

## 8. Plan naprawczy dla rundy 2

Zakres jest wyraźnie mniejszy niż poprzednio.

### Etap M1. Regresje po poprawkach, do pilnego zamknięcia

**M1.1 Filtr audytu.** (NEW-01)
Warunek ukrywający logowania nie może działać, gdy użytkownik **jawnie wybrał tę akcję**:

```python
if not include_logins and action != "auth.login":
    query = query.where(AuditEvent.action != "auth.login")
```

Świadomie **nie** rozszerzam wyjątku na `q` ani na `actor`.
Odwrotnie niż mogłoby się wydawać, wyłączenie ukrywania przy wyszukiwaniu wpuściłoby logowania z powrotem do każdego wyniku szukania i przywróciło dokładnie ten szum, który MED-09 usuwał; zmierzyłem, że przy `?q=Marek` doszłoby 23 wiersze logowań na 50.
Dla tych dwóch filtrów właściwą poprawką jest interfejs, nie zapytanie.

Dodatkowo we froncie: po wybraniu `auth.login` w polu „Akcja” automatycznie włączyć przełącznik albo go ukryć jako nieistotny, a przy aktywnym filtrze osoby lub wyszukiwaniu dopisać jedno zdanie, że rutynowe logowania są ukryte i jak je pokazać.
Tekst stanu pustego przestać kierować do opcji „Wszystkie”, która ukrywa to samo.

**M1.2 Klucz obcy `schedule_runs`.** (NEW-02)
Migracja zmieniająca ograniczenie na `ondelete="SET NULL"` z `requested_by_id` dopuszczającym `NULL`, żeby historia uruchomień przetrwała usunięcie konta.
Alternatywnie `ondelete="CASCADE"`, jeśli uruchomienia mają znikać razem z kontem.
Niezależnie od wyboru `delete_user` powinien łapać `IntegrityError` i zwracać 409 z czytelnym komunikatem zamiast 500.
Test regresyjny jest już gotowy: `docs/qa-suite/t15_delete_after_run.py`.

**M1.3 Widoczność błędu przy obsadzaniu slotu.** (NEW-03)
Błąd mutacji renderować w oknie potwierdzenia, które jest na wierzchu, a nie w dialogu pod spodem.
Okno potwierdzenia zamykać dopiero po sukcesie i rozróżnić etykiety obu przycisków, żeby „Obsadź” nie występowało dwa razy na jednym ekranie.

**M1.4 Szerokość filtrów na ekranie osób.** (NEW-04)
Nadać selektorom „Rola” i „Status” sensowną szerokość minimalną, na przykład `minWidth: 160`.

**M1.5 Kolumny podglądu raportu.** (NEW-05)
Podgląd musi mieć te same dwanaście kolumn co CSV, ewentualnie z możliwością zwinięcia rozbicia.
Miejsca jest aż nadto, bo tabela zajmuje dziś jedną trzecią szerokości okna.

### Etap M2. Domknięcie defektów naprawionych częściowo

**M2.1 Obsadzanie dnia poza opublikowanym zakresem.** (HGH-02)
Rozróżnić dwa rodzaje luki już w banerze: „brak obsady w opublikowanym grafiku” i „poza opublikowanym zakresem”.
Dla drugiego przypadku nie oferować przycisku „Obsadź”, tylko odesłać do generatora z wypełnionym zakresem dat.

**M2.2 Czas generowania.** (HGH-01)
Przenieść generowanie w całości na workera (interfejs korzysta już z `POST /runs`) i podnieść tam `num_search_workers`.
Rozważyć obniżenie `SOLVE_SECONDS` dla ścieżki synchronicznej i pozostawienie długiego budżetu wyłącznie ścieżce asynchronicznej.
Zaraportować w interfejsie, że wynik ma status `FEASIBLE`, a nie `OPTIMAL`, razem z jednym zdaniem, co to znaczy dla koordynatora.

**M2.3 Szczegóły dnia w dialogu.** (MED-03)
Dołożyć obsadę wszystkich trzech ról danego dnia, okno pokrycia i oznaczenie 2X lub święta.
Preselekcja zamiany jest już zrobiona i działa.

**M2.4 Ekran sprawiedliwości.** (MED-06)
Sortowanie po odchyleniu w każdej kategorii, wiersz sum, pełna szerokość tabeli.

**M2.5 Raport miesięczny.** (MED-08)
Ostrzeżenie, gdy wybrany miesiąc jest pokryty opublikowanym grafikiem tylko częściowo.
Dziś raport dla trwającego miesiąca wygląda tak samo jak raport miesiąca zamkniętego.

**M2.6 Karta osoby.** (MED-13)
Jeden przycisk zapisu na dialog z podsumowaniem zmian, ostrzeżenie przy zamknięciu z niezapisanymi zmianami, naprawa przycięcia ostatniego wiersza, przeniesienie linku „Usuń” do wiersza okresu eligibility.

### Etap M3. Drobne

- MED-01: „nie dotyczy w dzień wolny” zamiast „Brak przydziału” na karcie 11–19, w neutralnej stylizacji.
- MED-02: usunąć zdanie „Konto nie jest członkiem rotacji” dla ról, które mogą edytować macierz.
- MED-05: dodać `aria-hidden` na pustej odznace przy „Wymaga Twojej akcji”, tak jak zrobiono w nawigacji.
- LOW-02: informacja na ekranie logowania, do kogo zwrócić się po reset hasła.
- LOW-03: przełącznik „Pokaż odwołane” dla subskrypcji ICS, analogicznie do linków viewer.
- LOW-06: poprawić zdanie o prywatności notatki, bo administrator też ją widzi.
- Odmiana liczebnika w liście importów: „2 wiersze” zamiast „2 wierszy” dla wartości 2, 3 i 4.
- Postęp generowania: raportować wartości pośrednie zamiast wyłącznie 0, 10 i 100.

---

## 9. Co działa dobrze

Lista wskazuje, czego nie ruszać przy kolejnych poprawkach.

- **Reguły twarde solvera**, potwierdzone na grafiku 91-dniowym: pełne pokrycie 91 dni, primary zawsze różny od secondary, zero zmian 11–19 w dni wolne, twarda niedostępność uszanowana co do dnia, eligibility ról uszanowane. Doszedł **limit serii: maksimum 3 dni on-call pod rząd**, zmierzony na szkicu 14-dniowym.
- **Determinizm.** Dwa przebiegi z identycznym wejściem nadal dają identyczny grafik.
- **Tożsamość osoby jest teraz spójna w całej aplikacji.** Zmiana nazwiska nie psuje ani grafiku, ani bilansu, ani rozwinięcia, ani podglądu wpływu zamiany, ani zabezpieczenia przed podwójnym obsadzeniem. To była największa dziura projektowa rundy 1 i jest zamknięta u źródła, przez przejście na `member_id`.
- **Granularność blokady optymistycznej zamian.** Dwie zamiany w toku, override na innym dniu i zatwierdzanie po kolei działają bez wzajemnego unieważniania.
- **RBAC.** 65 na 65 przypadków macierzy uprawnień. Członek zespołu nie może zatwierdzić własnej zamiany ani zamiany, w której jest zastępcą (potwierdzone osobnym testem). Viewer nie widzi zespołu, punktów, zamian ani polityk.
- **Zarządzanie sesją.** CSRF na każdej mutacji, reset hasła kasuje sesje, dezaktywacja konta unieważnia sesję natychmiast, odwołanie linku viewer zabija sesję w tej samej sekundzie, link jednorazowy działa dokładnie raz.
- **Walidacja importu.** Cztery klasy naruszeń odrzucone, import odwracalny, endpoint listy importów.
- **Cykl życia członka rotacji.** Zamknięcie okresu rotacji przy istniejących dyżurach jest blokowane komunikatem, który wymienia konkretne kolidujące sloty.
- **Panel audytu.** Filtr osoby, wyszukiwanie, zakres dat, eksport CSV, rozwijane szczegóły i jawna strefa czasowa przy każdym znaczniku. Poza defektem NEW-01 jest to teraz użyteczne narzędzie.
- **Dostępność.** Zero naruszeń kontrastu w obu motywach. Roving tabindex utrzymany: 300 komórek, jeden przystanek Tab, 23 elementy fokusowalne na stronie. Odznaki „0” zniknęły z nawigacji.
- **Responsywność.** Przy 390 px brak przepełnienia poziomego.
- **Zero błędów w konsoli przeglądarki** na wszystkich odwiedzonych trasach.
- **Nowe funkcje z par. N4 rundy 1 dostarczone:** porównanie wariantu dziennego i tygodniowego, wersjonowany kalendarz świąt z zatwierdzaniem, generowanie asynchroniczne z paskiem postępu.
- **Preselekcja zamiany z macierzy.** Kliknięcie własnej komórki prowadzi do `#zamiany` z wypełnionym dyżurem, co realnie skraca ścieżkę wymaganą przez `PLAN.md` par. 7.

### Zmierzone, świadomie niezgłaszane

Na szkicu 14-dniowym rozkład dyżurów pozostaje nierówny: `Anna Kowalska` 12 dyżurów, `Magdalena Dąbrowska` 9, a `Aleksandra Wiśniewska` i `Rafał Woźniak` po 0.
To jest zamierzone nadrabianie długu historycznego opisane w `PLAN.md` par. 3, a ryzyko operacyjne zostało już ograniczone limitem serii (maksimum 3 dni pod rząd, zmierzone).
Notuję pomiar, żeby kolejna runda nie zgłaszała tego ponownie jako defektu.

---

## 10. Jak odtworzyć

Skrypty w `docs/qa-suite/`, zrzuty ekranu z tej rundy w `docs/qa-shots-2/`.

```bash
docker compose up -d --build
docker compose cp docs/qa-suite/seed_qa.py api:/tmp/seed_qa.py
docker compose exec api python /tmp/seed_qa.py
```

```bash
cd docs/qa-suite
P=../../backend/.venv/bin/python
$P t01_auth_rbac.py           # RBAC i sesje
$P t02_generator.py           # generator i workflow, ok. 2 min
$P t03_blocking.py            # BLK-01: brak zamrożenia API
$P t04_swaps.py               # cykl zamian
$P t05_fairness_reports.py    # bilans, CSV, zmiana nazwiska
$P t06_import_share_ics.py    # import, linki, ICS, audyt
$P t07_perf.py                # wydajność, ok. 4 min
$P t08_perf2.py               # BLK-02: równoległe generowania
$P t09_edge.py                # walidacja i przypadki brzegowe
$P t10_orphan.py              # BLK-04: dyżury przy wyjściu z rotacji
$P t11_deadlock.py            # BLK-03 scenariusz B
$P t12_rename_swaps.py        # HGH-03: zamiany po zmianie nazwiska
$P t13_rename_doublebook.py   # BLK-05: podwójne obsadzenie
$P t14_swap_swap.py           # BLK-03 scenariusz A
$P t15_delete_after_run.py    # NEW-02: usunięcie konta po generowaniu
```

Skrypty zmieniają dane i **nie są idempotentne**.
Między kolejnymi uruchomieniami tego samego skryptu wykonaj `docker compose exec api python /tmp/seed_qa.py`.

Warunki sprzętowe z rozdziału 7:

```bash
docker update --cpus=2   --memory=4g   --memory-swap=4g   oncall-api-1
docker update --cpus=1   --memory=2g   --memory-swap=2g   oncall-db-1
docker update --cpus=0.5 --memory=1g   --memory-swap=1g   oncall-worker-1
docker update --cpus=0.5 --memory=512m --memory-swap=512m oncall-web-1
docker compose up -d --force-recreate api worker web   # powrót do braku limitów
```

### Najkrótsze ścieżki ręczne dla nowych defektów

| Defekt | Kroki |
| --- | --- |
| NEW-01 | Jako `admin` wejdź na `#audyt`, w polu „Akcja” wybierz `auth.login`. Ekran mówi „Brak zdarzeń”, choć w bazie jest ich kilkaset. Włącz „Pokaż zwykłe logowania”, żeby się pojawiły. |
| NEW-02 | Jako `koord` uruchom generowanie. Jako `admin` w `#osoby` otwórz szczegóły `koord` i kliknij „Usuń konto i dane osobowe”, potwierdź. Błąd 500. |
| NEW-03 | Jako `koord` otwórz `?od=2026-10-01&do=2026-10-06`, kliknij komórkę w dniu oznaczonym `!` po końcu opublikowanego grafiku, kliknij „Obsadź”, potwierdź. Nic się nie dzieje, dopóki nie zamkniesz potwierdzenia. |
| NEW-04 | Jako `admin` otwórz `#osoby`. Obok pola wyszukiwania dwa pola o szerokości jednej litery. |
| NEW-05 | Jako `koord` otwórz `#raporty`, porównaj cztery kolumny podglądu z dwunastoma kolumnami pobranego CSV. |

---

## 11. Uwagi metodyczne

- Wyniki wydajnościowe pochodzą z hosta, na którym działał także generator obciążenia, dokładnie jak w rundzie 1. Porównania między rundami są więc wiarygodne, bo warunki się nie zmieniły.
- Zestaw regresyjny nie jest idempotentny: powtórne uruchomienie `t04_swaps.py` bez zasiania danych daje fałszywe niepowodzenia, bo zamiany z poprzedniego przebiegu są już zatwierdzone. Odnotowałem to zamiast zgłaszać jako defekty aplikacji.
- Jedno takie fałszywe niepowodzenie sprawdziłem osobno, bo wyglądało groźnie: „członek zespołu zatwierdził zamianę”. Okazało się, że losowo wybranym zastępcą była `anna`, która w danych testowych jest koordynatorem. Osobny test na koncie wyłącznie członkowskim potwierdza 403 zarówno dla zastępcy, jak i dla autora prośby.
- `docs/SOLVER.md` został zaktualizowany razem z kodem. Nie zgłaszam jako defektów rzeczy, które ten dokument opisuje jako świadome ograniczenia, chyba że zmierzony skutek jest istotnie większy niż opis.
- Testy jednostkowe backendu i frontendu nie były uruchamiane. Raport opiera się na czarnej skrzynce przez HTTP i przeglądarkę, uzupełnionej czytaniem kodu przy ustalaniu przyczyn.
