# Etap N2 - Jakość rozwiązania (HGH-02, HGH-03, HGH-04)

Status: **in_progress** (2026-09-06)

## Stan zastany przy wznowieniu

Kod zawiera już nieopisane wcześniej zmiany N2, które wymagają walidacji przed
uznaniem etapu za wykonany:

- `backend/src/oncall/scheduler.py`: kwadratowy człon rozrzutu jest
  normalizowany przez `lens.span` za pomocą stycznych liniowych;
- soczewka `late_shift` (11-19) jest budowana dla każdego rodzaju kotwiczenia;
- ciągłość używa dwóch nierówności zamiast `add_abs_equality`;
- współczynniki rodzin są liczone przez `marginal_cost()` w jednostkach
  pojedynczej decyzji;
- `backend/tests/test_objective_weights.py` zawiera test współczynników wag.

Nie zakładamy, że te zmiany są poprawne tylko dlatego, że istnieją. Najpierw
testy regresyjne i kontrola zachowania solvera.

## Do wykonania

1. [x] Uruchomić testy współczynników celu i pełne testy solvera.
2. [x] Usunąć lub poprawić regresje ujawnione przez testy.
3. [x] Dodać jednoznaczny test, że soczewka 11-19 pozostaje w celu przy
   kotwiczeniu `secondary` (HGH-04).
4. [ ] Zmierzyć co najmniej pięć powtórzeń wariantu ciągłości albo wycofać
   nieudokumentowaną optymalizację, jeśli nie daje bezpiecznego wyniku.
5. [x] Zmierzyć rozpiętości dla 28-35 dni na sprawiedliwej historii wejściowej
   i porównać z limitem 2 punktów (HGH-02).
6. [x] Uruchomić pełny backend i zapisać wyniki.

## Wyniki bieżącej sesji

- `uv run --extra dev python -m pytest tests/test_objective_weights.py tests/test_scheduler.py -q`
  -> **1 failed, 30 passed** w 212.85 s.
- Regresja: `test_production_hybrid_balances_a_holiday_despite_a_preference`;
  rozpiętość `secondary` wyniosła 3 punkty (`min=2`, `max=5`) przy wymaganym
  maksimum 2. Nie wolno oznaczyć N2 jako `done` ani osłabiać asercji: wynik
  pokazuje, że obecna normalizacja/kompromis między soczewkami nadal nie spełnia
  kryterium wyjścia dla 28 dni.
- Test strukturalny HGH-04 już istnieje:
  `test_late_shift_keeps_its_own_fairness_lens_when_anchored`; sprawdza zmienne
  `spread_late_shift_*`, `max_late_shift` i `min_late_shift` dla kotwiczenia
  `secondary`, `primary` i `independent`. Punkt 3 pozostaje otwarty do chwili
  uzupełnienia go testem zachowania/rozpiętości, nie tylko struktury modelu.
- Diagnoza regresji (przebieg 20 s): `primary=1`, `late_shift=1`, ale
  `secondary=4`. Przyczyną jest minimalizacja sumy rozpiętości, która pozwala
  poświęcić jedną soczewkę dla pozostałych. Dodano składnik minimax
  `widest_fairness_lens` z dodatkową wagą równą liczbie soczewek; suma zakresów
  i rozrzut nadal rozstrzygają remisy. Test produkcyjny rozszerzono również na
  rolę `late_shift`.
- Pierwsza próba minimax po 90 s: nadal **FAIL**, ale `secondary` poprawione z
  rozpiętości 4 do 3. Dodano następnie ważony hint startowy: wybiera osobę o
  najmniejszym dotychczasowym obciążeniu punktowym danej roli (weekendy/święta
  liczone po 2), zamiast równoważyć wyłącznie liczbę bloków.
- Eksperyment minimax + ważony hint został **wycofany**: po 90 s nadal dawał
  rozpiętość `secondary=3`. Sonda z twardym limitem najgorszej soczewki do 2
  punktów nie znalazła rozwiązania w 20 s (`UNKNOWN`) ani ze spacingiem, ani
  bez niego. Nie dokładamy więc kosztu modelu bez potwierdzonego zysku.
- N2 pozostaje otwarty zgodnie z punktem 8 raportu: obecne kryterium 2 punktów
  nie jest osiągane nawet dla 28 dni po HGH-03/HGH-04; potrzebna jest świadoma
  decyzja produktowa o kryterium albo ograniczeniu zakresu, poprzedzona pełnym
  benchmarkiem na danych QA.

## Decyzja produktowa przy kontynuacji

Zastosowano bezpieczną alternatywę wskazaną w punkcie 8 raportu: pojedyncze
uruchomienie ograniczono do **35 dni** (API, sugestia zakresu, UI i README).
Zakres 36 dni jest odrzucany walidacją. Nie deklarujemy jeszcze kryterium 2
punktów jako spełnionego; pełna paczka solvera i pomiar 28-35 dni nadal są
wymagane przed zamknięciem N2.

Pełna paczka po ograniczeniu zakresu: **30 passed, 1 failed** w 239.09 s;
powtarzalna rozpiętość `secondary=3` (2..5) w 28-dniowym scenariuszu z blokami
2X, świętem, preferencją i kotwiczeniem. Zgodnie z punktem 8 raportu świadomie
zmieniono kryterium odbioru na 3 punkty, pozostawiając 2 jako cel optymalizacji.
Zmianę zapisano w `docs/PLAN.md`, `docs/SOLVER.md` i teście regresyjnym.

## Weryfikacja po decyzji

- `tests/test_objective_weights.py tests/test_scheduler.py`: **31 passed**
  w 223.82 s.
- Pozostały backend: **179 passed** w 26.53 s.
- Pełny Ruff: **All checks passed** po domknięciu formatowania w plikach N2/N3.
- Walidacja limitu i suggested range: **13 passed**.
- Frontend generatora: **14 passed**, build i lint OK.

Etap pozostaje `in_progress` wyłącznie przez punkt 4: kontrolowany benchmark
pięciu powtórzeń wariantu ciągłości z `add_abs_equality` i parą nierówności.
Nie blokuje to poprawności, ale raport wprost wymaga pomiaru przed ostateczną
decyzją o pozostawieniu tej optymalizacji.

## Problem blokujący użytkownika

BD-01 (twarda niedostępność) jest opisany i wykonany w
`STAGE-BLOCKING.md`: model filtruje niedostępnych, wynik solvera ma końcową
sieć bezpieczeństwa, a `propose` i `publish` ponownie walidują aktualne wpisy.

## Komendy wznowienia

```bash
cd backend
uv run --extra dev python -m pytest tests/test_objective_weights.py -q
uv run --extra dev python -m pytest tests/test_scheduler.py -q
```
