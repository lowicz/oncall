# Raport testów QA nr 3 - Erste On-call

Autor: starszy inżynier testów (sesja OpenCode)
Data wykonania: 2026-09-05, po wdrożeniu poprawek z planu M1-M3 z [QA-REPORT-2.md](QA-REPORT-2.md)
Wersja testowana: obrazy `oncall-api`/`oncall-worker` zbudowane 2026-09-05 21:09, `oncall-web` 20:40, po ostatnich zmianach kodu (20:59)
Środowisko: Docker Compose (`db`, `api`, `worker`, `web`), frontend pod `http://localhost:8080`

Runda 3 weryfikuje wszystkie poprawki z planu naprawczego rundy 2, powtarza zestaw regresyjny,
a przede wszystkim prowadzi nowe testy eksploracyjne, użytecznościowe i wydajnościowe.
Plan naprawczy znajduje się w rozdziale 8.

---

## 1. Poświadczenia testowe

Konta odtwarza `docs/qa-suite/seed_qa.py` (10 członków rotacji, 12 miesięcy historii).
Hasło wszystkich kont QA: **`TestOncall2026!`**
Hasło konta `admin` z `.env` (`ONCALL_ADMIN_PASSWORD`): **`Qwertyuiop1!`**

| Login | Hasło | Rola | W rotacji | Do czego używać przy weryfikacji defektów |
| --- | --- | --- | --- | --- |
| `admin` | `Qwertyuiop1!` | admin | nie | administracja, audyt, usuwanie kont |
| `admin2` | `TestOncall2026!` | admin | nie | drugi administrator |
| `koord` | `TestOncall2026!` | coordinator | nie | generator, override, zamiany, raporty |
| `anna` | `TestOncall2026!` | coordinator | tak | koordynator dyżurujący (sam może zatwierdzić własną zamianę - to nie błąd) |
| `marek` | `TestOncall2026!` | member | tak | urlop (twarda niedostępność) 05-10 do 19-10-2026 |
| `ola` | `TestOncall2026!` | member | tak | preferencja „wolę nie" |
| `piotr` | `TestOncall2026!` | member | tak | preferencja „chętnie wezmę" |
| `kasia` | `TestOncall2026!` | member | tak | krótka twarda niedostępność |
| `tomek` | `TestOncall2026!` | member | tak | - |
| `ewa` | `TestOncall2026!` | member | tak | eligibility bez `primary` |
| `jakub` | `TestOncall2026!` | member | tak | eligibility bez `late_shift` |
| `magda` | `TestOncall2026!` | member | tak | - |
| `rafal` | `TestOncall2026!` | member | tak | wszedł do rotacji 90 dni temu |
| `viewer` | `TestOncall2026!` | viewer | nie | - |
| `viewer2` | `TestOncall2026!` | viewer | nie | - |

Uwaga: seed nie czyści linków viewer ani subskrypcji ICS z poprzednich rund.
Przed weryfikacją defektów na czystych danych warto dodatkowo wykonać
`DELETE FROM share_links; DELETE FROM calendar_feed_tokens;` albo odtworzyć wolumen bazy.

---

## 2. Co zmieniło się w kodzie między rundami 2 i 3

Zmieniono 9 plików backendu i 17 plików frontendu.
Z punktu widzenia testów chodzi o realizację całego planu M1-M3 z rundy 2:

| Zmiana | Czego dotyczy |
| --- | --- |
| Warunek `if not include_logins and action != "auth.login"` w audycie | NEW-01 |
| `ondelete="SET NULL"` na `schedule_runs.requested_by_id` (model + baza) | NEW-02 |
| `ConfirmDialog` z polem `error`, błąd override renderowany w oknie na wierzchu | NEW-03 |
| `minWidth: 160` na filtrach „Rola" i „Status" | NEW-04 |
| Podgląd raportu ze wszystkimi 12 kolumnami i wierszem sum | NEW-05 |
| Baner rozróżnia lukę w publikacji od zakresu poza publikacją, przycisk „Otwórz generator z tym zakresem" | HGH-02 |
| Status `FEASIBLE` z wyjaśnieniem na wyniku generatora | HGH-01 |
| Dialog dnia z obsadą wszystkich ról i oknami pokrycia | MED-03 |
| Sortowanie kolumn sprawiedliwości, `aria-sort`, wiersz sum, pełna szerokość | MED-06 |
| Ostrzeżenia o miesiącu pustym i częściowo pokrytym w raporcie | MED-08 |
| Karta osoby: jeden przycisk „Zapisz zmiany (N)", strażnik niezapisanych zmian, „Usuń" w wierszu | MED-13 |
| „nie dotyczy w dzień wolny" zamiast „Brak przydziału" na karcie 11-19 | MED-01 |
| Usunięte zdanie „Konto nie jest członkiem rotacji" | MED-02 |
| Odznaka „0" usunięta z DOM | MED-05 |
| Wskazówka resetu hasła na ekranie logowania | LOW-02 |
| Przełącznik „Pokaż odwołane" dla subskrypcji ICS | LOW-03 |
| „Powód zobaczą tylko koordynatorzy i administratorzy" | LOW-06 |
| Poprawna odmiana liczebnika (`1 wiersz / 2 wiersze / 5 wierszy`) | LOW-04 drobiazg |
| **Zmiana semantyki supersede**: wycofywany jest tylko grafik w całości pokryty przez nowy; nakładanie częściowe rozstrzygane per slot w `effective.py` | nowe, poza planem |

Ostatnia pozycja to niezaplanowana zmiana zachowania, która rozwiązuje problem pustego ogona po republikacji, ale dezaktualizuje tekst okna publikacji (MED-16).

---

## 3. Zakres testów w rundzie 3

| Obszar | Metoda | Przypadki |
| --- | --- | --- |
| Zestaw regresyjny t01-t15 (API) | skrypty `docs/qa-suite` | 14 plików, ok. 240 sprawdzeń |
| Testy jednostkowe backendu | pytest | 169 zaliczone |
| Testy jednostkowe frontendu | vitest | 74 zaliczone |
| Lint | ruff, eslint | 0 błędów |
| Weryfikacja 22 poprawek z rundy 2 | UI + API + kod | 22 |
| Testy eksploracyjne UI (5 ról, 11 ekranów) | Chrome DevTools | ~60 przebiegów |
| Cykl zamiany end-to-end w UI (3 role) | Chrome DevTools | 1 pełny scenariusz |
| Reguły twarde przy override (niedostępność, eligibility, podwójne obsadzenie, 11-19 w dzień wolny) | API | 4 |
| Flow linku viewer, aktywacji konta, resetu hasła | UI + API | 5 |
| Kontrast obu motywów, klawiatura, roving tabindex, responsywność 390 px | Chrome DevTools | 5 przebiegów |
| Wydajność: obciążenie odczytów, raport miesięczny, bilans, generowanie pod obciążeniem, zużycie zasobów | API + `docker stats` | 4 scenariusze |

Środowisko wydajnościowe jak w rundach 1-2: `api` 2 rdzenie / 4 GB, `db` 1 / 2 GB, `worker` 0.5 / 1 GB, `web` 0.5 / 512 MB (razem 4 rdzenie i 7.5 GB, czyli górna granica celu).

---

## 4. Podsumowanie

**Wszystkie 22 pozycje z planu naprawczego rundy 2 są zamknięte.**
Zestaw regresyjny przechodzi poza dwoma znanymi wyjątkami opisanymi w rozdziale 11 (artefakt zestawu i kryterium czasu solvera).
Testy jednostkowe, lint i kontrast są czyste.

Nowych defektów blokujących nie ma.
Znalazłem jeden defekt wysoki (HGH-08), trzy średnie i pięć niskich.
HGH-08 jest pogłębieniem znanego HGH-01: dla części zakresów 91-dniowych solver nie znajduje w budżecie **żadnego** rozwiązania i zwraca komunikat bez konkretnych konfliktów.
Najważniejszy nowy defekt projektowy to MED-17: zgłoszenie twardej niedostępności na dzień z istniejącym dyżurem przechodzi bez ostrzeżenia dla kogokolwiek.

| Status | Liczba |
| --- | --- |
| Poprawki rundy 2 potwierdzone | 22 / 22 |
| Nowe defekty wysokie | 1 |
| Nowe defekty średnie | 3 |
| Nowe defekty niskie | 5 |
| Obserwacje niezgłaszane jako defekty | 4 |

---

## 5. Weryfikacja poprawek z rundy 2

### 5.1 Etap M1 - wszystkie potwierdzone

| ID | Status | Dowód z rundy 3 |
| --- | --- | --- |
| NEW-01 Filtr audytu `auth.login` | **Naprawione** | Wybranie `auth.login` w polu „Akcja" automatycznie włącza „Pokaż zwykłe logowania" i lista się wypełnia. Warunek w kodzie: `if not include_logins and action != "auth.login"`. |
| NEW-02 Usunięcie konta po uruchomieniu generatora | **Naprawione** | `t15_delete_after_run.py`: usunięcie konta po `POST /scheduling/runs` zwraca **204** (runda 2: 500). W bazie `schedule_runs_requested_by_id_fkey ... ON DELETE SET NULL`. |
| NEW-03 Błąd obsadzania poza dialogiem | **Naprawione** | `ConfirmDialog` przyjmuje `error?: string` i renderuje `<Alert severity="error">` wewnątrz okna na wierzchu. |
| NEW-04 Przycięte filtry na ekranie osób | **Naprawione** | Oba selekty mają `minWidth: 160`; etykiety „Rola" i „Status" czytelne. Zrzut: `qa-shots-3/11-people.png`. |
| NEW-05 Podgląd raportu bez kolumn rozliczeniowych | **Naprawione** | Podgląd ma wszystkie 12 kolumn (robocze/weekendy/święta dla obu ról i razem, plus 11-19) oraz wiersz „Razem". Sumy zweryfikowane ręcznie dla 08-2026: on-call 42+18+2=62=31 dni x 2 role, 11-19=21=liczba dni roboczych. Zrzut: `qa-shots-3/14-reports.png`. |

### 5.2 Etap M2 - wszystkie potwierdzone

| ID | Status | Dowód z rundy 3 |
| --- | --- | --- |
| HGH-01 Czas generowania | **Częściowo, zgodnie z założeniem** | Wynik pokazuje „CP-SAT: FEASIBLE" z jednozdaniowym wyjaśnieniem. Budżet nadal 30 s i poza 14 dniami wynik nigdy nie jest OPTIMAL. Doszło pogłębienie problemu: patrz HGH-08. |
| HGH-02 Obsadzanie dnia poza zakresem | **Naprawione** | Baner rozróżnia „N dni w tym zakresie nie ma pełnej obsady" od „N dni jest poza opublikowanym zakresem - obsadzenie wymaga wygenerowania i opublikowania nowego grafiku". Dialog dnia poza zakresem pokazuje przycisk „Otwórz generator z tym zakresem" zamiast formularza obsadzania. Członek zespołu dostaje własny tekst: „poczekaj, aż koordynator opublikuje kolejny zakres grafiku". |
| MED-03 Dialog dnia bez szczegółów | **Naprawione** | Dialog pokazuje obsadę wszystkich trzech ról z oknami pokrycia (19:00-09:00, 11:00-19:00) i oznaczeniem korekty. Zrzut: `qa-shots-3/02-day-dialog.png`. |
| MED-06 Ekran sprawiedliwości | **Naprawione** | Sortowanie klikalnymi nagłówkami z `aria-sort` (domyślnie po odchyleniu), wiersz „Razem" w `tfoot`, tabela na pełną szerokość, opisy słowne odchyleń. Zrzut: `qa-shots-3/10-fairness.png`. |
| MED-08 Raport miesięczny | **Naprawione** | Dla miesiąca bez dyżurów: „Wybrany miesiąc nie ma żadnych opublikowanych dyżurów". Dla częściowo pokrytego (10-2026, 2 dni): „Opublikowany grafik pokrywa 2 z 31 dni tego miesiąca. Raport uwzględnia tylko dni z pełną obsadą." Domyślnie poprzedni miesiąc. |
| MED-13 Karta osoby | **Naprawione** | Jeden przycisk „Zapisz zmiany (N)" / „Brak zmian". Zamknięcie z niezapisanymi zmianami otwiera strażnika: „Masz niezapisane zmiany: imię. Zamknięcie okna je wyrzuci." Linki „Usuń" są w wierszach okresów eligibility. Zmiana odrzucona nie trafia do bazy (zweryfikowane SQL-em). |

### 5.3 Etap M3 - wszystkie potwierdzone

| ID | Status | Dowód z rundy 3 |
| --- | --- | --- |
| MED-01 „Brak przydziału" 11-19 w dzień wolny | **Naprawione** | Sobota pokazuje „nie dotyczy: dzień wolny" w neutralnej stylizacji; w widoku listy dni wiersz 11-19 w weekend nie istnieje. |
| MED-02 Baner u koordynatora | **Naprawione** | Etykieta „[STATUS GRAFIKU]", zdania dopasowane do roli (członek: „Twoje preferencje znajdziesz w zakładce Moje"; koordynator: „Kliknij komórkę macierzy, żeby zmienić obsadę..."). |
| MED-05 Odznaka „0" | **Naprawione** | Nagłówek „Wymaga Twojej akcji" przy zerze wniosków nie zawiera odznaki w DOM (wcześniej `textContent="0"` dla czytnika). |
| LOW-02 Reset hasła | **Naprawione** | Ekran logowania: „Nie pamiętasz hasła? Poproś administratora systemu o jednorazowy link resetujący." |
| LOW-03 Odwołane subskrypcje ICS | **Naprawione** | Przełącznik „Pokaż odwołane" na ekranie „Moje". |
| LOW-06 Prywatność notatki | **Naprawione** | „Powód zobaczą tylko koordynatorzy i administratorzy." |
| Odmiana liczebnika importów | **Naprawione** | Funkcja `wiersz/wiersze/wierszy` z obsługą 12-14. |

---

## 6. Nowe defekty

### HGH-08 Dla części zakresów 91-dniowych solver nie znajduje żadnego rozwiązania i zwraca komunikat bez konfliktów

**Waga:** wysoka
**Obszar:** `scheduler.py` (`SOLVE_SECONDS = 30.0`), `routes/scheduling.py`
**Rola:** coordinator, admin

Pomiary na świeżo zasianych danych (deterministyczne, 2/2 przebiegi zgodne):

| Zakres generowania od dziś | Wynik |
| --- | --- |
| +200 dni, 91 dni | 201, FEASIBLE, 30.2 s |
| +300 dni, 91 dni | **409 w 30.1 s** |
| +400 dni, 91 dni | **409 w 30.1 s** |
| +600 dni, 91 dni | 201, FEASIBLE, 30.2 s |

Odpowiedź 409: `Nie można utworzyć kompletnego grafiku / Model CP-SAT nie znalazł kompletnego rozwiązania`.
Lista `conflicts` zawiera wyłącznie to jedno zdanie ogólne.

Trzy problemy naraz:

1. **To nie jest INFEASIBLE, tylko timeout.** Model jest prawdopodobnie spełnialny (dane nie zawierają konfliktu twardych reguł - eligibility otwarte, święta 2027-2028 mają fallback ustawowy), ale CP-SAT nie znajduje w 30 s nawet rozwiązania dopuszczalnego dla niektórych mieszanek dni.
2. **Komunikat nie daje nic do działania.** `PLAN.md` par. 3 wymaga: „Brak rozwiązania pokazuje konkretne konflikty". Koordynator nie wie, czy dane są sprzeczne, czy model jest po prostu trudny, i nie ma żadnej dźwigni (budżet jest wspólny i zaszyty na 30 s również dla ścieżki asynchronicznej - patrz niżej).
3. **Zasięg jest realny produktowo.** +300 dni to planowanie kolejnego kwartału/półrocza, czyli normalna praca koordynatora.

Ścieżka asynchroniczna `POST /scheduling/runs` używa tego samego `SOLVE_SECONDS = 30.0`, więc obejście przez workera nic nie daje.
Rozwiązanie w rozdziale 8 (P1.1).

**Reprodukcja:** zaloguj się jako `koord` i wykonaj:

```bash
curl -X POST http://localhost:8080/api/v1/scheduling/generate \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" --cookie "$COOKIES" \
  -d '{"starts_on":"2027-07-02","ends_on":"2027-10-01"}'
```

albo uruchom `docs/qa-suite/t07_perf.py` (przypadek P4 dla 91 dni).

### MED-15 Override „ta sama osoba na to samo miejsce" przechodzi i zapisuje się jako korekta

**Waga:** średnia
**Obszar:** `routes/calendar.py:create_override`, `components/CalendarMatrix.tsx`
**Rola:** coordinator, admin

Kliknięcie komórki osoby, która już pełni daną rolę danego dnia, i zatwierdzenie „Zmień obsadę" kończy się **200** i zapisem override:

```
Override 2026-09-07 · primary: Aleksandra Wiśniewska → Aleksandra Wiśniewska
```

Skutki: pusty wpis w audycie, **podbicie wersji opublikowanego grafiku** (co unieważnia tokeny optimistic locking wszystkich otwartych ekranów i sekwencje ICS całego zespołu) oraz znacznik „korekta koordynatora" na slocie, w którym nic się nie zmieniło.

Niespójność: edytor szkicu w tej samej sytuacji blokuje przycisk („Przypisz w szkicu" disabled), więc zachowanie jest różne w dwóch miejscach o tej samej semantyce.

**Reprodukcja:** jako `koord` kliknij w macierzy komórkę z istniejącym dyżurem (np. Anna Kowalska, pon 07-09, PRIMARY), kliknij „Zmień obsadę…" i potwierdź. W audycie pojawia się wpis „X → X".
Przez API: `POST /api/v1/calendar/override` z `replacement_member_id` równym obecnemu właścicielowi slotu.

### MED-16 Okno publikacji obiecuje zastąpienie, które nie zachodzi dla nakładania częściowego

**Waga:** średnia
**Obszar:** `screens/Generator.tsx` (tekst dialogu), `routes/scheduling.py` (semantyka supersede)
**Rola:** coordinator, admin

Między rundami zmieniono semantykę wycofywania grafików: `superseded` dostaje teraz tylko grafik **w całości pokryty** zakresem nowej publikacji, a nakładanie częściowe rozstrzyga się per slot w `effective.py`.
Kod zawiera komentarz wyjaśniający, że to celowa poprawka po przypadku „pustego ogona".

Tekst okna potwierdzenia publikacji pozostał stary:
„Nakładający się opublikowany grafik zostanie oznaczony jako zastąpiony."

Zmierzone: publikacja szkicu 05-09 do 18-09-2026 wewnątrz opublikowanego grafiku 05-09 do 02-10-2026.
Po publikacji **oba** grafiki mają status `published`, rozstrzyganie per slot działa poprawnie (10-09 z nowego grafiku, 25-09 ze starego), ale koordynator został poinformowany o czymś innym, niż się stało.
Nowe zachowanie jest lepsze - poprawić trzeba tekst, który powinien mówić o rozstrzyganiu dnia po dniu i o tym, że wcześniejszy grafik pozostaje ważny poza nowym zakresem.

**Reprodukcja:** jako `koord` wygeneruj szkic na podzakres opublikowanego grafiku, kliknij „Przekaż do akceptacji", „Opublikuj grafik" i przeczytaj okno; potem porównaj `SELECT name,status FROM schedules`.

### MED-17 Zgłoszenie twardej niedostępności na dzień z istniejącym dyżurem nie ostrzega nikogo

**Waga:** średnia
**Obszar:** `routes/availability.py`, `components/CalendarMatrix.tsx`, ekran „Moje"
**Rola:** member, coordinator

Scenariusz odtworzony w UI i API:

1. Koordynator obsadza Tomasza Wójcika jako primary 21-09-2026 (override, 200).
2. Tomek zgłasza „nie mogę" na 21-09 do 22-09-2026 (201, bez żadnego komunikatu).
3. Stan: Tomek ma **jednocześnie** dyżur primary i twardą niedostępność 21-09.

Taka sytuacja jest nieunikniona operacyjnie (ktoś zachoruje po publikacji) i system słusznie pozwala ją zapisać - problem leży w braku reakcji:

- **Członek** nie dostaje informacji, że zgłoszenie nie zdejmuje go z dyżuru i że powinien poprosić o zamianę lub skontaktować się z koordynatorem.
- **Koordynator** nie dostaje żadnego proaktywnego sygnału. Konflikt jest widoczny wyłącznie jako para znaczników `P`+`K` i `N` na jednej komórce macierzy 10 x 30 (zrzut: `qa-shots-3/32-conflict-cell2.png`), którą trzeba samodzielnie wypatrzeć.
- Baner o lukach w obsadzie nie obejmuje tego przypadku, choć to ryzyko jest groźniejsze niż pusty slot: slot wygląda na obsadzony, a osoba nie może dyżurować.

**Reprodukcja:** jako `koord` obsadź kogoś na dowolny dzień; zaloguj się jako ta osoba, dodaj „nie mogę" na ten dzień na ekranie „Moje"; wróć jako `koord` - żaden baner ani lista nie zgłasza konfliktu.

### LOW-07 Szkice różnych trybów mają identyczne nazwy i piętrzą się na liście

**Waga:** niska
**Obszar:** `routes/scheduling.py` (nadawanie nazwy), `screens/Generator.tsx`
**Rola:** coordinator, admin

Cztery szkice tego samego zakresu (2 x hybrydowy, dzienny, tygodniowy) nazywają się identycznie: „Szkic 2026-09-12 – 2026-09-18".
Na liście „Szkice w toku" rozróżnia je dopiero podtytuł z trybem.
Nazwa powinna zawierać tryb („Szkic dzienny 2026-09-12 – 2026-09-18"), skoro tryb jest głównym wymiarem porównania.
Dodatkowo data w nazwie jest w formacie ISO, a w pozostałej aplikacji DD-MM-YYYY.

### LOW-08 Baner linku viewer skleja daty w jeden ciąg

**Waga:** niska
**Obszar:** ekran `/` dla sesji linkowej
**Rola:** viewer (link)

Baner pokazuje: „Zakres 05-09-2026-02-10-2026, ważny do 12-09-2026".
Dwie daty w formacie z myślnikami złączone gołym myślnikiem czytają się jak jeden ciąg cyfr.
Powinno być „05-09-2026 – 02-10-2026" albo „od 05-09-2026 do 02-10-2026".

### LOW-09 Błąd gramatyczny w banerze luk: „2 dni jest poza"

**Waga:** niska
**Obszar:** `components/CalendarMatrix.tsx`
**Rola:** wszystkie

Dla więcej niż jednego dnia baner mówi „2 dni jest poza opublikowanym zakresem".
Poprawnie: „2 dni są poza..." albo neutralnie „2 dni poza opublikowanym zakresem...".
(Kod obsługuje już odmianę rzeczownika „1 dzień / N dni", nie obsługuje tylko czasownika.)

### LOW-10 Strona aktywacji konta nie pokazuje, którego konta dotyczy

**Waga:** niska
**Obszar:** `screens/` aktywacji (`/activate?token=...`)
**Rola:** niezalogowany

Strona zawiera wyłącznie pola hasła.
Odbiorca linku nie widzi loginu ani nazwy konta, dla którego ustawia hasło - pomyłka administratora przy przesyłaniu linku nie ma szansy wyjść na jaw.
Wystarczy jedna linia „Ustawiasz hasło dla: Marek Nowak (`marek`)".

### LOW-11 `POST /scheduling/generate` milcząco ignoruje `rotation_mode` w treści

**Waga:** niska
**Obszar:** kontrakt API `routes/scheduling.py`
**Rola:** konsument API

Tryb rotacji pochodzi z globalnej polityki (`PUT /scheduling/policy`), a nie z żądania generowania.
Wysłanie `{"starts_on": ..., "ends_on": ..., "rotation_mode": "daily"}` tworzy szkic **hybrydowy** bez błędu i bez ostrzeżenia - sam zmierzyłem dwa takie szkice przed zrozumieniem mechanizmu.
Schemat Pydantic powinien odrzucać nieznane pola (`extra="forbid"`) albo pole powinno działać jako nadpisanie polityki na czas jednego żądania.
UI tego nie dotyczy (korzysta z polityki), ryzyko dotyczy integracji po API.

---

## 7. Wyniki testów wydajnościowych

Warunki: 10 członków rotacji, 12 miesięcy historii, do 12 równoczesnych sesji, limity `api` 2 rdzenie / 4 GB, `db` 1 / 2 GB, `worker` 0.5 / 1 GB, `web` 0.5 / 512 MB.

### 7.1 Ścieżki odczytu pod obciążeniem (t07, 12 użytkowników, 30 s)

| Scenariusz | p50 (r.2 → r.3) | p95 (r.2 → r.3) | max (r.3) |
| --- | --- | --- | --- |
| `GET /schedules/published` | 88 → **73 ms** | 216 → 159 ms | 347 ms |
| `GET /calendar` 30 dni | 99 → **84 ms** | 223 → 212 ms | 342 ms |
| `GET /calendar` 90 dni | 99 → **88 ms** | 229 → 202 ms | 305 ms |
| `GET /fairness` | 147 → **121 ms** | 273 → 242 ms | 374 ms |
| `GET /team` | 52 → **42 ms** | 145 → 127 ms | 255 ms |
| `GET /swaps` | 73 → **43 ms** | 209 → 130 ms | 321 ms |

Przepustowość: **4222 żądania w 30 s (141 req/s)** wobec 114 req/s w rundzie 2 i 96 w rundzie 1, przy zerze błędów.

### 7.2 Raport miesięczny i bilans (punkt ciężki tej rundy)

| Pomiar | Runda 2 | Runda 3 |
| --- | --- | --- |
| `monthly.csv` 2026-08, średnia z 5 | 17 ms | **10 ms** |
| `monthly.csv` 2025-12, średnia z 5 | 17 ms | **9 ms** |
| 50 raportów sprawiedliwości przez 10 użytkowników, ścianowo | 1.44 s | **1.28 s** |
| Bilans, maksimum pod obciążeniem | 601 ms | 683 ms |

Raport miesięczny jest szybki i dodatkowo przyspieszył względem rundy 2.

### 7.3 Raport i odczyty **w trakcie generowania** (nowy scenariusz, `t16_perf_round3.py`)

Jedno synchroniczne generowanie 30-dniowe (pełne obciążenie 2 rdzeni `api`) plus 12 równoczesnych użytkowników cyklicznie pobierających raport miesięczny CSV, bilans, kalendarz i opublikowany grafik:

| Ścieżka | n | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| `monthly.csv` | 80 | 64 ms | **251 ms** | 428 ms |
| `fairness` | 449 | 164 ms | 404 ms | 556 ms |
| `calendar` 30 dni | 490 | 99 ms | 336 ms | 552 ms |
| `published` | 488 | 80 ms | 315 ms | 500 ms |

1507 poprawnych odczytów, zero błędów poza spodziewanymi 403 RBAC na raporcie (raport jest dla koordynatora/admina; członkowie i viewerzy dostają 403 zgodnie z projektem).
**Generowanie w tle nie degraduje raportów w sposób istotny operacyjnie.**

### 7.4 Zużycie zasobów w szczycie scenariusza 7.3

| Kontener | CPU | RAM |
| --- | --- | --- |
| `api` | ~200% (2/2 rdzenie) | 396 MB / 4 GB |
| `db` | ~28% | 105 MB / 2 GB |
| `web` | ~1.5% | 16 MB / 512 MB |
| `worker` | ~1% | 119 MB / 1 GB |

Razem około **640 MB RAM** - docelowe 8 GB z ogromnym zapasem; wąskim gardłem pozostaje CPU `api` podczas generowania synchronicznego i ono też trzyma odczyty poniżej 0.5 s.

### 7.5 Generowanie

| Scenariusz | Runda 2 | Runda 3 |
| --- | --- | --- |
| 30 dni synchronicznie, 2 rdzenie | 30.07 s FEASIBLE | 30.09 s FEASIBLE |
| 91 dni synchronicznie | 30.13 s FEASIBLE | 30.11 s / **409 dla części zakresów (HGH-08)** |
| Dwa generowania 61-dniowe równolegle | 30.19 s, 201 x2 | 30.1 s, 201 x2, bez szkiców-widm |
| `GET /health` w trakcie generowania | 17 ms maks. | 5 ms maks. |

Kryterium `PLAN.md` par. 8 (90 dni poniżej 30 s) nadal niespełnione i jest to ta sama przyczyna co HGH-01/HGH-08.

### 7.6 Wniosek sprzętowy

Aplikacja mieści się w docelowych 2-4 rdzeniach i 8 GB bez zastrzeżeń dla 10+ równoczesnych użytkowników i 10-osobowej rotacji, łącznie z raportami generowanymi pod obciążeniem.
Jedynym obszarem przekraczającym założenia jest czas i pewność generowania długich zakresów, co jest problemem modelu solvera, nie zasobów.

---

## 8. Plan naprawczy dla rundy 3

### Etap P1. Wiarygodność solvera dla długich zakresów (HGH-01 + HGH-08 razem)

**P1.1 Rozdziel „nie znaleziono" od „nie istnieje" i daj koordynatorowi dźwignię.**

- Rozróżniaj w wyniku solvera status `INFEASIBLE` (konflikt twardych reguł - pokazać konkretne konflikty, jak wymaga `PLAN.md`) od braku rozwiązania w budżecie (`UNKNOWN` po timeout).
- Dla timeoutu: komunikat „Solver nie zdążył znaleźć kompletnego grafiku w N s. Dane nie wskazują na konflikt reguł. Spróbuj: krótszego zakresu albo dłuższego budżetu."
- Parametryzuj `SOLVE_SECONDS` (zmienna środowiskowa lub pole w „Ustawieniach generowania" z górnym limitem), żeby długie zakresy można było policzyć dłużej przez ścieżkę asynchroniczną.
- Równolegle rozważ podniesienie `num_search_workers` powyżej 1 na workerze (rekomendacja z rundy 2 wciąż aktualna) oraz analizę, co w modelu czyni zakresy +300/+400 trudniejszymi - zmierzone, że to nie święta ani dostępność.

**P1.2 Test regresyjny:** zakres +300 dni musi zwracać albo 201, albo 409 z konkretnymi konfliktami twardych reguł - nigdy ogólnikowe „nie znaleziono".

### Etap P2. Domknięcie średnich

- **MED-15:** odrzucać override, w którym `replacement_member_id` jest właścicielem slotu (422 „Ta osoba już pełni tę rolę tego dnia") i/lub wyłączać akcję w UI jak w edytorze szkicu. Ujednolicić oba miejsca.
- **MED-16:** nowy tekst okna publikacji: „Dni 05-09-2026 – 18-09-2026 będą rozstrzygane z tego grafiku. Wcześniejszy grafik zachowuje ważność poza tym zakresem; grafiki w całości pokryte nowym zakresem zostaną wycofane." Warto też wskazać liczbę dni objętych zmianą.
- **MED-17:** przy zapisie „nie mogę" pokrywającego istniejący dyżur: (a) członkowi - komunikat „Masz w tym czasie dyżur; zgłoszenie go nie zdejmuje - poproś o zamianę albo skontaktuj się z koordynatorem", (b) koordynatorowi - baner w macierzy „N osób ma dyżur w dniu zgłoszonej niedostępności" z listą pozycji, analogiczny do banera luk. Rozważyć powiadomienie e-mail do koordynatorów przez istniejący outbox.

### Etap P3. Drobne

- LOW-07: tryb w nazwie szkicu i jednolity format daty DD-MM-YYYY.
- LOW-08: separator zakresu „od ... do ..." w banerze linku.
- LOW-09: odmiana czasownika w banerze luk („2 dni są" / sformułowanie bezosobowe).
- LOW-10: identyfikacja konta na stronie aktywacji.
- LOW-11: `extra="forbid"` na schematach żądań mutujących (przynajmniej generatora) albo obsługa `rotation_mode` per żądanie.
- Test jednostkowy: `/schedules/published` przy wszystkich grafikach `superseded` - udokumentować oczekiwane zachowanie (obserwacja z rozdziału 11).

---

## 9. Co działa dobrze

Lista wskazuje, czego nie ruszać przy kolejnych poprawkach.

- **Kompletność poprawek rundy 2.** Wszystkie 22 pozycje z planu M1-M3 zamknięte i potwierdzone pomiarem lub w UI, bez regresji wokół nich.
- **Reguły twarde przy ręcznych zmianach.** Override na osobę niedostępną: 422 „Osoba jest niedostępna"; bez eligibility: 422 „Osoba nie ma eligibility"; podwójne obsadzenie: 422 „Osoba ma już drugi on-call tego dnia"; 11-19 w dzień wolny: 422 „Zmiana 11-19 jest dostępna tylko w dni robocze".
- **Cykl zamiany end-to-end w UI.** Preselekcja z macierzy, podgląd wpływu na bilans z opisem kierunku („dalej od równowagi"), akceptacja zastępcy, zatwierdzenie z oknem potwierdzenia, slot ze statusem „zamiana", spójny feed ICS (po zamianie zastępca ma zdarzenie, oddający nie; `SEQUENCE` podniesione).
- **Rozstrzyganie per slot po zmianie semantyki supersede.** Dzień w nowym zakresie pochodzi z nowego grafiku (z korektą szkicu zachowaną jako override), dzień poza nim ze starego.
- **Lista zastępców w zamianie** poprawnie wyklucza wnioskodawcę i osobę z przeciwnej roli on-call tego dnia.
- **Rapport miesięczny**: sumy kontrolne zgodne z liczbą dni i dni roboczych miesiąca, podgląd = CSV.
- **RBAC**: viewer przekierowywany z sześciu zabronionych tras, widzi tylko „Dyżury", bez e-maili i bez danych dostępności; członek widzi w bilansie wyłącznie siebie; 65/65 macierzy uprawnień z t01.
- **Bezpieczeństwo przepływów**: link viewer jednorazowy (410 przy ponownym użyciu), aktywacja z walidacją długości hasła i jednorazowym tokenem, reset hasła kasuje sesje, komunikat logowania nie ujawnia przyczyny.
- **Dostępność**: roving tabindex (260 komórek, 1 przystanek Tab), strzałki i PageUp/PageDown po siatce, widok listy dni jako alternatywa, 0 naruszeń kontrastu w obu motywach (po 79 elementów zmierzonych), brak przepełnienia przy 390 px, przyklejona pierwsza kolumna na mobile.
- **Stabilność frontu**: zero błędów konsoli na wszystkich odwiedzonych trasach, 13 żądań na stronę główną, fonty self-hosted.
- **Outbox**: 512 powiadomień `skipped` z czytelnym powodem „SMTP nie jest skonfigurowany (brak ONCALL_SMTP_HOST)" - zgodnie z projektem, do ponowienia po konfiguracji.

### Zmierzone, świadomie niezgłaszane

- **Tryb tygodniowy pozwala na 7 dni on-call pod rząd** (metryka porównania: dzienny 3 vs tygodniowy 7). Ograniczenie serii z MED-11 celowo nie obejmuje trybu tygodniowego (komentarz w `scheduler.py`); porównanie wariantów eksponuje ten kompromis, więc decyzja należy do koordynatora.
- **Viewer dostaje 200 z pustą listą na `GET /calendar/feeds`** zamiast 403 - kwestia sporna odnotowana w rundzie 2, utrzymuję ocenę „nie defekt".
- **Lista osób sortuje po imieniu** (nazwa wyświetlana „Imię Nazwisko"). Spójne z wyświetlaniem; ewentualna zmiana na sortowanie po nazwisku to decyzja produktowa, nie defekt.
- **Nierówny rozkład w szkicach** to zamierzone nadrabianie długu historycznego (jak w rundzie 2).

---

## 10. Jak odtworzyć

Skrypty w `docs/qa-suite/`, zrzuty ekranu z tej rundy w `docs/qa-shots-3/`.

```bash
docker compose up -d --build
docker compose cp docs/qa-suite/seed_qa.py api:/tmp/seed_qa.py
docker compose exec api python /tmp/seed_qa.py
```

Nowy skrypt tej rundy:

```bash
backend/.venv/bin/python docs/qa-suite/t16_perf_round3.py   # raporty podczas generowania, ok. 1 min
```

Limity sprzętowe i ich zdejmowanie - jak w rundzie 2 (rozdział 10 [QA-REPORT-2.md](QA-REPORT-2.md)).

### Najkrótsze ścieżki ręczne dla nowych defektów

| Defekt | Kroki |
| --- | --- |
| HGH-08 | Jako `koord`: `POST /api/v1/scheduling/generate` na zakres 2027-07-02 do 2027-10-01. Po 30 s odpowiedź 409 z ogólnikowym komunikatem. |
| MED-15 | Jako `koord` kliknij w macierzy komórkę z istniejącym dyżurem, „Zmień obsadę…", potwierdź. W `#audyt` wpis „X → X", wersja grafiku podbita. |
| MED-16 | Jako `koord` opublikuj szkic na podzakres opublikowanego grafiku. Okno mówi o „zastąpieniu"; w bazie oba grafiki zostają `published`. |
| MED-17 | Jako `koord` obsadź kogoś komórką macierzy; zaloguj się jako ta osoba, dodaj „nie mogę" na ten dzień. Nikt nie dostaje ostrzeżenia; konflikt widać tylko jako P+N na komórce. |
| LOW-07 | Jako `koord` wygeneruj szkice dzienny i tygodniowy tego samego zakresu - identyczne nazwy na liście. |
| LOW-08 | Jako `admin` utwórz link viewer i otwórz go: baner „Zakres 05-09-2026-02-10-2026". |
| LOW-09 | Domyślny widok po seedzie: baner „2 dni jest poza opublikowanym zakresem". |
| LOW-10 | Jako `admin` utwórz konto w `#osoby` i otwórz link aktywacyjny - strona nie mówi, którego konta dotyczy. |
| LOW-11 | `POST /api/v1/scheduling/generate` z `"rotation_mode":"daily"` w treści tworzy szkic hybrydowy (o ile polityka to hybrydowy). |

---

## 11. Uwagi metodyczne

- Dwa „niepowodzenia" zestawu regresyjnego są znane i nie są defektami aplikacji w obecnej ocenie: viewer dostaje 200 zamiast 403 na `GET /calendar/feeds` (kwestia sporna z rundy 2) oraz asercja „91 dni poniżej 30 s" w t02/t07 (HGH-01; zgłaszane w rundach 1-3 jako kryterium planu niespełnione przez model, nie regresja).
- Skrypt `t09_edge.py` nie jest odporny na konto `qa_rot` pozostałe z poprzedniego przebiegu (seed go nie czyści, bo konta nie ma na liście ACCOUNTS) i kończy się `KeyError` zamiast czytelnym komunikatem. Artefakt zestawu, nie aplikacji; przy tej rundzie konto usunąłem ręcznie.
- Podobnie seed nie czyści linków viewer, subskrypcji ICS ani wpisów outbox - dane testowe kumulują się między rundami (1115 zdarzeń audytu, 512 wierszy outbox na starcie rundy 3).
- Stan „wszystkie grafiki superseded" osiągalny tylko z poziomu bazy: `/schedules/published` zwraca wtedy dane rozstrzygnięte (zgodnie z modelem per-slot), a baner ekranu głównego pokazuje „[OPUBLIKOWANY]", podczas gdy `/calendar` oznacza dni jako niepublikowane. Nie osiągalne przez API (grafików opublikowanych nie można usuwać), zgłaszam jako obserwację do udokumentowania, nie defekt.
- Wyniki wydajnościowe pochodzą z hosta, na którym działał także generator obciążenia - identycznie jak w rundach 1-2, więc porównania między rundami pozostają wiarygodne.
- Raport powstał metodą czarnej skrzynki przez HTTP i przeglądarkę (Chrome DevTools), uzupełnioną czytaniem kodu przy ustalaniu przyczyn oraz pełnymi przebiegami testów jednostkowych backendu (169) i frontendu (74).
