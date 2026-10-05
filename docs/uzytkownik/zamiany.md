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
| **Zamknięte** | zatwierdzone, odrzucone i wycofane |

Ekran otwiera się na skrzynce, w której coś na Ciebie czeka; adres
`/zamiany?skrzynka=moje` otwiera wskazaną. Suma spraw wymagających Twojej
akcji pojawia się także jako znacznik przy pozycji „Zamiany” w nawigacji.

Wiersz tabeli podaje dzień i rolę, kto oddaje, kto przejmuje, **skutek** (osoba,
która zyska punkty, i ile) oraz **etap** - kto jest następny. Znacznik
**„łamie reguły”** oznacza wniosek opisany w części
[Zamiana łamiąca reguły](#zamiana-łamiąca-reguły). Przycisk **Zdecyduj** (gdy
decyzja należy do Ciebie) albo **Podgląd** otwiera arkusz sprawy.

## Arkusz decyzji

Arkusz pokazuje obie osoby, dyżur, powód wnioskodawcy, pasek etapów
(złożona → zastępca → koordynator → w grafiku; etap „koordynator” znika, gdy
zatwierdzanie zamian jest wyłączone), **Wpływ na bilans** obu osób, reguły,
które zamiana łamie, i ostrzeżenia. Decyzję podejmujesz w tym samym miejscu:

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
prowadzi przez trzy kroki: dyżur, kandydat, powód i wysłanie.

1. W polu **Mój dyżur** wybierz swój nadchodzący dyżur. Lista podaje datę,
   rolę i jak daleko jest ten dzień. Dyżur kolidujący z Twoim wpisem
   „nie mogę” jest oznaczony.
2. Pod polem pojawia się lista **Kandydaci**: osoby eligible i dostępne, które
   nie mają tego dnia przeciwnej roli, uszeregowane od najlepszego kandydata.
   Przy każdej widać jej dostępność, odchylenie od należnego udziału i to, czy
   ma już tego dnia dyżur - dzięki temu dwóch kandydatów porównasz bez
   otwierania każdego z osobna. Kliknięcie wybiera osobę.
   - osoba oznaczona **„nie można: …”** jest zablokowana regułą, której
     zamiana nie może złamać, i nie da się jej wybrać,
   - osoba oznaczona **„łamie regułę: …”** i **„wymaga potwierdzenia”** jest do
     wyboru, ale prośba wymaga wtedy potwierdzenia i powodu (patrz
     [Zamiana łamiąca reguły](#zamiana-łamiąca-reguły)); takie osoby są na
     liście za tymi, które żadnej reguły nie łamią,
   - oznaczenie **„poprawia bilans”** mówi, że zamiana zmniejszy nierówność,
   - oznaczenie **„dzieli blok dni wolnych”** zapowiada ostrzeżenie dla
     koordynatora.
3. Pod listą zobaczysz **Wpływ na bilans**: ile punktów przechodzi między
   Wami.
4. Opcjonalnie dopisz **Powód**; zobaczą go zastępca i koordynator. Powód jest
   wymagany, gdy zamiana łamie reguły.
5. „Wyślij prośbę”. Ekran potwierdza wysłanie komunikatem „Wysłano do: …” i
   przechodzi do skrzynki **Moje**.

Jeśli ustawienie „Powiązanie 11–19” sprawia, że tego dnia obie role należą do
jednej osoby, prośba obejmie **oba sloty naraz** - ekran to zapowiada. Jedna
akceptacja zastępcy i jedno zatwierdzenie koordynatora załatwiają całość.

Gdy zamiana narusza regułę miękką (na przykład dzieli blok dni wolnych),
zobaczysz ostrzeżenie „Wyślesz mimo to - koordynator zobaczy ostrzeżenie”.
Wysłanie jest nadal możliwe.

## Zamiana łamiąca reguły

Czasem jedyna osoba, która może Cię zastąpić, ma już za dużo dyżurów - na
przykład wszyscy pozostali są na urlopie. Prośbę o taką zamianę można złożyć,
ale każdy, kto ją popycha dalej, musi to zrobić świadomie.

Potwierdzić można złamanie czterech reguł odpoczynku i powiązania:

- więcej niż 3 kolejne dni dyżuru on-call,
- więcej niż 3 dyżury on-call w okresie 7 dni,
- mniej niż 2 dni przerwy po serii dyżurów on-call,
- zmiana 11–19 i rola kotwicząca u różnych osób.

Pozostałe reguły twarde blokują zamianę bez wyjątku: ta sama osoba nie
obejmie obu dyżurów on-call jednego dnia, a zmiana 11–19 nie trafi na dzień
wolny od pracy. Takiego kandydata lista oznacza „nie można: …”.

Jak to przebiega:

1. **Wnioskodawca** po wybraniu kandydata widzi ramkę „Ta zamiana łamie reguły
   grafiku” z listą: kto, którą regułę i w które dni. Przycisk „Wyślij prośbę”
   działa dopiero po zaznaczeniu „Rozumiem i świadomie łamię te reguły” i
   wpisaniu **powodu** (co najmniej 10 znaków). Wybranie innego kandydata
   cofa zaznaczenie.
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
