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
| **Do zatwierdzenia** (u członka zespołu: **W toku**) | pozostałe otwarte wnioski; u koordynatora licznik obejmuje tylko wnioski przyjęte przez zastępcę, czekające na jego zatwierdzenie. Gdy zatwierdzanie zamian jest wyłączone (patrz [Zatwierdzenie koordynatora](#zatwierdzenie-koordynatora)), także koordynator widzi tu zwykłe **W toku** |
| **Zamknięte** | zatwierdzone, odrzucone i wycofane, także zamknięte przez aplikację [po terminie](#termin-minął) |

Ekran otwiera się na skrzynce, w której coś na Ciebie czeka; adres
`/zamiany?skrzynka=moje` otwiera wskazaną. Suma spraw wymagających Twojej
akcji pojawia się także jako znacznik przy pozycji „Zamiany” w nawigacji.

Wiersz tabeli podaje dzień i role, które przechodzą, kto oddaje, kto przejmuje, **skutek** (osoba,
która zyska punkty, i ile; „bez zmian”, gdy nikt) oraz **etap** - kto jest
następny. [Wymiana](#wymiana-dyżur-za-dyżur) ma w pierwszej kolumnie oba dni. Znacznik
**„łamie reguły”** oznacza wniosek opisany w części
[Zamiana łamiąca reguły](#zamiana-łamiąca-reguły). Przycisk **Zdecyduj** (gdy
decyzja należy do Ciebie) albo **Podgląd** otwiera arkusz sprawy.

## Arkusz decyzji

Arkusz pokazuje obie osoby, dyżur, powód wnioskodawcy, pasek etapów
(złożona → zastępca → koordynator → w grafiku; etap „koordynator” znika, gdy
zatwierdzanie zamian jest wyłączone), **Wpływ na bilans** obu osób, reguły,
które zamiana łamie, i ostrzeżenia. Przy [wymianie](#wymiana-dyżur-za-dyżur)
zamiast dwóch osób pokazuje dwa dyżury: oddawany i brany w zamian. Decyzję
podejmujesz w tym samym miejscu:

- **Zastępca** klika „Akceptuję” albo „Odrzuć”. Przy wyłączonym zatwierdzaniu
  arkusz zapowiada, że akceptacja od razu wpisze zamianę do grafiku.
- **Koordynator lub administrator** klika „Zatwierdź i wpisz do grafiku” albo
  „Odrzuć” - tylko gdy zatwierdzanie zamian jest włączone.
- **Autor** może „Wycofać” własną prośbę, dopóki nie zapadła decyzja.

Odrzucenie i wycofanie wymagają **podania powodu** w polu widocznym od razu w
arkuszu; powód widzą obie strony, zostaje przy wniosku i w audycie. Przycisk
„Odrzuć” jest nieaktywny, dopóki powód jest pusty.

## Zgłoszenie prośby

Przycisk **Nowa zamiana** w nagłówku ekranu otwiera formularz w panelu; przycisk
**Poproś o zamianę** na ekranie Moje otwiera go z wybranym dyżurem. Formularz
prowadzi przez cztery kroki: dyżur, kandydat, w zamian, powód i wysłanie.

1. W polu **Mój dyżur** wybierz swój nadchodzący dyżur. Lista ma jedną pozycję
   na dzień: datę, wszystkie Twoje role tego dnia (na przykład „SECONDARY +
   11–19”) i jak daleko jest ten dzień. Dyżur kolidujący z Twoim wpisem
   „nie mogę” jest oznaczony. Dzień z dwiema rolami ma pod polem wybór
   **Oddaję** (patrz niżej).
2. Pod polem pojawia się lista **Kandydaci**: osoby eligible i dostępne, które
   nie mają tego dnia przeciwnej roli, uszeregowane od najlepszego kandydata.
   Przy każdej widać jej dostępność, odchylenie od należnego udziału i to, czy
   ma już tego dnia dyżur - dzięki temu dwóch kandydatów porównasz bez
   otwierania każdego z osobna. Kliknięcie wybiera osobę.
   - osoba oznaczona **„nie można: …”** jest zablokowana regułą, której
     zamiana nie może złamać, i nie da się jej wybrać,
   - osoba oznaczona **„łamie regułę: …”** i **„wymaga potwierdzenia”** jest do
     wyboru, ale prośba wymaga wtedy potwierdzenia (patrz
     [Zamiana łamiąca reguły](#zamiana-łamiąca-reguły)); takie osoby są na
     liście za tymi, które żadnej reguły nie łamią,
   - oznaczenie **„poprawia bilans”** mówi, że zamiana zmniejszy nierówność,
   - oznaczenie **„dzieli blok dni wolnych”** zapowiada ostrzeżenie dla
     koordynatora,
   - dopisek **„przejmie tylko SECONDARY, nie pełni 11–19”** (z nazwą Twojej
     roli on-call) przy całym dyżurze mówi, że ta osoba nie może pełnić zmiany
     11–19: przejmie samą rolę on-call, a zmiana zostaje u Ciebie. To wyjątek
     od powiązania, który daje tylko ostrzeżenie.
3. Opcjonalnie wybierz na liście **W zamian biorę** dyżur tej osoby, który
   weźmiesz w zamian (patrz [Wymiana dyżur za dyżur](#wymiana-dyżur-za-dyżur)).
   Bez wyboru prośba dotyczy tylko oddania dyżuru.
4. Pod listą zobaczysz **Wpływ na bilans**: ile punktów przechodzi między
   Wami, policzone dla wszystkich przenoszonych slotów.
5. Opcjonalnie dopisz **Powód**; zobaczą go zastępca i koordynator. Powód nie
   jest wymagany, także gdy zamiana łamie reguły.
6. „Wyślij prośbę”. Ekran potwierdza wysłanie komunikatem „Wysłano do: …” i
   przechodzi do skrzynki **Moje**.

Gdy tego dnia masz rolę on-call i zmianę 11–19, pod polem **Mój dyżur**
pojawia się wybór **Oddaję**: „Cały dyżur”, „Tylko SECONDARY” (albo „Tylko
PRIMARY” - nazwa Twojej roli tego dnia) i „Tylko 11–19”. Podpowiedź pod nim
mówi, co przechodzi albo co zostaje u Ciebie, a lista kandydatów i wpływ na
bilans są liczone dla tego wyboru. W dzień z jedną rolą wyboru nie ma.

- Gdy ustawienie „Powiązanie 11–19” wiąże te dwie role (rola kotwicząca i
  11–19), domyślny jest **cały dyżur**: oba sloty naraz, jedna akceptacja
  zastępcy i jedno zatwierdzenie koordynatora.
- Oddanie jednej roli z takiej pary rozdziela ją. Prośba łamie wtedy regułę
  powiązania i przechodzi drogę opisaną w części
  [Zamiana łamiąca reguły](#zamiana-łamiąca-reguły); podpowiedź zapowiada to
  raz, a nie przy każdym kandydacie. Wyjątkiem jest oddanie samej roli
  kotwiczącej osobie, która tego dnia nie może pełnić zmiany 11–19: to
  wyjątek od powiązania, który daje tylko ostrzeżenie, bez potwierdzenia.
  Druga rola zostaje u Ciebie i można o nią poprosić osobno.
- Gdy powiązanie tych dwóch ról nie wiąże (ustawienie „Niezależnie od on-call”
  albo rola on-call inna niż kotwicząca), domyślnie przechodzi jedna rola, a
  „Cały dyżur” przenosi obie; osoba przejmująca musi wtedy mieć eligibility do
  obu.

Gdy zamiana narusza regułę miękką (na przykład dzieli blok dni wolnych),
zobaczysz ostrzeżenie „Wyślesz mimo to - koordynator zobaczy ostrzeżenie”.
Wysłanie jest nadal możliwe.

## Wymiana dyżur za dyżur

Oddany dyżur dokłada zastępcy jeden dzień w tygodniu, więc przy pełnym grafiku
łatwo o złamanie reguły odpoczynku. Wymiana go tylko przesuwa: oddajesz swój
dyżur, a w zamian bierzesz jeden z dyżurów zastępcy. Każda z dwóch osób ma
potem tyle samo dyżurów co przedtem, więc zwykle żadna reguła nie jest łamana.

Po wybraniu kandydata formularz pokazuje listę **W zamian biorę** z jego
dyżurami z najbliższych 90 dni. Pierwsza pozycja, „Nic, tylko oddaję dyżur”,
to zwykła prośba w jedną stronę. Każda pozycja ma werdykt policzony dla całej
wymiany, w obie strony naraz:

- **„bez naruszeń reguł”** - wymiana niczego nie łamie; gdy samo oddanie
  dyżuru wymagałoby potwierdzenia, pierwsza taka pozycja jest wyróżniona,
- **„ostrzeżenie”** - wymiana narusza regułę miękką; wysłanie jest możliwe,
- **„wymaga potwierdzenia”** - wymiana łamie regułę odpoczynku albo
  powiązania i przechodzi drogę opisaną w części
  [Zamiana łamiąca reguły](#zamiana-łamiąca-reguły),
- **„reguła twarda”** z dopiskiem „nie można: …” - tej pozycji nie da się
  wybrać.

Zasady wymiany:

- w każdą stronę przechodzi jeden dyżur, a dyżur brany w zamian jest z innego
  dnia niż oddawany,
- dyżur brany w zamian przechodzi w całości: rola kotwicząca i 11–19 idą
  razem, a gdy osoba przejmująca nie może pełnić zmiany 11–19, zmiana zostaje
  u dotychczasowej,
- do roli branej w zamian musisz mieć eligibility i nie możesz mieć tego dnia
  wpisu „nie mogę”,
- dyżuru branego w zamian nie może obejmować inna otwarta prośba,
- oba dyżury mogą należeć do różnych opublikowanych grafików.

Wymiana jest niepodzielna: **jedna akceptacja** zastępcy (i jedno
zatwierdzenie koordynatora, gdy jest włączone) obejmuje obie strony, a oba
dyżury przechodzą razem albo wcale. Jeśli przed decyzją którykolwiek z nich
zmienił właściciela, prośba jest anulowana.

W skrzynce wymiana ma w pierwszej kolumnie oba dni z rolami, które przechodzą
(na przykład „wt 6 paź 11–19 ⇄ śr 7 paź SECONDARY + 11–19”), i dopisek
„wymiana”. Arkusz decyzji
pokazuje zastępcy wiersze **Dostajesz** i **Oddajesz**, autorowi **Oddajesz**
i **Dostajesz**, a pozostałym **Dyżur** i **W zamian** - każdy z dniem, rolami
i drugą osobą. Gdy otwarta wymiana niczego nie łamie, arkusz mówi to wprost.
Wiadomości e-mail wymieniają oba dyżury, a przypomnienie o przełączeniu
numeru podaje dni, w które przechodzi rola on-call; sama zmiana 11–19 go nie
wymaga.

## Zamiana łamiąca reguły

Czasem jedyna osoba, która może Cię zastąpić, ma już za dużo dyżurów - na
przykład wszyscy pozostali są na urlopie. Prośbę o taką zamianę można złożyć,
ale każdy, kto ją popycha dalej, musi to zrobić świadomie. Zanim to zrobisz,
sprawdź listę „W zamian biorę”: [wymiana](#wymiana-dyżur-za-dyżur) często nie
łamie żadnej reguły.

Potwierdzić można złamanie czterech reguł odpoczynku i powiązania:

- więcej niż 3 kolejne dni dyżuru on-call,
- więcej niż 3 dyżury on-call w okresie 7 dni,
- mniej niż 2 dni przerwy po serii dyżurów on-call,
- zmiana 11–19 i rola kotwicząca u różnych osób, także gdy prośba oddaje tylko
  jedną rolę z powiązanej pary.

Pozostałe reguły twarde blokują zamianę bez wyjątku: ta sama osoba nie
obejmie obu dyżurów on-call jednego dnia, a zmiana 11–19 nie trafi na dzień
wolny od pracy. Takiego kandydata lista oznacza „nie można: …”.

Jak to przebiega:

1. **Wnioskodawca** po wybraniu kandydata widzi ramkę „Ta zamiana łamie reguły
   grafiku” z listą: kto, którą regułę i w które dni. Przycisk „Wyślij prośbę”
   działa dopiero po zaznaczeniu „Rozumiem i świadomie łamię te reguły”;
   **powód** jest opcjonalny. Wybranie innego kandydata albo innego dyżuru w
   zamian cofa zaznaczenie.
2. **Zastępca** widzi tę samą listę w arkuszu decyzji - przy własnym nazwisku
   z dopiskiem „(Ty)”, bo to najczęściej jego odpoczynek zamiana skraca.
   „Akceptuję” działa dopiero po zaznaczeniu potwierdzenia.
3. **Koordynator** - gdy zatwierdzanie zamian jest włączone - potwierdza
   naruszenie tak samo, zanim kliknie „Zatwierdź i wpisz do grafiku”. Przy
   wyłączonym zatwierdzaniu zamianę wpisuje do grafiku akceptacja zastępcy, a
   koordynatorzy dostają wiadomość informacyjną, która wymienia złamane
   reguły.

Reguły są sprawdzane na nowo przy każdym kroku, na grafiku takim, jaki jest w
danej chwili: lista w arkuszu otwartego wniosku pokazuje stan bieżący, a nie
ten z dnia złożenia prośby. Jeśli grafik zmienił się tak, że zamiana zaczęła
łamać regułę, następna osoba zobaczy listę i będzie musiała ją potwierdzić;
jeśli przestała - potwierdzenie nie jest potrzebne. Gdy lista zmieni się na
ekranie, który masz otwarty, zaznaczenie się cofa i trzeba je dać od nowa.

Złamane reguły wymieniają wiadomości e-mail o zamianie i wpisy w dzienniku
audytu („świadome naruszenie reguł” z identyfikatorami reguł), a wniosek już
wpisany do grafiku pokazuje je w arkuszu pod nagłówkiem „Świadomie złamane
reguły”.

## Ścieżka decyzji

```
zgłoszenie ──► Oczekuje na zastępcę ──► Oczekuje na koordynatora ──► Zatwierdzona
                    │                          │
                    └── Odrzucona              └── Odrzucona
 autor w każdej chwili: Wycofana
 aplikacja, gdy minie dzień dyżuru bez decyzji: Wycofana
```

## Zatwierdzenie koordynatora

Czy zamiana po akceptacji zastępcy czeka jeszcze na koordynatora, decyduje
ustawienie **Zamiana dyżuru wymaga zatwierdzenia koordynatora** w panelu
[Ustawienia generatora](generowanie-grafiku.md#ustawienia-generatora). Jest
wspólne dla całego zespołu i domyślnie **włączone** - wtedy wszystko działa jak
opisano wyżej.

Po jego **wyłączeniu**:

- zamianę załatwia sama akceptacja zastępcy: „Akceptuję” od razu wpisuje ją do
  grafiku, z tymi samymi sprawdzeniami reguł twardych, jakie wykonuje
  zatwierdzenie (jeśli w międzyczasie slot zmienił właściciela, prośba jest
  anulowana); zamianę łamiącą reguły zastępca potwierdza sam, a wiadomość do
  koordynatorów wymienia naruszenie,
- status „Oczekuje na koordynatora” nie występuje, a koordynator nie ma czego
  zatwierdzać ani odrzucać,
- **koordynatorzy dostają wiadomość „Do wiadomości: zamiana wpisana do
  grafiku”** - wyłącznie informacyjną, bez prośby o decyzję; obie strony
  zamiany otrzymują „Zamiana wpisana do grafiku”,
- wniosek, który w chwili wyłączenia czekał już na koordynatora, nadal może on
  zatwierdzić albo odrzucić.

```
zgłoszenie ──► Oczekuje na zastępcę ──► Zatwierdzona (od razu w grafiku)
                    │
                    └── Odrzucona
 autor w każdej chwili: Wycofana
```

## Co robi zatwierdzenie

Zatwierdzenie koordynatora - albo, przy wyłączonym zatwierdzaniu, akceptacja
zastępcy:

- tworzy korektę (override) wyłącznie na slotach objętych wnioskiem - przy
  wymianie w obu kierunkach, w jednym kroku,
- **nie przelicza** pozostałych dni grafiku,
- podnosi wersję opublikowanego grafiku,
- rozsyła powiadomienia i aktualizuje kanały ICS,
- przypisuje punkty (X / 2X) osobie **faktycznie dyżurującej**,
- wysyła przypomnienie o przełączeniu numeru.

## Termin minął

Wniosek dotyczący dnia, który już był, dostaje w tabeli dopisek **„termin
minął”** i traci przyciski decyzji oraz wycofania; przy wymianie wystarczy, że
minął wcześniejszy z dwóch dni. Taki wniosek nie czeka już na niczyją decyzję:
od razu jest liczony i pokazywany wśród **Zamkniętych**, znika więc ze
skrzynki **Do mnie**, z licznika spraw czekających na Twoją decyzję i ze
znacznika przy pozycji „Zamiany” w nawigacji.

Aplikacja zamyka go sama, zwykle w ciągu godziny: wniosek dostaje status
„Wycofana” i powód „Termin dyżuru minął”. Nikt nie dostaje o tym wiadomości;
w dzienniku audytu zostaje wpis **Zamknięto zamianę po terminie**, którego
autorem jest „system”. Przy wymianie zwalnia to późniejszy z dwóch dyżurów,
więc można o niego poprosić od nowa.

Nie da się zaakceptować zastępstwa wstecz - taki dzień poprawia koordynator
korektą na macierzy.
