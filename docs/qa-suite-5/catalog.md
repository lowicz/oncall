# Katalog przypadków testowych - runda 5

Kolumna „Wykonany” mówi prawdę: przypadki nieoznaczone jako wykonane nie zostały uruchomione w tej rundzie.

## A. Dostęp i role

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| A1 | Odczyty dostępne dla admina | `t_rbac.py` | tak | przeszedł |
| A2 | Odczyty dostępne dla koordynatora | `t_rbac.py` | tak | przeszedł |
| A3 | Odczyty dostępne dla członka | `t_rbac.py` | tak | przeszedł |
| A4 | Koordynator bez dostępu do ekranów admina | `t_rbac.py` | tak | 403 zgodnie z oczekiwaniem |
| A5 | Zapisy poza rolą | `t_rbac.py` | tak | przeszedł |
| A6 | Ochrona CSRF | `t_rbac.py` | tak | przeszedł |
| A7 | Konto wyłączone nie loguje się | `t_rbac.py` | tak | przeszedł |
| A8 | Wylogowanie unieważnia sesję | `t_rbac.py` | tak | przeszedł |
| A9 | Uwierzytelnianie LDAP | - | **nie** | poza zakresem środowiska |

## B. Reguły twarde

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| B1 | Kompletność slotów i rozłączność primary/secondary | `verify_rules.py` | tak | przeszedł |
| B2 | Zmiana 11–19 dokładnie raz w dni robocze i nigdy w dni wolne | `verify_rules.py` | tak | przeszedł |
| B3 | Nierozdzielczość bloków weekendowych i świątecznych | `verify_rules.py` | tak | przeszedł |
| B4 | Najwyżej 3 kolejne noce | `verify_rules.py` | tak | przeszedł |
| B5 | Najwyżej 3 dyżury w 7 dniach | `verify_rules.py` | tak | **naruszony po zatwierdzonej zamianie** (HGH5-03) |
| B6 | Twarda niedostępność respektowana przez generator | `t_stale_draft.py` | tak | przeszedł |
| B7 | Szkic z kolizją niedostępności nie może być przekazany | `t_stale_draft.py` | tak | backend blokuje, UI nie ostrzega (HGH5-02) |
| B8 | Kotwiczenie 11–19 po zamianie | ręcznie | tak | **złamane** (HGH5-03) |
| B9 | Dwudniowy odpoczynek po serii po korekcie koordynatora | - | **nie** | walidacja nie istnieje w kodzie, patrz HGH5-03 |

## C. Solver: jakość i wydajność

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| C1 | Okno solvera wobec okna raportu | `window_check.py` | tak | **BLK5-01** |
| C2 | Poprawka okna, 3 powtórzenia na wariant | `window_fix.py` | tak | poprawa w każdej soczewce |
| C3 | Wykonalność kryterium 3 punktów | `variant5.py` | tak | **BLK5-02**, INFEASIBLE w 0,5 s |
| C4 | Najmniejsza osiągalna rozpiętość | `variant5.py` | tak | 6 punktów przy kotwicy `secondary` |
| C5 | Kotwica `independent` | `variant5.py` | tak | 2,07 punktu |
| C6 | Plan 2x2 okno x kotwica, 3 powtórzenia | `variant5.py` | tak | tylko obie poprawki dają 3,0 |
| C7 | Wpływ budżetu 1/10/30/90 s | `analyze5.py` | tak | **HGH5-01**, brak wpływu |
| C8 | Skalowanie `num_workers` 1-16 | `analyze5.py` | tak | BLK-01 z rundy 4 naprawiony |
| C9 | Zamiatanie wag sprawiedliwości | `analyze5.py` | tak | suwak bez wpływu na metrykę raportu |
| C10 | Porównanie trybów hybrid/daily/weekly | `analyze5.py` | tak | tryb tygodniowy: serie 12-dniowe |
| C11 | Log wyszukiwania CP-SAT | `log5.py` | tak | granicę domyka wyłącznie `default_lp` |
| C12 | Fallback bez reguł rozrzedzania | `t_stale_draft.py` | tak | działa, ostrzeżenie nie dociera (HGH5-06) |
| C13 | Stan PRECHECK | ręcznie | tak | poprawny, komunikat myli przyczynę |
| C14 | Stan UNKNOWN w interfejsie | - | **nie** | wymaga zmiany zmiennej środowiskowej i restartu |
| C15 | Zakres 35 dni w pełnej kracie trybów i kotwic | - | **nie** | wykonano tylko wybrane komórki |

## D. Import historii

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| D1 | Import 1245 wierszy | `import_history.py` | tak | 0,12 s podgląd, 0,12 s zatwierdzenie |
| D2 | Odtworzenie bilansu po imporcie | `check_fairness.py` | tak | zgodne z rundą 4 co do setnych |
| D3 | Import nad opublikowanym grafikiem | ręcznie | tak | blokowany (HGH-05 naprawiony) |
| D4 | Inna wielkość liter w nazwisku | ręcznie | tak | rozpoznane (HGH-06 naprawione) |
| D5 | Okres członkostwa | ręcznie | tak | walidowany |
| D6 | Eligibility roli | ręcznie | tak | **nie walidowana** (LOW5-13) |

## E. Zamiany i korekty

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| E1 | Pełna ścieżka zamiany | ręcznie + API | tak | działa |
| E2 | Podgląd wpływu zamiany | przeglądarka | tak | brak kontekstu przed wyborem (MED5-09) |
| E3 | Korekta na osobę niedostępną | przeglądarka | tak | odmowa dopiero po potwierdzeniu (MED5-04) |
| E4 | Korekta w macierzy opublikowanej | przeglądarka | tak | model interakcji mylący (MED5-04) |
| E5 | Zamiana zakresu i całego tygodnia | - | **nie** | |

## F. Raporty i eksport

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| F1 | Raport miesięczny, zgodność z kalendarzem | `t_reports.py` | tak | zero rozbieżności |
| F2 | Eksport CSV | `t_reports.py` | tak | zgodny z widokiem |
| F3 | Kanał ICS członka | `t_share_ics.py` | tak | tylko własne dyżury |
| F4 | Jednorazowy link viewer | `t_share_ics.py` | tak | druga wymiana zwraca 410 |
| F5 | Odwołanie linku | `t_share_ics.py` | tak | sesja unieważniona |

## G. Przypadki brzegowe

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| G1 | Zakres 92 dni | `t_edge.py` | tak | 422, limit 35 dni |
| G2 | Zakres odwrócony | `t_edge.py` | tak | 422 |
| G3 | Zakres jednodniowy | `t_edge.py` | tak | przyjęty (LOW5-15) |
| G4 | Waga 101 i waga ujemna | `t_edge.py` | tak | 422 |
| G5 | Wszystkie wagi zerowe | `t_edge.py` | tak | 422 |
| G6 | Link viewer na 31 dni | `t_edge.py` | tak | 422 |
| G7 | Dostępność na 400 dni | `t_edge.py` | tak | 422 |
| G8 | Zły format miesiąca | `t_edge.py` | tak | 422 |
| G9 | Kalendarz na 5 lat | `t_edge.py` | tak | 422 |
| G10 | Sprawiedliwość w przyszłości | `t_edge.py` | tak | 200, puste okno |
| G11 | Synchroniczny `/generate` | ręcznie | tak | **HGH5-04**, 504 po 90 s |

## H. Interfejs

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| H1 | axe-core, 7 ekranów, 2 motywy | `axe_scan.sh` | tak | zero naruszeń |
| H2 | Semantyka macierzy | przeglądarka | tak | poprawna |
| H3 | Widok mobilny 390x844 | przeglądarka | tak | bez przewijania poziomego |
| H4 | Panel ustawień generowania | przeglądarka | tak | MED5-02, MED5-03, LOW5-11 |
| H5 | Panel wpływu szkicu | przeglądarka | tak | **HGH5-05** |
| H6 | Ekran sprawiedliwości | przeglądarka | tak | MED5-05, LOW5-03 |
| H7 | Pasek postępu generowania | przeglądarka | tak | MED5-10 |
| H8 | Stany puste | przeglądarka | tak | poprawne |
| H9 | Pułapka fokusu i Escape w dialogach | - | **nie** | |
| H10 | Przeładowanie strony w trakcie generowania | przeglądarka | tak | postęp gubiony, wynik odzyskiwalny (MED5-11) |
| H12 | Nawigacja wstecz i przód z `?szkic=` | - | **nie** | |
| H11 | Aktywacja konta i reset hasła jako przepływ | - | **nie** | |

## I. Wydajność

| ID | Przypadek | Narzędzie | Wykonany | Wynik |
| --- | --- | --- | --- | --- |
| I1 | 10 użytkowników, odczyty, bez limitu CPU | `t_perf.py` | tak | 453,6 req/s |
| I2 | 10 użytkowników, raporty, bez limitu CPU | `t_perf.py` | tak | 89,9 req/s |
| I3 | 10 użytkowników, odczyty, 3 rdzenie | `t_perf.py` | tak | 342,5 req/s |
| I4 | 10 użytkowników, raporty, 3 rdzenie | `t_perf.py` | tak | 86,6 req/s |
| I5 | Ponad 10 użytkowników | - | **nie** | |
| I6 | Awaria workera w trakcie solvowania | - | **nie** | |
