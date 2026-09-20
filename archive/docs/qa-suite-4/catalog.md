# Katalog przypadków testowych QA4 (źródło: docs/PLAN.md)

## A. RBAC i sesja (PLAN par. 2)
A1 viewer widzi wyłącznie opublikowany grafik, bez szkiców, dostępności, punktów, zamian, ustawień
A2 member: własna dostępność, preferencje, zamiany, własny bilans; brak generatora i administracji
A3 coordinator: generowanie, porównanie, akceptacja, publikacja, zamiany; brak administracji kont
A4 admin: konta, role, eligibility, polityki, import, święta, audyt
A5 backend egzekwuje RBAC niezależnie od frontendu (bezpośrednie wywołania API cudzą rolą)
A6 sesja HttpOnly/SameSite=Lax, ochrona CSRF, blokada bez tokenu CSRF
A7 nieaktywne konto nie loguje się
A8 wylogowanie unieważnia sesję

## B. Reguły grafiku (PLAN par. 3)
B1 każdy dzień ma dokładnie jednego primary i secondary, zawsze różne osoby
B2 zmiana 11-19 istnieje wyłącznie w polskie dni robocze, także na drodze odczytu
B3 urlop/„nie mogę” to twarde ograniczenie; „wolę nie”/„chętnie wezmę” miękkie
B4 kotwiczenie 11-19: secondary, primary, independent
B5 max 3 dyżury on-call w dowolnych 7 dniach i 2 dni przerwy po serii (daily/hybrid)
B6 brak tych reguł w trybie weekly
B7 nierozdzielczość bloku weekend/święto
B8 eligibility wersjonowane per rola i zakres dat
B9 osoba wchodząca później zaczyna z neutralnym bilansem

## C. Workflow grafiku (PLAN par. 4)
C1 draft -> proposed -> published -> superseded, optimistic locking na każdym przejściu
C2 publikacja waliduje pełne pokrycie
C3 częściowe nakładanie rozstrzygane per slot, pokrycie poza zakresem zachowane
C4 sugerowany zakres: pierwszy dzień nieobjęty + niedziela po 4 pełnych tygodniach
C5 nazwa szkicu zawiera tryb i zakres DD-MM-YYYY
C6 ręczna korekta komórki szkicu nie regeneruje reszty i jest oznaczona
C7 usunięcie szkicu

## D. Zamiany (PLAN par. 4)
D1 pełna ścieżka: wybór -> zastępca -> podgląd wpływu -> zgoda -> akceptacja -> override
D2 oferowani tylko eligible, dostępni, niekolidujący z drugą rolą on-call
D3 odrzucenie z powodem przez zastępcę i koordynatora, wycofanie przez autora
D4 zatwierdzenie zmienia tylko wybrany slot i inkrementuje wersję
D5 punkty trafiają do osoby faktycznie dyżurującej

## E. Import historii (PLAN par. 4)
E1 podgląd wykrywa duplikaty, nieznane osoby, konflikty, 11-19 w dzień wolny
E2 import nie nadpisuje opublikowanego grafiku
E3 dopasowanie osoby po nazwie z uwzględnieniem wielkości liter

## F. Sprawiedliwość (PLAN par. 3 i 6)
F1 okno kroczące 12 miesięcy, 1X/2X bez kumulacji
F2 soczewki liczone osobno, weekend i święto nie dublują dnia
F3 udział oczekiwany proporcjonalny do okresu eligibility
F4 drill-down do konkretnych dyżurów
F5 member widzi tylko siebie
F6 opis słowny różnicy i wpływu na kolejne generowanie

## G. Generator (PLAN par. 3, 6, 8)
G1 preflight, postęp, odzyskanie wyniku po odświeżeniu
G2 porównanie wariantów
G3 nazwane konflikty zamiast cichego łamania reguł
G4 prognoza fairness dla szkicu i po każdej korekcie
G5 wagi 0-100, opis skutku, oddzielenie od reguł twardych
G6 zero luk i naruszeń twardych, 91 dni w budżecie
G7 brak niewyjaśnionej nierówności większej niż jeden dyżur 2X

## H. Raport miesięczny (PLAN par. 6)
H1 CSV z efektywnej wersji grafiku po override'ach
H2 święto w weekend liczone raz jako święto
H3 podgląd pokazuje kolumny decydujące o rozliczeniu

## I. ICS, linki, powiadomienia (PLAN par. 5)
I1 kanał ICS członka pokazuje wyłącznie jego dyżury
I2 link viewer ograniczony zakresem i wygaśnięciem, unieważnienie natychmiastowe
I3 outbox powiadomień zapisywany w tej samej transakcji

## J. Audyt (PLAN par. 2)
J1 rejestrowane logowania, dostępność, zamiany, generowanie, publikacja, override, polityki, import, konta
J2 filtrowanie działa dla każdej akcji
J3 etykieta aktora przeżywa usunięcie konta

## K. UI, dostępność, użyteczność (PLAN par. 6 i 7)
K1 bieżący primary i 11-19 odnajdywane w 5 sekund
K2 niedostępny weekend zgłoszony w 30 sekund
K3 jednodniowa zamiana wysłana w 60 sekund
K4 monospace wyłącznie dla dat, godzin, identyfikatorów, statusów
K5 brak gradientów, glassmorphismu, emoji
K6 kolor nigdy jedynym nośnikiem informacji
K7 pełna klawiatura, widoczny focus, alternatywa tabelaryczna
K8 kontrast obu motywów, prefers-reduced-motion
K9 brak pustych pozycji nawigacji dla niedostępnych funkcji
K10 responsywność, brak przewijania poziomego strony

## L. Wydajność
L1 10 równoczesnych użytkowników na ścieżkach odczytu
L2 raport miesięczny i bilans pod obciążeniem
L3 odczyty w trakcie generowania
L4 generowanie 28/56/91 dni, tryby, kotwice
L5 zużycie CPU i RAM wobec celu 2-4 rdzenie / 8 GB
