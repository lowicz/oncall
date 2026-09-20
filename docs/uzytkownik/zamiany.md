# Zamiany

Ekran **Zamiany** (`/zamiany`) obsługuje zastępstwa na konkretny dzień i rolę,
także wtedy, gdy bazowa rotacja jest tygodniowa.

## Trzy skrzynki

Wnioski są podzielone na trzy grupy, żeby nie mieszać spraw czekających na
decyzję z zamkniętymi miesiąc temu:

| Grupa | Co zawiera |
| --- | --- |
| **Wymaga Twojej akcji** | wnioski czekające dokładnie na Ciebie |
| **W toku** | otwarte wnioski czekające na kogoś innego |
| **Zakończone** | zatwierdzone, odrzucone i wycofane |

Liczba oczekujących spraw pojawia się także jako znacznik przy pozycji
„Zamiany” w nawigacji.

## Zgłoszenie prośby

1. W polu **Mój dyżur** wybierz swój nadchodzący dyżur. Lista podaje datę,
   rolę i jak daleko jest ten dzień. Dyżur kolidujący z Twoim wpisem
   „nie mogę” jest oznaczony.
2. W polu **Zastępca** wybierz osobę. Lista zawiera wyłącznie osoby eligible i
   dostępne, które nie mają tego dnia przeciwnej roli. Przy każdej widać jej
   dostępność, bieżący bilans i to, czy ma już tego dnia dyżur - dzięki temu
   dwóch kandydatów porównasz bez otwierania każdego z osobna.
   - osoba oznaczona **„nie można: …”** jest zablokowana regułą twardą i nie da
     się jej wybrać,
   - oznaczenie **„poprawia bilans”** mówi, że zamiana zmniejszy nierówność.
3. Opcjonalnie dopisz **Notatkę**.
4. Pod formularzem zobaczysz **podgląd wpływu**: ile punktów przechodzi między
   Wami.
5. „Wyślij prośbę”.

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

- **Zastępca** klika „Akceptuję” albo „Odrzuć”.
- **Koordynator lub administrator** klika „Zatwierdź” albo „Odrzuć”.
- **Autor** może „Wycofać” własną prośbę, dopóki nie zapadła decyzja.

Każda decyzja przechodzi przez okienko potwierdzenia, które jeszcze raz pokazuje
dzień, rolę, obie osoby, podgląd wpływu na punkty i ewentualne ostrzeżenia.
Odrzucenie i wycofanie dodatkowo wymagają **podania powodu**; powód zostaje przy
wniosku i w audycie.

## Co robi zatwierdzenie

- tworzy korektę (override) wyłącznie na wybranym dniu i wybranej roli,
- **nie przelicza** pozostałych dni grafiku,
- podnosi wersję opublikowanego grafiku,
- rozsyła powiadomienia i aktualizuje kanały ICS,
- przypisuje punkty (X / 2X) osobie **faktycznie dyżurującej**,
- wysyła przypomnienie o przełączeniu numeru.

## Termin minął

Wniosek dotyczący dnia, który już był, dostaje etykietę **„Termin minął”** i
traci przyciski decyzji. Nie da się zaakceptować zastępstwa wstecz - taki dzień
poprawia koordynator korektą na macierzy.
