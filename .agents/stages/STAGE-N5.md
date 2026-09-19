# Etap N5 - Defekty niskiej wagi

Status: **done** (2026-09-06)

## Stan

- [x] LOW-01 - publikacja zmienia wygenerowany prefiks „Szkic ” na „Grafik ”.
- [x] LOW-02 - legenda dostępności ukryta dla viewera.
- [x] LOW-03 - etykieta „Tylko do odczytu” dla viewera/linku.
- [x] LOW-04 - usunięty dekoracyjny gradient i blur topbara.
- [x] LOW-05 - zmiany bezwzględne poniżej 0,05 opisane jako „bez istotnej zmiany”.
- [x] LOW-06 - przy zerowej liczbie dni eligibility tabela pokazuje „nie pełni tej
  roli”, zamiast pozornego salda 0 → 0.
- [x] LOW-07 - opcje zastępstwa pobierają prognozę wpływu, są sortowane od
  największej poprawy salda wybranej roli i dostają znacznik „poprawia bilans”.
- [x] LOW-08 - brak alarmowego `!` poza opublikowanym zakresem.
- [x] LOW-09 - własne dyżury kolidujące z twardą niedostępnością mają czerwony
  znacznik i są sortowane przed pozostałymi.
- [x] LOW-10 - wordmark nie łamie się na wąskim ekranie.
- [x] LOW-11 - ekran fairness wyjaśnia priorytet soczewki weekendowej; raport
  miesięczny już wyjaśniał, że dla kadr takie święto jest liczone jako święto.

## Weryfikacja

- Pierwsza paczka UI (LOW-02/03/04/08/10): build + lint OK; testy kalendarza
  i generatora **25 passed**.
- LOW-05/06: build + lint OK; generator **14 passed**.
- LOW-01 + blokująca niedostępność/publikacja: backend **8 passed**, Ruff OK.
- LOW-09 oraz regresje UI: build + lint OK; kalendarz, generator i zamiany
  **33 passed**.
- LOW-07/11, pierwsza próba: build i lint OK; **32 passed, 1 failed** przez
  dekoracyjny chip dołączony do accessible name opcji. Chip oznaczono
  `aria-hidden`, aby nazwa opcji pozostała stabilnym imieniem osoby.
- LOW-07/11 po korekcie dostępności: **33 passed**, lint OK.
- Pełny frontend: **82 passed** w 11 plikach. Pozostały wcześniejsze ostrzeżenia
  React `act(...)` w testach `useGridNavigation`, bez niezaliczonych testów.

## Kryterium wyjścia

LOW-01 do LOW-11 są wdrożone. Build, lint i pełna paczka testów frontendu są
zielone; etap zakończony.
