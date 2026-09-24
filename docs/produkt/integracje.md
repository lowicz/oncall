# Integracje

## Powiadomienia e-mail

Zdarzenia cyklu zamian, publikacje grafiku, korekty koordynatora i
przypomnienia o przełączeniu numeru **zapisują wiersz w tabeli
`notification_outbox` w tej samej transakcji co zmiana biznesowa**. Osobny
proces roboczy opróżnia kolejkę z wykładniczym wycofaniem i dostarcza wiadomości
przez dostawców kanałów.

Konsekwencje tego kształtu:

- Powiadomienie nie może „zniknąć” przy awarii poczty - zostaje w kolejce.
- Zmiana biznesowa nie może się udać, a powiadomienie nie powstać (ani odwrotnie).
- Kanał jest punktem rozszerzenia: dziś `email`, kolejne kanały wpinają się w tę
  samą kolejkę bez dotykania logiki biznesowej.

Dostarczanie jest **co najmniej raz**. Proces roboczy zajmuje partię pod
dzierżawą, wysyła każdą wiadomość bez otwartej transakcji i zapisuje każdy wynik
osobno, więc proces, który zginie w trakcie, powtórzy najwyżej jedną wiadomość -
nigdy całą partię. Każda wiadomość niesie identyfikator wiersza kolejki jako
stabilny klucz idempotencji, który dostawca SMTP wydaje jako stałe `Message-ID`,
więc powtórka jest rozpoznawalna jako ta sama wiadomość.

Serwer SMTP jest **usługą zewnętrzną** - projekt nie hostuje poczty. Bez
skonfigurowanego hosta SMTP wiadomości są oznaczane jako `skipped` z powodem
zapisanym w kolejce.

Każda wiadomość wychodzi w dwóch wersjach naraz (`multipart/alternative`):
jako zwykły tekst, który mówi wszystko sam, i jako HTML w jasnym motywie
aplikacji - z tym samym oznaczeniem ról (PRIMARY, SECONDARY, 11–19), tymi
samymi kolorami i datami w postaci `czw 24-09-2026`, jaką pokazują ekrany.
Wersja HTML jest pisana pod Outlook 365: układ na tabelach, style wpisane w
elementy, bez czcionek webowych, obrazków i przezroczystości. Nazwa i podtytuł
w nagłówku wiadomości pochodzą z `ONCALL_APP_NAME` i `ONCALL_APP_SUBTITLE`, a
przyciski prowadzą pod `ONCALL_PUBLIC_BASE_URL`.

Wiadomość o publikacji grafiku dostaje każda osoba z zespołu aktywna w jego
zakresie. Wymienia wyłącznie jej własne dyżury (dzień i rola) albo mówi, że w
tym grafiku nie ma żadnego, i prowadzi do ekranu **Moje** (`/moje`).

## Kanały ICS

Aplikacje kalendarzowe subskrybują odwoływalne adresy tokenowe pod `/calendar`.

| Kanał | Kto tworzy | Zawartość |
| --- | --- | --- |
| osobisty | członek zespołu (sekcja „Subskrypcja kalendarza” na ekranie „Moje”) | wyłącznie własne dyżury |
| dla linku podglądowego | administrator | grafik przycięty do zakresu i ważności linku |

Dyżury są wydarzeniami całodniowymi, a **wersja grafiku jest numerem sekwencji
wydarzenia**, więc aplikacje kalendarzowe widzą korekty i zamiany jako
aktualizacje istniejącego wpisu, a nie jako nowe wpisy.

Kanał można odwołać w dowolnym momencie; adres przestaje działać natychmiast.

## Linki podglądowe

Opisane w [Role i dostęp](role-i-dostep.md#dostęp-czasowy-bez-konta): link
związany z odbiorcą, zakresem dat i wygaśnięciem do 30 dni, wymieniany na
ograniczoną sesję podglądową.

## Import historii

Koordynator i administrator wgrywają CSV w kodowaniu UTF-8 (do 5000 wierszy).

Wymagane kolumny:

| Kolumna | Format | Uwagi |
| --- | --- | --- |
| `service_date` | `RRRR-MM-DD` | data dyżuru |
| `role` | `primary`, `secondary`, `late_shift` | `late_shift` tylko w polskie dni robocze |
| `assignee_name` | dokładna nazwa wyświetlana osoby | musi istnieć w zespole |

Podgląd przed importem wykrywa duplikaty slotów, nieznane osoby i konflikty.
Gotowy przykład leży w `examples/history.csv`, a
szablon do pobrania jest na ekranie importu.

Import zasila historię, z której liczą sprawiedliwość i generator, więc jest to
sposób na uruchomienie aplikacji z sensownym bilansem od pierwszego dnia.

## Raport miesięczny dla kadr

Koordynator i administrator pobierają CSV za wybrany miesiąc. Jeden wiersz to
jedna osoba. Kodowanie UTF-8 z BOM, układ kolumn stabilny i wersjonowalny:

| Kolumna | Znaczenie |
| --- | --- |
| `miesiac` | miesiąc rozliczenia (`RRRR-MM`) |
| `osoba` | nazwa wyświetlana |
| `primary_dni_robocze` | dyżury `PRIMARY` w zwykłe dni robocze |
| `primary_weekendy` | dyżury `PRIMARY` w soboty i niedziele |
| `primary_swieta` | dyżury `PRIMARY` w święta ustawowe |
| `secondary_dni_robocze` | jak wyżej, dla `SECONDARY` |
| `secondary_weekendy` | |
| `secondary_swieta` | |
| `oncall_dni_robocze_razem` | suma on-call w dni robocze |
| `oncall_weekendy_razem` | suma on-call w weekendy |
| `oncall_swieta_razem` | suma on-call w święta |
| `zmiany_11_19` | liczba roboczych zmian `11–19` |
| `primary_punkty` | punkty za `PRIMARY` (X / 2X) |
| `secondary_punkty` | punkty za `SECONDARY` |
| `punkty_razem` | suma punktów |

Każdy slot jest liczony z efektywnej wersji grafiku, po override'ach i
zamianach. Święto przypadające w sobotę lub niedzielę jest liczone raz, jako
weekend. Ekran ostrzega, gdy opublikowany grafik nie pokrywa całego miesiąca,
i podaje, ile dni pokrywa.

Przyszłe formaty (XLSX, Word) mają korzystać z tego samego modelu raportowego, a
nie z osobnej logiki liczenia.

## Audyt

Istotne operacje - logowania i nieudane logowania, zmiany dostępności, cykl
zamian, generowanie szkiców, publikacje, korekty, zmiany polityki, importy
historii, linki i kanały, administracja kontami - są zapisywane w tabeli
`audit_events` **w tej samej transakcji co sama zmiana**.

Etykieta aktora jest zdenormalizowana, więc ślad przetrwa usunięcie konta i
opisze także aktorów niebędących użytkownikami, na przykład link podglądowy.
Administrator przegląda i filtruje dziennik na ekranie „Audyt”, a wynik filtra
może wyeksportować do CSV.

## Metryki procesu roboczego

Proces roboczy raportuje na własnym loggerze `oncall.metrics`, jeden rekord
logfmt na pomiar. Nic z tego nie trafia do bazy, a proces API nie emituje
żadnego z tych rekordów - wartość tych liczb jest wartością logów procesu
roboczego, więc warto je zbierać.

| Rekord | Pola |
| --- | --- |
| `queue` | `queued`, `running`, `oldest_queued_seconds`, `stalest_running_seconds` |
| `outbox` | `eligible`, `oldest_eligible_seconds`, `retrying`, `attempts_max`, `waiting`, `dead` |
| `generation` | `run`, `outcome`, `queued_seconds`, `run_seconds` |
| `generation_abandoned` | `runs` - ile uruchomień zwolniono po procesie, który zginął (ostrzeżenie) |

`queue` i `outbox` są próbkowane na zegarze (`ONCALL_METRICS_INTERVAL_SECONDS`,
domyślnie 60) niezależnie od tego, czy cokolwiek się dzieje - **luka w nich
oznacza, że zatrzymał się sam proces roboczy**.

`outcome` przyjmuje wartości: `completed`, `infeasible` (obsada i reguły twarde
są sprzeczne - muszą zmienić się dane wejściowe), `requester_missing`, `error`
(defekt aplikacji) oraz `reclaimed` (solve skończył się po uznaniu uruchomienia
za porzucone, więc wynik wyrzucono; `ONCALL_STALE_RUN_SECONDS` jest za ciasny
dla tej obsady).
