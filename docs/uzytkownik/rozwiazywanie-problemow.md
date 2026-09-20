# Rozwiązywanie problemów

## Logowanie

**„Nieprawidłowy login lub hasło”**
Sprawdź login. Ten sam komunikat pojawia się przy koncie wyłączonym - jeśli
dane są na pewno poprawne, skontaktuj się z administratorem.

**Konto z katalogu przestało wpuszczać po powiązaniu**
Po powiązaniu konta lokalnego z katalogiem hasło lokalne przestaje działać.
Użyj danych domenowych.

**Konflikt tożsamości przy pierwszym logowaniu z katalogu**
Numer kadrowy na koncie nie zgadza się z `employeeNumber` w katalogu.
Administrator poprawia numer na ekranie „Osoby”; zdarzenie jest w audycie jako
„Konflikt tożsamości LDAP”.

**Zbyt wiele prób logowania**
Logowanie jest chwilowo zablokowane („Zablokowano logowanie (zbyt wiele prób)”
w audycie). Odczekaj i spróbuj ponownie.

## Pola dat

**„Nieprawidłowa data”**
Wpisana data nie istnieje, na przykład `31-09`. Wartość formularza nie została
zmieniona - popraw wpis albo wybierz dzień z kalendarza.

**Kalendarz otworzył się na złym miesiącu**
Otwiera się na miesiącu bieżącej wartości pola, a dla pustego pola na miesiącu
bieżącym. Strzałkami w nagłówku kalendarza przejdziesz dalej.

**Zakres „od-do” został odrzucony**
Data końca nie może być wcześniejsza niż data początku. Pola nie pilnują tego
za Ciebie - sprawdza to serwer i odrzuca zapis.

## Generator

**„Solver nie zdążył”**
Budżet czasu był za krótki. Zwiększ „Budżet czasu na przebieg solvera” w
„Ustawienia generowania” (5-300 s) albo zmniejsz zakres szkicu. Pamiętaj, że
jedno generowanie wykonuje kilka przebiegów, więc łączny czas jest wielokrotnością
budżetu.

**Wynik infeasible - brak rozwiązania**
Reguły twarde są sprzeczne z obsadą. Ekran podaje konkretne konflikty. Typowe
przyczyny:

- za mało osób eligible do roli w danym dniu,
- nakładające się wpisy „nie mogę”,
- blok weekendowy, którego nikt nie może objąć w całości,
- `11–19` wymagane od osoby bez eligibility przy twardym powiązaniu.

Rozwiązaniem jest zmiana **danych wejściowych** (eligibility, dostępność,
zakres), nie wag - wagi nie mogą wyłączyć reguły twardej.

**Ostrzeżenie o zawieszeniu reguł rozrzedzania**
Obsada i nieobecności uniemożliwiły spełnienie limitu 3 dyżurów w 7 dniach albo
dwudniowego odpoczynku. Solver ułożył grafik według pozostałych reguł i mówi o
tym wprost. Grafik jest poprawny, ale obciążenie jest nierówne - warto dołożyć
osoby do rotacji.

**Dwa uruchomienia dają różne grafiki**
Tak ma być. Równoległy CP-SAT znajduje różne rozwiązania tej samej jakości.
Gwarantowana jest zgodność z regułami i kryterium odbioru, nie konkretny układ
nazwisk.

**Publikacja odrzucona - niepełne pokrycie**
Publikacja wymaga obsady każdego dnia zakresu. Uzupełnij brakujące komórki
ręczną korektą i spróbuj ponownie.

**Ktoś zmienił grafik w międzyczasie**
Ekran pokaże, co się zmieniło, i poprosi o potwierdzenie. To działanie
optimistic lockingu - chroni przed cichym nadpisaniem cudzej zmiany.

## Zamiany

**Nie mogę wybrać zastępcy**
Lista zawiera tylko osoby eligible, dostępne i niemające tego dnia przeciwnej
roli. Osoba oznaczona „nie można: …” jest zablokowana regułą twardą.

**„Termin minął”**
Dzień wniosku już był. Decyzji nie da się podjąć wstecz - koordynator poprawia
taki dzień korektą na macierzy.

**Prośba objęła dwa sloty zamiast jednego**
Ustawienie „Powiązanie 11–19” sprawia, że tego dnia obie role należą do jednej
osoby. Ekran zapowiada to przed wysłaniem; jedna akceptacja i jedno
zatwierdzenie obsługują całość.

## Grafik i macierz

**Brak `11–19` w sobotę lub niedzielę**
Zgodnie z regułą: ta zmiana występuje wyłącznie w polskie dni robocze. To nie
jest luka w obsadzie.

**Zgłosiłem dostępność, a grafik się nie zmienił**
Dostępność wpływa na grafik przy **następnym** generowaniu obejmującym te dni.
Dla już opublikowanego grafiku użyj [zamiany](zamiany.md).

**Nowa osoba ma mało dyżurów**
Uczciwy udział jest proporcjonalny do okresu eligibility. Osoba, która weszła
do rotacji niedawno, ma odpowiednio mniejszy udział i nie „nadrabia” roku
wstecz.

## Powiadomienia i kalendarz

**Nie przyszedł e-mail**
Powiadomienia są kolejkowane w bazie i wysyłane przez osobny proces roboczy. Bez
skonfigurowanego serwera SMTP wiadomości są oznaczane jako `skipped` z powodem.
Sprawdź też, czy konto ma uzupełniony adres e-mail (ekran „Osoby”).

**Kalendarz nie pokazuje zmiany**
Aplikacje kalendarzowe odświeżają subskrypcje we własnym rytmie, zwykle co
kilka godzin. Dyżur niesie wersję grafiku jako numer sekwencji, więc po
odświeżeniu wpis zostanie zaktualizowany, a nie zduplikowany.

**Adres ICS przestał działać**
Został odwołany. Utwórz nowy na ekranie „Moje”.

## Link podglądowy

**Link nie działa**
Mógł wygasnąć (maksymalnie 30 dni) albo zostać odwołany - odwołanie działa
natychmiast. Administrator wystawia nowy.

**Link pokazuje mniej dni, niż powinien**
Sesja z linku widzi grafik przycięty do zakresu dat linku. Zakres widać na
pasku u góry ekranu.
