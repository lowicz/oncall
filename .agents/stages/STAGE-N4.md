# Etap N4 - Domknięcie defektów średnich i bezpieczeństwa

Status: **done** (2026-09-06)

## Stan

- [x] MED-01 - etykieta opublikowanego grafiku z danych (`schedule.id`);
  przy braku publikacji nagłówek i panel statusu nie twierdzą już, że grafik
  jest opublikowany.
- [x] MED-02 - sugestia zaczyna się najwcześniej jutro, uwzględnia pokrycie
  opublikowane oraz import historii; dialog publikacji ostrzega, gdy ręcznie
  wybrany zakres obejmuje dziś albo przeszłość.
- [x] MED-03 - po ręcznej korekcie API zwraca ostrzeżenia o czterech kolejnych
  dniach, ponad trzech dyżurach w siedmiu dniach i braku dwóch dni odpoczynku;
  generator pokazuje ostrzeżenia nad wynikiem.
- [x] MED-04 - okno korekty pokazuje dostępność/notatkę, bieżącego właściciela
  slotu oraz prognozę zmiany salda wybranej osoby przed zapisem (z wagą 2X dla
  dnia wolnego); korzysta ze współdzielonego cache prognozy sprawiedliwości.
- [x] MED-05 - API odrzuca politykę, w której wszystkie trzy wagi wynoszą zero.
- [x] MED-06 - API zachowuje kompatybilną listę wyników i zawsze zwraca nagłówek
  `X-Oncall-Logins-Excluded: true|false`; wyszukiwanie nie zwraca już pustej
  listy bez sygnału, że pasujące logowania mogły zostać odfiltrowane.
- [x] SEC-01 - router zamian ma jawny strażnik ról; router dostępności już używał
  `MemberUser` z tym samym zestawem dozwolonych ról.

## Zmiany i testy

- `routes/swaps.py`: router-level `require_roles(member, coordinator, admin)`,
  dzięki czemu viewer dostaje 403 także dla niepoprawnego body, przed 422.
- `routes/scheduling.py`: kontrola wynikowych (również częściowo aktualizowanych)
  wag przed zapisem i audytem; trzy zera -> 422 z polskim komunikatem.
- `tests/test_rbac_regressions.py`: regresje viewer dla swaps i availability.
- `tests/test_audit.py`: regresja trzech wag równych zero.

## Weryfikacja

- Backend RBAC/policy: `11 passed`; Ruff: `All checks passed`.
- Frontend: `npm run build` -> sukces (ostrzeżenie Vite o istniejącym dużym
  chunku 894 kB); `npm run lint` -> sukces.
- MED-02: `tests/test_suggested_range.py` -> **7 passed**, Ruff/build/lint OK.
- MED-03: `tests/test_draft_override.py` -> **3 passed**, build/lint OK.
- MED-06: `tests/test_audit.py` -> **10 passed**, Ruff OK.
- Pełny backend bez solvera, pierwsza próba: **179 passed, 1 failed**. Regresja
  trwałości ostrzeżeń MED-03 (`test_manual_correction_survives_a_reload`):
  odpowiedź po korekcie miała ostrzeżenia, reload nie. Poprawiono przez
  deterministyczne przeliczanie ostrzeżeń z zapisanych assignmentów przy każdym
  `_schedule_response`; ponowna weryfikacja poniżej.
- Test regresji trwałości + override: **4 passed**, Ruff OK.
- Pełny backend bez kosztownego `tests/test_scheduler.py`, po poprawce:
  **180 passed** w 25.00 s.
- Generator frontend: **14 passed**, build i lint OK.

## Kryterium wyjścia

Wszystkie punkty 13-19 raportu (MED-01..MED-06 i SEC-01) są wdrożone oraz
zweryfikowane. Etap można bezpiecznie uznać za zakończony.
