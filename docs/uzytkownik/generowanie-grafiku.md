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

Formularz „Nowy szkic” ma pola **Od** i **Do** oraz przycisk „Utwórz szkic”.

- Bez jawnego zakresu pola są wypełnione sugestią: pierwszy dzień nieobjęty
  opublikowanym grafikiem oraz niedziela zamykająca cztery pełne tygodnie.
- Zakres otwarty z kalendarza ma pierwszeństwo przed sugestią.
- **Maksymalnie 35 dni** na jedno uruchomienie. Dłuższy okres podziel na
  kolejne, zachodzące po sobie szkice.
- Zakres jednodniowy jest przyjmowany, ale ekran ostrzeże, że na jednym dniu
  nie ma czego bilansować.

Pod polami widać zapisane ustawienia (tryb rotacji i powiązanie `11–19`)
oraz informację, jeśli masz niezapisane zmiany w ustawieniach poniżej.

## W trakcie liczenia

Solver pracuje **poza procesem API**, więc podczas liczenia możesz korzystać z
pozostałych ekranów. Widać:

- pasek postępu i status (`W kolejce…` albo `Generuję…`),
- licznik sekund oraz budżet **na jeden przebieg solvera** i łączny limit
  generowania - trudny grafik wymaga kilku przebiegów, więc licznik
  przekraczający budżet pojedynczego przebiegu nie jest usterką,
- ostrzeżenie, jeśli przed początkiem szkicu zostają dni bez obsady.

Po odświeżeniu strony podgląd trwającego generowania wznawia się sam - **nie
uruchamiaj go drugi raz**.

## Wynik

Sekcja „Szkice” wypisuje istniejące szkice; kliknięcie otwiera wynik. Wynik ma
trzy części:

- **Macierz szkicu** - osoby × dni, w tej samej konwencji co opublikowany
  grafik: nagłówki zachowują dzień tygodnia, święto i 2X.
- **Problemy** - tabela wszystkiego, co wymaga uwagi przed publikacją: dyżury
  w dniu „nie mogę”, złamane reguły twarde, ostrzeżenia solvera, luki przed
  szkicem i informacja, że szkic jest nieaktualny. Przełącznik **wg osoby** /
  **wg reguły** grupuje wiersze, a przycisk **Popraw** przy wierszu otwiera
  właściwą komórkę macierzy. Pusta tabela znaczy, że szkic nie ma otwartych
  problemów.
- **Wpływ szkicu na sprawiedliwość** - dla każdej osoby bilans przed zakresem,
  bilans po uwzględnieniu szkicu i zmiana. Przelicza się po każdej Twojej
  korekcie, więc wpływ decyzji widzisz przed przekazaniem grafiku dalej.

Nagłówek wyniku podaje status solvera (`CP-SAT: OPTIMAL` i podobne) i etapy
cyklu szkicu. Status inny niż pełne rozwiązanie jest objaśniony słowami -
najczęściej znaczy, że budżet czasu był za krótki albo że reguły twarde są
sprzeczne z obsadą.

### Ręczna korekta komórki

Kliknij komórkę, w panelu dnia wybierz rolę i osobę, zapisz. Korekta:

- nie regeneruje pozostałych dni,
- podlega regułom twardym,
- korzysta z wersjonowania,
- jest oznaczona jako ręczna.

### Porównanie szkiców

Jeśli masz więcej niż jeden szkic, sekcja rozwijana pod listą szkiców zestawia
je i porównuje metryki, zanim wybierzesz ten do publikacji.

## Ustawienia generowania

Sekcja rozwijana „Ustawienia generowania” zapisuje ustawienia **globalnie dla
całego zespołu**; obowiązują od następnego generowania.

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

1. **Przekaż do akceptacji** - treść szkicu zostaje zamrożona.
2. **Opublikuj grafik…** - otwiera okno z podsumowaniem tego, co się zmieni,
   i wymaga jawnego potwierdzenia. Publikacja sprawdza pełne pokrycie zakresu;
   brak obsady któregokolwiek dnia zatrzymuje operację.
3. Grafik staje się widoczny dla wszystkich, rozchodzą się powiadomienia, a
   kanały ICS dostają aktualizacje.

Jeśli w międzyczasie ktoś zmienił grafik, okno publikacji wypisze każdą taką
zmianę z polem **Decyzja**, w którym wybierasz, która wersja ma obowiązywać -
dopiero wtedy publikuje. Szkic można też cofnąć przyciskiem **Wróć do szkicu**
albo usunąć z listy szkiców.

Publikacja zastępuje wyłącznie te opublikowane grafiki, które w całości mieszczą
się w nowym zakresie; częściowe nakładanie rozstrzyga się per slot, a pokrycie
poza nowym zakresem zostaje zachowane.
