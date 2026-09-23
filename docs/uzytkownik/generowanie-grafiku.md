# Generowanie grafiku

Ekran **Generator** (`/generator`) jest dostępny dla koordynatora i
administratora. Wynik generatora jest **szkicem** i nie zastępuje
opublikowanego grafiku, dopóki go świadomie nie opublikujesz.

## Zanim wygenerujesz

Sprawdź trzy rzeczy - po wygenerowaniu poprawianie ich kosztuje więcej:

1. **Zespół i eligibility** są aktualne (ekran „Osoby”).
2. **Dostępność** jest zgłoszona za okres, który chcesz objąć.
3. **Historia** jest zaimportowana, jeśli uruchamiasz aplikację pierwszy raz -
   bez niej bilans startuje od zera i pierwszy grafik nie ma czego wyrównywać.

## Nowy szkic

Strona startowa generatora ma formularz **Nowy szkic** z polami **Od** i
**Do** oraz przyciskiem **Utwórz szkic**, a pod nim listę **Szkice**.
Przycisk **Ustawienia generatora** w nagłówku otwiera panel boczny z
ustawieniami (opisany niżej).

- Bez jawnego zakresu pola są wypełnione sugestią: pierwszy dzień nieobjęty
  opublikowanym grafikiem oraz niedziela zamykająca cztery pełne tygodnie.
- Zakres otwarty z kalendarza ma pierwszeństwo przed sugestią.
- **Maksymalnie 35 dni** na jedno uruchomienie. Dłuższy okres podziel na
  kolejne, zachodzące po sobie szkice.
- Zakres jednodniowy jest przyjmowany, ale ekran ostrzeże, że na jednym dniu
  nie ma czego bilansować.

Pod polami widać zapisane ustawienia (tryb rotacji i powiązanie `11–19`)
oraz informację, jeśli masz niezapisane zmiany w panelu ustawień.

Lista **Szkice** wypisuje istniejące szkice ze stanem (`SZKIC`, `DO
AKCEPTACJI`), wersją, liczbą przydziałów i datą utworzenia. **Otwórz**
przechodzi do propozycji, ikona kosza usuwa szkic. Jeżeli masz szkice w
trybie dziennym i tygodniowym, rozwijana sekcja **Porównaj wariant dzienny i
tygodniowy** zestawia ich metryki, zanim wybierzesz ten do publikacji.

## W trakcie liczenia

Solver pracuje **poza procesem API**, więc podczas liczenia możesz korzystać z
pozostałych ekranów. Tytuł ekranu zmienia się na „Generuję *zakres*”, a panel
postępu pokazuje:

- etapy **dane**, **solver**, **sprawiedliwość**, **propozycja** oraz status
  (`W kolejce…` albo `Generuję…`),
- licznik sekund oraz budżet **na jeden przebieg solvera** i łączny limit
  generowania - trudny grafik wymaga kilku przebiegów, więc licznik
  przekraczający budżet pojedynczego przebiegu nie jest usterką,
- ostrzeżenie, jeśli przed początkiem szkicu zostają dni bez obsady.

Po odświeżeniu strony podgląd trwającego generowania wznawia się sam - **nie
uruchamiaj go drugi raz**.

## Propozycja

Otwarty szkic to osobna strona. Tytuł mówi, na jakim etapie jest wynik:
„Szkic *zakres*”, „Propozycja *zakres*” po przekazaniu do akceptacji, „Grafik
*zakres*” po publikacji. Pod tytułem są: znacznik stanu, wersja, liczba
przydziałów i dni, tryb rotacji oraz status solvera (`CP-SAT: OPTIMAL` i
podobne; status inny niż pełne rozwiązanie jest objaśniony słowami -
najczęściej znaczy, że budżet czasu był za krótki albo że reguły twarde są
sprzeczne z obsadą). Niżej rząd etapów cyklu (Szkic, Do akceptacji,
Opublikowany) i **Stan szkicu** w czterech znacznikach: obsada, reguły twarde,
ostrzeżenia miękkie i rozrzut punktów po publikacji.

Akcje w nagłówku: **Ustawienia generatora**, **Generuj ponownie**, a dalej
**Przekaż do akceptacji** dla szkicu albo **Wróć do szkicu** i **Publikuj…**
dla propozycji.

Strona ma dwie kolumny. Po lewej:

- **Proponowana obsada** - macierz osoby × dni, w tej samej konwencji co
  opublikowany grafik: nagłówki zachowują dzień tygodnia, święto i 2X; link
  **Legenda** objaśnia oznaczenia.
- **Problemy** - tabela wszystkiego, co wymaga uwagi przed publikacją: dyżury
  w dniu „nie mogę”, złamane reguły twarde, ostrzeżenia solvera, luki przed
  szkicem i informacja, że szkic jest nieaktualny. Przełącznik **Wg osoby** /
  **Wg reguły** grupuje wiersze, **Tylko twarde** ukrywa ostrzeżenia miękkie,
  a przycisk **Popraw** przy wierszu otwiera właściwą komórkę macierzy. Stopka
  tabeli wylicza reguły twarde i prowadzi do ich pełnego opisu.

Po prawej:

- **Sprawiedliwość po publikacji** - rozrzut punktów jako jedna liczba z
  wartością sprzed szkicu i znacznikiem **lepiej** / **gorzej**, kryterium
  odbioru na każdej soczewce, tabela osób z odchyleniem po publikacji i
  werdykt. Przelicza się po każdej Twojej korekcie, więc wpływ decyzji widzisz
  przed przekazaniem grafiku dalej. Werdykt odróżnia dwie sytuacje: gdy
  soczewki poza kryterium były poza nim już przed szkicem, to **zastany dług
  historyczny** - szkic go spłaca w ograniczonym tempie, a panel podaje, o ile
  zmniejsza rozrzut i jaka rozpiętość jest w tym zakresie w ogóle osiągalna;
  poprawianie komórek ani ponowne generowanie tego długu nie usunie. Gdy zaś
  soczewka, która przed szkicem mieściła się w kryterium, po publikacji je
  przekracza, to wada szkicu i wtedy warto poprawić komórki albo wygenerować
  ponownie.
- **Ustawienia tej propozycji** - zakres, wersja, tryb rotacji, powiązanie
  `11–19`, wagi i budżet solvera; **Zmień i generuj ponownie** otwiera panel
  ustawień.

Lista **Szkice** jest także pod propozycją, więc przełączasz się między
szkicami bez wracania na stronę startową.

### Ręczna korekta komórki

Kliknij komórkę, w panelu dnia wybierz rolę i osobę, zapisz. Korekta:

- nie regeneruje pozostałych dni,
- podlega regułom twardym,
- korzysta z wersjonowania,
- jest oznaczona jako ręczna,
- nie oznacza szkicu jako nieaktualnego: to ostrzeżenie dotyczy tylko zmian
  poza szkicem, np. dostępności wpisanej po wygenerowaniu.

## Ustawienia generatora

Przycisk **Ustawienia generatora** otwiera panel boczny z zakresem **Od** /
**Do** i ustawieniami solvera. **Zapisz ustawienia generowania** zapisuje je
**globalnie dla całego zespołu**; obowiązują od następnego generowania.
**Generuj** uruchamia generowanie od razu z zakresem z panelu, a **Przywróć
zapisane** cofa niezapisane zmiany.

| Ustawienie | Zakres | Uwagi |
| --- | --- | --- |
| Tryb rotacji | hybrydowy / dzienny / tygodniowy | tryb tygodniowy wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek |
| Powiązanie `11–19` | `SECONDARY` / `PRIMARY` / niezależnie | twarde dla osób eligible do obu ról |
| Równy udział | 0-100 | domyślnie najwyższy priorytet |
| Preferencje zespołu | 0-100 | domyślnie środkowy |
| Ciągłość rotacji | 0-100 | domyślnie najniższy |
| Budżet czasu na przebieg solvera | 5-300 s | domyślnie 15 |

Wagi zmieniają **względny** priorytet reguł miękkich: 6 / 4 / 2 działa tak samo
jak 3 / 2 / 1. Wartość `0` wyłącza dany człon celu. Wagi **nie mogą** wyłączyć
eligibility, niedostępności ani wymaganego pokrycia.

Tryb tygodniowy pokazuje osobne ostrzeżenie z mierzonymi skutkami (serie
12-dniowe, okna z ponad trzema dyżurami) - włączaj go świadomie.

## Publikacja

```
Szkic ──► Do akceptacji ──► Opublikowany
```

1. **Przekaż do akceptacji** - treść szkicu zostaje zamrożona, a tytuł
   zmienia się na „Propozycja”.
2. **Publikuj…** - otwiera arkusz „Publikuję propozycję v*N* · *zakres*” z
   listą skutków: ile przydziałów stanie się grafikiem, co z wcześniejszymi
   grafikami, ile ostrzeżeń miękkich trafi do audytu jako zaakceptowane i ile
   oczekujących zamian zostanie anulowanych. Jeżeli zakres już się zaczął,
   trzeba dodatkowo zaznaczyć, że zespół zobaczy zmianę od razu. Publikuje
   przycisk **Publikuj v*N***; **Wróć do propozycji** zamyka arkusz bez zmian.
   Publikacja sprawdza pełne pokrycie zakresu; brak obsady któregokolwiek
   dnia zatrzymuje operację.
3. Grafik staje się widoczny dla wszystkich, rozchodzą się powiadomienia, a
   kanały ICS dostają aktualizacje.

Jeśli w międzyczasie ktoś zmienił grafik albo zatwierdzona zamiana koliduje
ze szkicem, arkusz publikacji wypisze każdy taki przypadek z polem
**Decyzja**, w którym wybierasz, która wersja ma obowiązywać - dopiero wtedy
publikuje. Propozycję można też cofnąć przyciskiem **Wróć do szkicu** albo
usunąć z listy szkiców.

Publikacja zastępuje wyłącznie te opublikowane grafiki, które w całości mieszczą
się w nowym zakresie; częściowe nakładanie rozstrzyga się per slot, a pokrycie
poza nowym zakresem zostaje zachowane.
