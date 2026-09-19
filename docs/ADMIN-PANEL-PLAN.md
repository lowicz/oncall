# Panel administracyjny, tożsamość i LDAP - plan prac

Dokument roboczy do wznawiania pracy i śledzenia postępu.
Powstał po dwóch rundach ustaleń w Lavish Editor (`.lavish/admin-panel.html`).
Przegląd interfejsu, z którego to wyrosło, jest w [UI-REVIEW.md](UI-REVIEW.md).

Legenda statusów: `[ ]` do zrobienia, `[~]` w trakcie, `[x]` zrobione i zweryfikowane.

---

## 1. Ustalenia

Wszystkie potwierdzone przez Łowicza. Nie zmieniać bez nowej decyzji.

| Nr | Pytanie | Rozstrzygnięcie |
| --- | --- | --- |
| D1 | Tożsamość osoby w grafiku | Klucz obcy `member_id` na `Assignment`, migracja danych, dopasowanie po id. `assignee_name` zostaje etykietą historyczną. |
| D2 | Hasło przy zakładaniu konta | Jednorazowy link aktywacyjny. Administrator nie zna hasła. Dotyczy wyłącznie kont lokalnych. |
| D3 | Bezpieczniki ról | Ochrona ostatniego aktywnego administratora **oraz** zakaz zmiany własnej roli i statusu. |
| D4 | Rola a rotacja | Osobny, jawny krok dodania do rotacji, z datą wejścia. Bez automatu przy nadaniu roli. |
| D5 | Edycja eligibility | Pełny edytor okresów (nadaj od daty, zakończ datą), zgodny z wersjonowanym modelem. |
| E1 | Numer pracownika | Tekst z walidacją „tylko cyfry”. Zachowuje wiodące zera. Unikalny. |
| E2 | Provisioning LDAP | Automatyczne założenie konta przy pierwszym udanym logowaniu, z rolą `viewer`. |
| E3 | Tryb mieszany | Konta lokalne działają zawsze obok LDAP. `auth_source` per konto, nie globalny przełącznik. |
| E4 | Właścicielstwo danych osobowych | Dla kont LDAP źródłem prawdy jest AD: imię, nazwisko i e-mail odświeżane przy każdym logowaniu, w panelu tylko do odczytu. |

### Konsekwencja E2, przyjęta świadomie

Każda osoba z AD, która się zaloguje, dostanie konto `viewer` i zobaczy opublikowany grafik.
Jest to bezpieczne, bo `viewer` zgodnie z `PLAN.md` §2 nie widzi dostępności, powodów niedostępności,
punktów, wniosków o zamianę ani ustawień.
Panel ma pokazywać, które konta powstały automatycznie i kiedy logowały się pierwszy raz.
Zawężenie do grupy AD da się dołożyć później bez zmiany reszty projektu.

### Co zawsze zostaje lokalne

Rola konta, przynależność do rotacji i data wejścia, eligibility, dostępność, zamiany, bilans, audyt.
Z AD przychodzi wyłącznie weryfikacja hasła, numer pracownika, imię, nazwisko i adres e-mail.

---

## 2. Etap 1: tożsamość w grafiku (D1)

Warunek konieczny dla całej reszty. Bez tego zmiana nazwiska - a przy AD nazwiska zmieniają się same -
urywa osobę od jej historii w bilansie, raporcie kadrowym, kanale ICS i zamianach.

- [x] Migracja `0012_assignment_member_id`: kolumna, klucz obcy `ON DELETE SET NULL`, indeks, backfill po `display_name`
- [x] Pole `member_id` w modelu `Assignment` (nullable - import historii może nazywać osoby bez konta)
- [x] Generator wypełnia `member_id` przy tworzeniu szkicu (`routes/scheduling.py`)
- [x] Import historii wypełnia `member_id`, gdy nazwa pasuje do członka zespołu (`routes/history.py`)
- [x] Ścieżki podmiany osoby w slocie ustawiają `member_id` razem z `assignee_name`:
      - [x] `routes/calendar.py` - bezpośrednia korekta koordynatora
      - [x] `routes/scheduling.py` - korekta w szkicu
      - [x] `routes/swaps.py` - zatwierdzenie zamiany
- [x] `effective.py` niesie `member_id` w `EffectiveAssignment` plus pomocnik `matches_member()`
- [x] Odczyty preferują `member_id`, a nazwa jest fallbackiem dla wierszy bez id:
      - [x] `fairness.py` / `fairness_data.py` - dopasowanie osoby do dyżuru
      - [x] `routes/feeds.py` - filtr „moje dyżury” w ICS
      - [x] `main.py` - kontakt i następny dyżurny w sekcji „Teraz”
      - [x] `routes/swaps.py` - sprawdzenie „ten slot należy do mnie”
      - [x] `routes/reports.py` - raport kadrowy, przy okazji przeniesiony na wspólne rozstrzyganie
- [x] Testy: zmiana `display_name` nie rusza bilansu ani raportu; wiersze bez `member_id` (import) nadal się liczą (`tests/test_rename_identity.py`)

**Uwaga przy wznowieniu:** backfill w migracji jest napisany pod PostgreSQL (`UPDATE ... FROM`).
Testy chodzą na SQLite, więc migracje nie są w nich wykonywane - schemat powstaje z modeli.

**Etap 1 zamknięty.** Migracja wykonana na lokalnej bazie: 1549 przydziałów, wszystkie z `member_id`, zero bez.
Test regresji sprawdzony w obie strony: bez dopasowania po id `test_balance_survives_a_rename` nie przechodzi.
Przy okazji `routes/reports.py` przestał budować własną kopię rozstrzygania nakładających się grafików
i korzysta ze wspólnego `effective.py` - to była czwarta kopia tej logiki.

---

## 3. Etap 2: model kont (E1, E4)

- [x] Migracja: `personnel_number` (tekst, unikalny), `first_name`, `last_name`, `auth_source` (`local` / `ldap`)
- [x] Backfill: rozbicie obecnego `display_name` na imię i nazwisko, `auth_source = local`, numer do uzupełnienia ręcznie
- [x] `display_name` zostaje jako pole wyliczane z imienia i nazwiska (używa go cały grafik)
- [x] Walidacja numeru: tylko cyfry, unikalny, wiodące zera zachowane
- [x] `password_hash` staje się nullowalny - konta LDAP go nie mają
- [x] Schematy i ekran `/osoby` pokazują numer, imię i nazwisko osobno

**Etap 2 zamknięty.** Migracja wykonana na lokalnej bazie PostgreSQL: wszystkie 6 kont
otrzymało rozdzielone dane osobowe i `auth_source = local`; numery pracowników pozostają
do ręcznego uzupełnienia. Metadane ORM są zgodne z migracjami (`alembic check` bez różnic).
Testy obejmują wyliczanie nazwy, wiodące zera, walidację i unikalność numeru, konto bez
lokalnego hasła oraz kontrakt API i widok `/osoby`.

---

## 4. Etap 3: panel administracyjny (D2-D5)

### Backend
- [x] `POST /api/v1/admin/users` - założenie konta lokalnego, bez hasła, z tokenem aktywacyjnym
- [x] `PATCH /api/v1/admin/users/{id}` - rozszerzenie o rolę, status, dane osobowe (dla kont LDAP tylko rola i status)
- [x] Bezpieczniki D3: ostatni aktywny administrator, zakaz zmian na sobie. Zwracać 409 z czytelnym powodem
- [x] Tokeny aktywacyjne i reset hasła (tabela + `POST .../activate`, `POST .../reset`), tylko `auth_source = local`
- [x] `POST` i `PATCH` na `/api/v1/admin/team-members` - wejście do rotacji i zakres aktywności
- [x] `POST` i `PATCH` na eligibility - nadanie okresu i zamknięcie go datą
- [x] Wszystko audytowane, wzorem istniejących `record_audit`

### Frontend
- [x] `/osoby`: kolumny numer, osoba, sposób logowania, rola, status, rotacja, akcje
- [x] Panel szczegółów osoby z edycją roli, statusu, rotacji i eligibility
- [x] Formularz nowego konta
- [x] Potwierdzenia przez wspólny `ConfirmDialog` dla zmiany roli i wyłączenia konta
- [x] Dla kont LDAP: dane osobowe tylko do odczytu z adnotacją „z AD”, brak resetu hasła
- [x] Testy: bezpieczniki, RBAC, ścieżka zakładania konta, konto LDAP kontra lokalne

**Etap 3 zamknięty.** Migracja `0014_account_tokens` została wykonana na lokalnej bazie
PostgreSQL, a metadane ORM są zgodne ze schematem (`alembic check` bez różnic). Linki
aktywacyjne i resetu są jednorazowe, mają termin ważności, a reset unieważnia aktywne sesje.
Rotacja pozostaje jawnym krokiem niezależnym od roli konta, natomiast okresy eligibility można
dodawać i edytować wraz z obiema datami. Wdrożony ekran `/osoby` oraz formularze aktywacji
i resetu zostały sprawdzone testami automatycznymi i smoke testem w przeglądarce.

---

## 5. Etap 4: LDAP/AD (E2, E3)

- [x] Konfiguracja w `config.py`, prefiks `ONCALL_`: `ldap_enabled`, `ldap_server_uri`, `ldap_bind_dn`,
      `ldap_bind_password`, `ldap_base_dn`, `ldap_user_filter`, `ldap_start_tls`, plus mapowanie atrybutów
      (numer pracownika, imię, nazwisko, e-mail)
- [x] Moduł uwierzytelniania jako punkt wymienny obok Argon2id; reszta aplikacji nie wie, skąd przyszła sesja
- [x] Przebieg: bind kontem serwisowym → wyszukanie użytkownika → bind jako użytkownik (właściwa weryfikacja)
      → odczyt atrybutów → odnalezienie lub utworzenie konta po `personnel_number` → sesja
- [x] Auto-provisioning wg E2: nowe konto dostaje rolę `viewer`, zapis w audycie
- [x] Synchronizacja wg E4: imię, nazwisko, e-mail nadpisywane przy każdym logowaniu
- [x] Tryb mieszany wg E3: konta lokalne logują się niezależnie od stanu AD
- [x] Testy na atrapie katalogu: udane logowanie, złe hasło, użytkownik spoza katalogu, niedostępny serwer,
      awaria AD nie blokuje kont lokalnych ani nie psuje istniejących sesji

**Etap 4 zamknięty.** Klient LDAP działa poza pętlą asynchroniczną API, ucieka login
w filtrze wyszukiwania, wymaga dokładnie jednego wyniku i weryfikuje certyfikaty TLS.
Konto jest wiązane po numerycznym `personnel_number`; konflikt z kontem lokalnym jest
odrzucany zamiast niejawnej zmiany źródła logowania. Pierwszy login konta LDAP jest
widoczny na `/osoby` jako data utworzenia, a każde późniejsze logowanie synchronizuje
dane osobowe i nazwę powiązanego członka rotacji, nie zmieniając lokalnych uprawnień.
Konfigurację wdrożeniową opisują `.env.example` i sekcja LDAP w `README.md`.

Przy okazji wszystkie kontrolki i samodzielnie wyświetlane daty w interfejsie zostały
ujednolicone do `DD-MM-YYYY`; wartości przesyłane do API pozostają w ISO `YYYY-MM-DD`.

---

## 6. Znane ograniczenia do domknięcia przy okazji

- Ścieżka publikacji grafiku nie ma testów na PostgreSQL (blokada `pg_advisory_xact_lock` pomijana na SQLite)
- Reguła `label-content-name-mismatch` w macierzy, wynikająca ze świadomego wyboru krótkich kodów
