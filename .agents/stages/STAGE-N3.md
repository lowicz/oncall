# Etap N3 - Integralność danych (HGH-05, HGH-06)

Status: **done** (2026-09-06)

## Wykonane (punkty 9-12 planu, QA-REPORT-4 rozdz. 11)

9. **HGH-05 (import nie wygrywa z publikacją).**
   - `backend/src/oncall/routes/history.py`: `published_at` importu zmienione
     z `datetime.now(UTC)` na północ zakresu importu
     `datetime.combine(starts_on, time.min, tzinfo=UTC)` - import nie wygląda
     już na „najnowszy grafik systemu".
   - `backend/src/oncall/effective.py`: w `effective_assignments()` jawny porządek
     - `key = (not name.startswith("Import historii:"), published_at or _EPOCH, str(id))`.
     Sort rosnący + nadpisywanie po kolei: importy (False) przetwarzane
     PIERWSZE, realne publikacje (True) OSTATNIE, więc każda realna publikacja
     wygrywa nad importem per slot niezależnie od timestampów.
     (Uwaga: klucz musi być `not startswith`, żeby realne publikacje miały
     WYŻSZY klucz i były przetwarzane ostatnie.)
10. **HGH-05 (podgląd raportuje konflikt).** W `_validate_members` dodany
    zbiór zajętych slotów `{(service_date, role)}` ze wszystkich grafiiów
    `status == published` pokrywających zakres wierszy; każdy wiersz importu
    trafiający w opublikowany slot dostaje
    `HistoryImportError(..., "service_date", "Data dyżuru jest objęta grafikiem opublikowanym")`.
    Ponieważ `_validate_members` jest wołane też z `commit`, commit także
    odrzuca (422/409) takie wiersze - nie ma cichego przejścia.
11. **HGH-06 (casefold + display_name z bazy).** `commit_history`:
    słownik `members` kluczowany `display_name.casefold()` (identycznie jak
    walidacja); assignmenty zapisują `member.display_name` (nie surowy łańcuch
    z CSV) i `member.id` (nigdy NULL dla znanej osoby). Nie ma już bazy
    „rafał kamiński" z `member_id = NULL”.
12. **Test regresyjny (punkt 12):** `tests/test_history_import_routes.py`,
    wiersz `rafał kamiński` (małe litery) dla dnia objętego publikacją
    -> podgląd `valid=False` z komunikatem o objętym dniu (odrzucony, nie
    przyjęty). Pozostałe testy w pliku:

## Testy (nowe, `tests/test_history_import_routes.py`)

- `test_commit_matches_member_case_insensitively_and_uses_roster_name` -
  commit z `rafał kamiński` daje `member_id=członek.id` i nazwę z rejestru.
- `test_legacy_import_never_wins_over_real_publication` - konstruuje legacy
  import z `published_at=now()` (rozmnożenie defektu) i sprawdza, że
  `effective_assignments()` zwraca Piotra (publikację), nie Rafała.
- `test_import_fills_slot_not_covered_by_any_publication` - import wygrywa
  tam, gdzie żadna publikacja nie pokrywa slotu (dopasowanie po member_id).
- `test_preview_reports_conflict_with_published_schedule` - punkt 12 powyżej.

## Weryfikacja

- `uv run --extra dev python -m pytest tests/test_history_import_routes.py -q` -> **4 passed**.
- Pełny backend (bez solvera): **171 passed**.
- Solver nietknięty w tym etapie (28 testów do zieloności z etapu N1).

## Kryterium wyjścia N3

„żaden import nie zmienia sumy punktów w raporcie sprawiedliwości ani liczby
wierszy w raporcie kadrowym dla dni już opublikowanych."

Nie zweryfikowane razem z raportami kadrowym/sprawiedliwości (raporty czytają
`effective_assignments` i `matches_member` - naprawa orderingu + casefold
powinna domknąć oba). Warto w przyszłej sesji zrobić ręczny scenariusz QA:
publikacja + import z małą literą na ten sam dzień -> rozliczenie bez zmian.