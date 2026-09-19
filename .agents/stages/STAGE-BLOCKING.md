# Etap BD-01 - Twarda niedostępność jako ograniczenie twarde cyklu szkicu

Status: **done** (2026-09-06)

## Problem (sygnalizowany przez użytkownika jako blokujący)

Wygenerowany szkic zawiera osobę niedostępną („nie mogę"). Distribucja problemu:
solver sam nigdy nie przypisze osoby z twardą niedostępnością (model filtruje
kandydatów - potwierdzone fuzz: 60 prób, 0 naruszeń), ale szkic mógł powstać na
dniu, na który ktoś niedostępność wpisał PÓŹNIEJ (po wygenerowaniu).
Publikacja takiego szkicu ustawiałaby osobę niedostępną na żywym dyżurze,
czego model nigdy by nie wygenerował - luka była na BRZEGU cyklu życia:
`propose_schedule` / `publish_schedule` nie re-walidowały twardej niedostępności.

## Zakres (twarda reguła)

- `Propose` szkicu z osobą niedostępną -> 409, `reason: UNAVAILABLE`, message
  „Szkic zawiera osoby z twardą niedostępnością; wygeneruj grafik ponownie",
  lista konfliktów `YYYY-MM-DD · rola: <imię> ma twardą niedostępność`.
- `Publish` propozycji z osobą niedostępną -> identyczny 409.
- Sygnał w `generate_schedule` po solve (sieć bezpieczeństwa) - gdyby kiedyś model
  chciał wyemitować osobę niedostępną, zwróci INFEASIBLE z czytelnym komunikatem,
  zamiast zapisać do bazy.

## Pliki

- `backend/src/oncall/scheduler.py` - nowa sieć bezpieczeństwa po `solution()`
  (pętla po assignmentach, sprawdza `preference(day) == unavailable`).
- `backend/src/oncall/routes/scheduling.py` - nowy helper
  `_hard_unavailability_conflicts(schedule, db)` (czytelny dla osobowości:
  member_id -> zakresy `unavailable`, potem sprawdzenie nakładania na
  `service_date`; pomija assignmenty bez `member_id`); wywoływany w
  `propose_schedule` i `publish_schedule` po zmianie stanu/wersji,
  w publish po `_validate_complete`. Import `Availability` do modeli.
- `backend/tests/test_schedule_unavailability_guard.py` - 3 testy integracyjne
  (propose 409, publish 409, propose OK po skasowaniu wpisu).

## Zgodność z frontendem

`errorMessage` w `frontend/src/api.ts:421-431` czyta `detail.message` przy
obiekcie detail, więc komunikat przechodzi 1:1. Nie zmieniano frontendu.

## Weryfikacja

- `uv run --extra dev python -m pytest tests/test_schedule_unavailability_guard.py -q`
  -> **3 passed**.
- Testy generowania/publikacji: `test_draft_delete.py`, `test_draft_persistence.py`,
  `test_partial_republish.py`, `test_schedule_workflow.py`, `test_draft_override.py`
  -> **22 passed**.
- `tests/test_scheduler.py` -> **28 passed** (sieć bezpieczeństwa nie psuje solvera).

Ponowna weryfikacja 2026-09-06 po rozpoczęciu N2:

- `uv run --extra dev python -m pytest tests/test_schedule_unavailability_guard.py -q`
  -> **3 passed** w 0.74 s. Ochrona `propose`/`publish` pozostaje zielona.

## Wniosek

Problem użytkownika rozwiązany na poziomie API; generator nigdy nie produkuje
osoby niedostępnej, a publikacja nie pozwala przemycić takiego szkicu.
