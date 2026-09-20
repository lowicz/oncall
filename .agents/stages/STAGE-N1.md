# Etap N1 - Odblokowanie solvera (BLK-01, HGH-01)

Status: **done** (2026-09-06)

## Punkt blokujący użytkownika (w tym etapie NO-OP)

Użytkownik dodał osobny problem blokujący o twardej niedostępności.
Został przejęty przez `STAGE-BLOCKING.md`. Tu NIE jest poruszany.

## Wykonane

1. **BLK-01** Zastąpiono mechanizm `add_assumption(spacing_enabled)` + `only_enforce_if`
   budowaniem dwóch niezależnych modeli przez nowy helper `_build_model(*, spacing: bool)`
   (`backend/src/oncall/scheduler.py`).
   - `spacing=True` kompiluje reguły rozrzedzania jako twarde ograniczenia,
   - po `INFEASIBLE` przy `spacing=True` budowany jest drugi model z `spacing=False`
     i ponawiany solve; sukces dołącza ostrzeżenie „Reguły rozrzedzania musiały
     zostać zawieszone..." (kompletny szkic z ostrzeżeniem, nigdy 409).
2. **BLK-01** Parametr solvera: `solver.parameters.num_search_workers` (przestarzały
   w OR-Tools 9.15) zamieniony na `solver.parameters.num_workers`. Nie ustawiamy obu.
3. **HGH-01** Domyślny budżet `ONCALL_SOLVER_SECONDS` podniesiony z 30 do 90 s:
   - `config.py` (`Field(default=90.0, ...)`),
   - `docker-compose.yml` (api i worker),
   - `.env.example`, `README.md`, `archive/docs/SOLVER.md`,
   - `SOLVE_SECONDS = 90.0` w `scheduler.py`.
4. `archive/docs/SOLVER.md`: opis twardych reguł rozrzedzania przepisany z „warunkowane
   założeniem CP-SAT" na „kompilowane do twardych ograniczeń + drugi przebieg".

## Testy (dodane/utrzymane w `tests/test_scheduler.py`)

- `test_spacing_rules_are_never_assumption_gated` - monkeypatch `add_assumption`,
  które rzuca, gdyby ktoś je przywrócił (regresja na blokadę BLK-01).
- `test_solver_uses_num_workers_instead_of_deprecated_field` - rejestruje parametry
  `num_workers=4` i `num_search_workers=0`.
- `test_spacing_fallback_returns_complete_draft_with_warning` - ścieżka zapasowa
  daje kompletny szkic + ostrzeżenie, nie pusty failure (odpowiednik „nie 409").
- Istniejące `test_infeasible_spacing_is_retried_with_an_explicit_warning` nadal przechodzi.

## Weryfikacja

- `uv run --extra dev python -m pytest tests/test_scheduler.py -q` -> **28 passed**.
- Pełny backend poza solverem: `uv run --extra dev python -m pytest -q --ignore=tests/test_scheduler.py`
  -> **164 passed**.
- Czas paczki testów solvera spadł z ~134 s do ~40 s (efekt równoległości).

## Kryterium wyjścia z planu (rozszerzone)

- 91 dni na 2 rdzeniach kończy się kompletnym grafikiem w każdym z dziesięciu
  kolejnych uruchomień. **Do zweryfikowania na docelowym sprzęcie/docker**
  (tutaj: ograniczenie do `cpus: 2` kontenera worker nie było odtwarzane w sesji).
  Sugerowany skrypt weryfikacyjny: uruchomić 10x `POST /api/v1/scheduling/runs`
  na zakres 2027-01-04..2027-04-04 i sprawdzić `completed` + `schedule_id`.

## Jak kontynuować

- Następny etap N2 (`STAGE-N2.md`) - HGH-03/HGH-04/HGH-02, czeka na start.