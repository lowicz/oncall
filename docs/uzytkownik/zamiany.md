# Zamiany

Ekran **Zamiany** (`/zamiany`) obsługuje zastępstwa na konkretny dzień i rolę,
także wtedy, gdy bazowa rotacja jest tygodniowa.

## Skrzynka

Wszystkie wnioski są w jednej tabeli; filtry w nagłówku sekcji **Skrzynka**
mówią, na kogo dana sprawa czeka, a licznik przy każdym filtrze - ile ich jest:

| Filtr | Co zawiera |
| --- | --- |
| **Do mnie** | wnioski, w których to Ty masz przyjąć albo odrzucić zastępstwo |
| **Moje** | Twoje własne, jeszcze otwarte prośby |
| **Do zatwierdzenia** (u członka zespołu: **W toku**) | pozostałe otwarte wnioski; u koordynatora licznik obejmuje tylko wnioski przyjęte przez zastępcę, czekające na jego zatwierdzenie |
| **Zamknięte** | zatwierdzone, odrzucone i wycofane |

Ekran otwiera się na skrzynce, w której coś na Ciebie czeka; adres
`/zamiany?skrzynka=moje` otwiera wskazaną. Suma spraw wymagających Twojej
akcji pojawia się także jako znacznik przy pozycji „Zamiany” w nawigacji.

Wiersz tabeli podaje dzień i rolę, kto oddaje, kto przejmuje, **skutek** (osoba,
która zyska punkty, i ile) oraz **etap** - kto jest następny. Przycisk
**Zdecyduj** (gdy decyzja należy do Ciebie) albo **Podgląd** otwiera arkusz
sprawy.

## Arkusz decyzji

Arkusz pokazuje obie osoby, dyżur, powód wnioskodawcy, pasek etapów
(złożona → zastępca → koordynator → w grafiku), **Wpływ na bilans** obu osób i
ostrzeżenia. Decyzję podejmujesz w tym samym miejscu:

- **Zastępca** klika „Akceptuję” albo „Odrzuć”.
- **Koordynator lub administrator** klika „Zatwierdź i wpisz do grafiku” albo
  „Odrzuć”.
- **Autor** może „Wycofać” własną prośbę, dopóki nie zapadła decyzja.

Odrzucenie i wycofanie wymagają **podania powodu** w polu widocznym od razu w
arkuszu; powód widzą obie strony, zostaje przy wniosku i w audycie. Przycisk
„Odrzuć” jest nieaktywny, dopóki powód jest pusty.

## Zgłoszenie prośby

Przycisk **Nowa zamiana** w nagłówku ekranu otwiera formularz w panelu; przycisk
**Poproś o zamianę** na ekranie Moje otwiera go z wybranym dyżurem. Formularz
prowadzi przez trzy kroki: dyżur, kandydat, powód i wysłanie.

1. W polu **Mój dyżur** wybierz swój nadchodzący dyżur. Lista podaje datę,
   rolę i jak daleko jest ten dzień. Dyżur kolidujący z Twoim wpisem
   „nie mogę” jest oznaczony.
2. Pod polem pojawia się lista **Kandydaci**: osoby eligible i dostępne, które
   nie mają tego dnia przeciwnej roli, uszeregowane od najlepszego kandydata.
   Przy każdej widać jej dostępność, odchylenie od należnego udziału i to, czy
   ma już tego dnia dyżur - dzięki temu dwóch kandydatów porównasz bez
   otwierania każdego z osobna. Kliknięcie wybiera osobę.
   - osoba oznaczona **„nie można: …”** jest zablokowana regułą twardą i nie da
     się jej wybrać,
   - oznaczenie **„poprawia bilans”** mówi, że zamiana zmniejszy nierówność,
   - oznaczenie **„dzieli blok dni wolnych”** zapowiada ostrzeżenie dla
     koordynatora.
3. Pod listą zobaczysz **Wpływ na bilans**: ile punktów przechodzi między
   Wami.
4. Opcjonalnie dopisz **Powód**; zobaczą go zastępca i koordynator.
5. „Wyślij prośbę”. Ekran potwierdza wysłanie komunikatem „Wysłano do: …” i
   przechodzi do skrzynki **Moje**.

Jeśli ustawienie „Powiązanie 11–19” sprawia, że tego dnia obie role należą do
jednej osoby, prośba obejmie **oba sloty naraz** - ekran to zapowiada. Jedna
akceptacja zastępcy i jedno zatwierdzenie koordynatora załatwiają całość.

Gdy zamiana narusza regułę miękką (na przykład dzieli blok dni wolnych),
zobaczysz ostrzeżenie „Wyślesz mimo to - koordynator zobaczy ostrzeżenie”.
Wysłanie jest nadal możliwe.

## Ścieżka decyzji

```
zgłoszenie ──► Oczekuje na zastępcę ──► Oczekuje na koordynatora ──► Zatwierdzona
                    │                          │
                    └── Odrzucona              └── Odrzucona
 autor w każdej chwili: Wycofana
```

## Co robi zatwierdzenie

- tworzy korektę (override) wyłącznie na wybranym dniu i wybranej roli,
- **nie przelicza** pozostałych dni grafiku,
- podnosi wersję opublikowanego grafiku,
- rozsyła powiadomienia i aktualizuje kanały ICS,
- przypisuje punkty (X / 2X) osobie **faktycznie dyżurującej**,
- wysyła przypomnienie o przełączeniu numeru.

## Termin minął

Wniosek dotyczący dnia, który już był, dostaje w tabeli dopisek **„termin
minął”** i traci przyciski decyzji. Nie da się zaakceptować zastępstwa wstecz -
taki dzień poprawia koordynator korektą na macierzy.
