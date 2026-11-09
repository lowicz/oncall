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
przechodzi do propozycji, ikona kosza usuwa szkic po potwierdzeniu, które podaje, ile ręcznych korekt
przepadnie razem z nim. Jeżeli masz szkice w
trybie dziennym i tygodniowym, rozwijana sekcja **Porównaj wariant dzienny i
tygodniowy** zestawia ich metryki, zanim wybierzesz ten do publikacji. Gdy
szkic każdego trybu jest tylko jeden, sekcja od razu wybiera oba i je porównuje;
przy kilku wybierasz parę i klikasz **Porównaj**.

## W trakcie liczenia

Solver pracuje **poza procesem API**, więc podczas liczenia możesz korzystać z
pozostałych ekranów. Tytuł ekranu zmienia się na „Generuję *zakres*”, a panel
postępu pokazuje:

- etapy **dane**, **solver**, **sprawiedliwość**, **propozycja** oraz status
  (`W kolejce…` albo `Generuję…`),
- licznik sekund oraz czas **jednej próby** i łączny limit generowania -
  trudny grafik wymaga kilku prób, więc licznik przekraczający czas
  pojedynczej próby nie jest usterką,
- ostrzeżenie, jeśli przed początkiem szkicu zostają dni bez obsady.

Po odświeżeniu strony podgląd trwającego generowania wznawia się sam - **nie
uruchamiaj go drugi raz**.

### Wydarzenia na szkicu

Macierz szkicu pokazuje wydarzenia kalendarza tak samo jak opublikowany grafik.
Kropka w kolorze wydarzenia pojawia się w każdej komórce tego dnia, a nazwa wydarzenia jest dostępna także dla czytnika ekranu.
Po otwarciu dnia panel wymienia jego wydarzenia z kolorowymi próbkami.
Lista jest tylko do odczytu - wydarzenia dodaje się i zmienia na ekranie **Wydarzenia**.

## Propozycja

Otwarty szkic to osobna strona. Tytułem jest zakres, a obok niego jedna
pigułka stanu z wersją: „Szkic · v2”, „Do akceptacji · v3” po przekazaniu,
„Opublikowany · v4” po publikacji. Pod tytułem są liczba przydziałów i dni
oraz tryb rotacji. Akcje w nagłówku to **Generuj nowy szkic** i menu **⋯**
(**Więcej**) z **Ustawieniami generatora**. **Generuj nowy szkic** tworzy
kolejny szkic dla tego samego zakresu i otwiera go; otwarty grafik, z
poprawkami, zostaje bez zmian, o czym mówi komunikat po wygenerowaniu.

Nad macierzą jest **jeden panel decyzji**:

- **werdykt** - liczba naruszeń reguł twardych i stan kryterium
  sprawiedliwości (spełnione, niespełnione albo niespełnione przez **nierówność
  sprzed szkicu**),
- **dlaczego** - osoby, które mają dyżur w dniu „nie mogę” i blokują
  publikację, z rolą i dniem; przy niepełnym rozwiązaniu solvera wskazówka,
  aby kliknąć komórkę z luką i wpisać osobę; pod spodem rozrzut punktów przed
  i po szkicu,
- **jedna akcja główna**: **Popraw *N* problemy** otwiera pierwszą kolidującą
  komórkę (potem **Opublikuj…**), w poprawnym szkicu **Opublikuj…**, a w
  propozycji **Publikuj v*N*…** obok **Wróć do szkicu** (propozycja z
  dyżurem w dniu „nie mogę” ma tylko **Wróć do szkicu**). Obok
  **Opublikuj…** menu **⋯** (**Inne akcje**) ma **Przekaż do akceptacji** dla
  zespołów, w których szkic sprawdza druga osoba.

Propozycja ma w tym panelu także ramkę **Co zmieni publikacja**: ile zmian
zostanie przeniesionych, ile oczekujących zamian anulowanych, ile wpisów
zmieniło się od wygenerowania i ile ostrzeżeń miękkich trafi do audytu.
Rozwijana lista wymienia przeniesione zmiany i anulowane zamiany. Widzisz to,
zanim otworzysz arkusz publikacji.

Pod panelem jeden rząd znaczników streszcza szkic: obsada, ostrzeżenia
miękkie (kliknięcie otwiera zakładkę **Problemy**) oraz role, weekendy i
święta zebrane w dwie grupy, spełniające i niespełniające kryterium
sprawiedliwości.

Niżej **Proponowana obsada** - macierz osoby × dni, w tej samej konwencji co
opublikowany grafik: nagłówki zachowują dzień tygodnia, święto i 2X, a dzień,
w którym brakuje `PRIMARY` albo `SECONDARY`, ma nagłówek oznaczony jako luka;
link **Legenda** objaśnia oznaczenia.

Pod macierzą cztery zakładki:

- **Problemy** - tabela wszystkiego, co wymaga uwagi przed publikacją: dyżury
  w dniu „nie mogę”, złamane reguły twarde, ostrzeżenia solvera, luki przed
  szkicem i informacja, że szkic jest nieaktualny. Przełącznik **Wg osoby** /
  **Wg reguły** grupuje wiersze, **Tylko twarde** ukrywa ostrzeżenia miękkie,
  a przycisk **Popraw** przy wierszu otwiera właściwą komórkę macierzy: przy
  dyżurze w dniu „nie mogę” ten dyżur, przy złamanej regule twardej dyżur
  tej osoby w pierwszym dniu, którego reguła dotyczy. Wiersze całego szkicu
  (ostrzeżenia solvera, luki, nieaktualność) nie mają jednej komórki, więc nie
  mają przycisku. Dyżur w dniu „nie mogę” blokuje publikację, a złamana reguła
  twarda wymaga zgody w oknie publikacji. Stopka tabeli wylicza reguły twarde
  i prowadzi do ich pełnego opisu. Na telefonie tabela staje się listą kart:
  rodzaj, osoba z dniem i rolą, szczegół, a pod nim przycisk.
- **Sprawiedliwość** - rozrzut punktów jako jedna liczba z wartością sprzed
  szkicu i znacznikiem **lepiej** / **gorzej**, pod nią werdykt, dalej
  kryterium odbioru w każdej roli, w weekendy i święta oraz tabela osób z
  odchyleniem po publikacji. Przelicza się po każdej Twojej korekcie. Werdykt
  odróżnia dwie sytuacje: gdy rola, weekendy albo święta były poza kryterium
  już przed szkicem, to **nierówność sprzed szkicu** - generator wyrównuje ją
  po trochu, a panel podaje, o ile szkic zmniejsza rozrzut i jaka rozpiętość
  jest w tym zakresie w ogóle osiągalna; poprawianie komórek ani ponowne
  generowanie tej nierówności nie usunie. Gdy zaś rola, weekendy albo święta,
  które przed szkicem mieściły się w kryterium, po publikacji je przekraczają,
  to wada szkicu i wtedy warto poprawić komórki albo wygenerować ponownie.
- **Ustawienia** - to, co zapamiętał szkic: zakres, wersja, tryb rotacji,
  wynik solvera słowami - „rozwiązanie optymalne”, „najlepsze znalezione w
  limicie czasu” albo „bez pełnego rozwiązania” - i jakość sprawiedliwości.
  Link **Szczegóły solvera** obok wyniku pokazuje status silnika
  (`CP-SAT: OPTIMAL` i podobne) i lukę do najlepszego możliwego rozwiązania.
  Wagi, powiązanie `11–19` i budżet solvera są ustawieniami zespołu i mają
  jedno miejsce: **Zmień ustawienia i generuj…** otwiera panel ustawień.
- **Szkice** - lista szkiców, więc przełączasz się między nimi bez wracania na
  stronę startową.

### Ręczna korekta komórki

Kliknij komórkę, a panel dnia (tytuł „Wstaw: *osoba* · *dzień*”) otworzy się
na roli z tej komórki. Grupa **Role do zmiany** działa jak w inspektorze dnia
opublikowanego grafiku: PRIMARY i SECONDARY wykluczają się, a `11–19` jest
zaznaczona od razu, gdy powiązanie `11–19` wiąże ją z zaznaczoną rolą i jej
obecna osoba ma obie; w dzień wolny `11–19` nie ma. Zaznaczone role dostaje
osoba z klikniętego wiersza. Pod grupą podgląd pokazuje rola po roli, kto ma
ją teraz i kto po korekcie, a niżej bilans tej osoby w każdej roli; zapisuje
**Przypisz w szkicu**, przy dwóch rolach **Przypisz w szkicu (2 role)**. Gdy
nie ma czego wstawić, panel ma tytuł „*osoba* · *dzień*”, a przycisk jest
wyłączony: osoba już ma te role, zaznaczyła „nie mogę” albo nie może objąć
którejś z nich - wtedy powód stoi pod grupą, np. brak uprawnień do `11–19`
albo drugi on-call tego dnia. Zaznaczenie zostaje, więc odznacz rolę albo
kliknij komórkę innej osoby. Korekta może też obsadzić rolę, którą solver
zostawił pustą: kliknij dowolną pustą komórkę dnia oznaczonego jako luka, a
panel otworzy się na pustej roli i pokaże „brak obsady → *osoba*”.

Gdy PRIMARY i SECONDARY dnia mają różne osoby, panel ma też **Zamień
miejscami…**. Ramka „Zamiana miejscami” pokazuje obie role po zamianie, a gdy
polityka wiąże `11–19` z rolą, którą oddaje osoba pełniąca też `11–19`, pole
„razem z SECONDARY” (albo „razem z PRIMARY”), zaznaczone, gdy druga osoba ma
uprawnienia do `11–19`; odznaczenie zostawia `11–19` bez zmian. W szkicu zamiana nie
sprawdza reguł twardych w ramce i nie wysyła e-maili: to, co złamie, pokaże
tabela problemów. **Zamień miejscami** zapisuje obie role (i `11–19`) jedną
korektą. Każda korekta, także zamiana:

- nie regeneruje pozostałych dni,
- podlega regułom twardym,
- korzysta z wersjonowania,
- jest oznaczona jako ręczna,
- nie oznacza szkicu jako nieaktualnego: to ostrzeżenie dotyczy tylko zmian
  poza szkicem, np. dostępności wpisanej po wygenerowaniu,
- kończy się powiadomieniem, co zmieniono i ile problemów zostało w szkicu;
  jego przycisk **Cofnij** przez kilka sekund przywraca poprzednie osoby
  wszystkich zmienionych ról (komórki zostają oznaczone jako ręczne).
  Przycisku nie ma, gdy poprzedniej osoby którejś z ról nie ma już w zespole,
  np. po zakończeniu jej rotacji albo usunięciu konta, gdy nie może tego dnia
  wrócić do roli (jest niedostępna albo nie ma do niej uprawnień), ani po
  obsadzeniu pustej roli - wtedy popraw komórkę ponownie albo wygeneruj szkic
  od nowa.

## Ustawienia generatora

Przycisk **Ustawienia generatora** otwiera panel boczny z zakresem **Od** /
**Do** i ustawieniami solvera. To jedyne miejsce, w którym je zmieniasz;
zapisują się **globalnie dla całego zespołu** i obowiązują od następnego
generowania. Stopka ma jeden przycisk główny: bez zmian **Generuj** uruchamia
generowanie od razu z zakresem z panelu, a przy niezapisanych zmianach
**Zapisz i generuj** zapisuje je i generuje jednym kliknięciem. **Zapisz**
tylko zapisuje, a ikona strzałki (**Przywróć zapisane**) cofa niezapisane
zmiany. Zasady działania wag wyjaśnia link **Jak działają wagi**. Pod osobnym
nagłówkiem **Polityka zamian** jest przełącznik zatwierdzania zamian przez
koordynatora; nie wpływa na generowanie.
Zamknięcie panelu, przejście na inny ekran, odświeżenie albo otwarcie innego szkicu przy niezapisanych ustawieniach wymaga decyzji, czy je odrzucić.
Zapis potwierdza powiadomienie „Zapisano ustawienia generowania”.

| Ustawienie | Zakres | Uwagi |
| --- | --- | --- |
| Tryb rotacji | hybrydowy / dzienny / tygodniowy | tryb tygodniowy wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek |
| Powiązanie `11–19` | `SECONDARY` / `PRIMARY` / niezależnie | twarde dla osób eligible do obu ról |
| Równy udział | 0-100 | domyślnie najwyższy priorytet |
| Preferencje zespołu | 0-100 | domyślnie środkowy |
| Ciągłość rotacji | 0-100 | domyślnie najniższy |
| Budżet czasu na przebieg solvera | 5-300 s | domyślnie 15 |
| Zamiana dyżuru wymaga zatwierdzenia koordynatora | włączone / wyłączone | domyślnie włączone; wyłączone wpisuje zamianę do grafiku od razu po akceptacji zastępcy, a koordynatorzy dostają tylko powiadomienie ([Zamiany](zamiany.md#zatwierdzenie-koordynatora)) |

Wagi zmieniają **względny** priorytet reguł miękkich: 6 / 4 / 2 działa tak samo
jak 3 / 2 / 1. Wartość `0` wyłącza dany człon celu. Wagi **nie mogą** wyłączyć
eligibility, niedostępności ani wymaganego pokrycia.

Tryb tygodniowy pokazuje osobne ostrzeżenie z mierzonymi skutkami (serie
12-dniowe, okna z ponad trzema dyżurami) - włączaj go świadomie.

## Publikacja

```
Szkic ──► Do akceptacji ──► Opublikowany
```

1. **Opublikuj…** w poprawnym szkicu przekazuje go do akceptacji w tle,
   sprawdza skutki publikacji i dopiero wtedy otwiera arkusz „Publikuję szkic
   v*N* · *zakres*”. Zamknięcie arkusza bez publikacji (**Wróć do szkicu**)
   albo przejście do innego szkicu lub ekranu cofa przekazanie, więc szkic zostaje taki,
   jak był. Błąd przekazania albo sprawdzenia pojawia się w panelu decyzji, a
   szkic wraca do stanu sprzed kliknięcia.
   **Przekaż do akceptacji** z menu **⋯** zamraża treść szkicu bez
   publikacji, a tytuł zmienia się na „Propozycja”; propozycję publikuje
   potem **Publikuj v*N*…** w panelu decyzji, w arkuszu „Publikuję propozycję
   v*N* · *zakres*”.
2. Arkusz za każdym otwarciem sprawdza publikację od nowa, a otwarty
   ponawia sprawdzenie po powrocie do karty przeglądarki;
   dopóki sprawdza, mówi to obok przycisków, a **Publikuj v*N*** czeka.
   Arkusz zawiera: jedno zdanie skutku (ile przydziałów stanie się grafikiem,
   e-mail do zespołu, aktualizacja kanałów ICS, cofnięcie tylko nową
   publikacją), tę samą ramkę **Co zmieni publikacja** co strona propozycji
   (przeniesione zmiany, anulowane zamiany, wpisy zmienione od wygenerowania,
   ostrzeżenia do audytu), a pod nią to, co trzeba rozstrzygnąć: konflikty ze
   zmianami z licznikiem „Do rozstrzygnięcia”, zgody i - jeśli zakres już się
   zaczął - pole, że zespół zobaczy zmianę od razu. Naruszenia reguł
   odpoczynku i luka przed grafikiem mają każde własną ramkę z polem wyboru
   („Rozumiem i świadomie łamię te reguły”, „Rozumiem, że te dni zostają bez
   obsady”). Obok przycisków arkusz mówi, czego jeszcze brakuje („Do
   rozstrzygnięcia: 1 konflikt, 2 zgody.”), a **Publikuj v*N*** działa dopiero,
   gdy niczego nie brakuje. **Wróć do propozycji** zamyka arkusz otwarty z
   propozycji bez zmian.
   Publikacja sprawdza pełne pokrycie zakresu; brak obsady któregokolwiek
   dnia zatrzymuje operację.
3. Grafik staje się widoczny dla wszystkich, rozchodzą się powiadomienia, a
   kanały ICS dostają aktualizacje. Powiadomienie „Opublikowano v*N* ·
   *zakres*” mówi to samo i ma przycisk **Otwórz grafik**.

Przekazanie do akceptacji z menu **⋯** i powrót do szkicu też kończą się
powiadomieniem z zakresem („Przekazano do akceptacji: 4 – 31 paź”).
Przekazanie w tle i jego cofnięcie po zamknięciu arkusza nie mają
powiadomienia.

Jeśli w międzyczasie ktoś zmienił grafik albo zatwierdzona zamiana koliduje
ze szkicem, arkusz publikacji wypisze każdy taki przypadek (dzień, rola, kto
jest w korekcie albo zamianie, a kto w szkicu) z polem **Decyzja**:
„Zachowaj korektę: *osoba*” albo „Zachowaj zamianę: *osoba*” wobec „Zachowaj
szkic: *osoba*”. Dopiero po rozstrzygnięciu wszystkich arkusz publikuje. Propozycję można też cofnąć przyciskiem **Wróć do szkicu** albo
usunąć z listy szkiców.

Błąd publikacji pozostaje w otwartym arkuszu jako alarm z komunikatem i następnym krokiem.
Błąd usunięcia szkicu pozostaje w oknie potwierdzenia, które wywołało operację.

Publikacja zastępuje wyłącznie te opublikowane grafiki, które w całości mieszczą
się w nowym zakresie; częściowe nakładanie rozstrzyga się per slot, a pokrycie
poza nowym zakresem zostaje zachowane.
