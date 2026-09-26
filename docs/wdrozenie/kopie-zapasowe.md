# Kopie zapasowe bazy

Codziennie o 21:00 timer `oncall-backup.timer` robi logiczny zrzut bazy (`pg_dump`)
wewnątrz działającego kontenera `db`, odtwarza go na próbę w jednorazowym
kontenerze i dopiero wtedy go zachowuje. Zostaje 30 najnowszych kopii. Kopie
leżą na tym samym hoście i nie są szyfrowane. Gdy kopia się nie uda, e-mail
wychodzi przez ustawienia SMTP samej aplikacji. Taki sam zrzut robi
`deploy/update.sh` przed każdą aktualizacją, bo migracje bazy nie cofają się
same.

Wszystko działa jako jednostki użytkownika systemd tego samego użytkownika,
który uruchamia stos (na produkcji `podman`) - patrz [Systemd](systemd.md).

## Instalacja na produkcji

Na hoście musi już działać stos z jednostką `oncall.service`, a katalog
wdrożenia musi mieć katalog `deploy/backup/`. Jeśli go nie ma, wdrożenie jest
starsze: najpierw [zaktualizuj je](aktualizacja.md) do wydania, które go ma.

Jako użytkownik wdrożenia, zalogowany bezpośrednio (nie przez `su` ani
`sudo`), z katalogu wdrożenia:

```bash
ssh podman@host
cd ~/oncall
./deploy/backup/setup.sh --owner podman --alert-email admin@example.com
```

Skrypt jest idempotentny. W kolejności:

1. Sprawdza, że uruchamia go użytkownik `--owner` (domyślnie ten, kto go
   uruchomił), nie root, i że to jego systemd uruchamia `oncall.service` z tego
   samego katalogu. Kopie należą do tego użytkownika i do nikogo innego.
2. Sprawdza linger, a gdy jest wyłączony, próbuje go włączyć - patrz
   [niżej](#linger-i-jednostki-użytkownika).
3. Zapisuje ustawienia w `~/.config/oncall/backup.conf` (prawa `0600`).
4. Zakłada katalog kopii z prawami `0700` albo sprawdza, że istniejący należy
   do właściciela, i go zamyka.
5. Sprawdza stos: kontener `db`, jego gotowość i serwer SMTP aplikacji.
6. Instaluje `oncall-backup.service`, `oncall-backup-alert.service` i
   `oncall-backup.timer` w `~/.config/systemd/user/`, z drop-inami: jeden
   wskazuje katalog wdrożenia, drugi niesie porę kopii
   (`oncall-backup.timer.d/time.conf`); włącza timer.
7. Robi kopię tak, jak zrobi ją timer
   (`systemctl --user start oncall-backup.service`), i pokazuje jej stan.

Bez `--alert-email` alarmy dostają aktywni administratorzy aplikacji, którzy
mają adres e-mail. Ponowne uruchomienie zmienia tylko podane wartości; resztę
bierze z pliku ustawień.

### Czy wystarczy update.sh

Nie sam. `deploy/update.sh` dostarcza pliki `deploy/backup/` razem z wydaniem,
przed każdą aktualizacją robi zrzut bazy (także bez instalacji timera) i
odświeża już zainstalowane jednostki kopii, gdy wydanie je zmieni. Nie zakłada
jednak katalogu kopii, nie zapisuje ustawień, nie włącza timera ani nie
sprawdza lingera: to decyzje i uprawnienia, których nienadzorowane
`curl ... | sh` nie powinno podejmować za operatora. Dlatego instalacja to
jednorazowe `setup.sh`, a potem `update.sh` utrzymuje ją w aktualnym stanie.

### Linger i jednostki użytkownika

Kontenery rootless Podmana należą do jednego użytkownika i tylko on je widzi,
więc zrzut musi robić ten sam użytkownik, który uruchamia stos, w swoim
menedżerze systemd - tak jak `oncall.service`. Jednostka systemowa z
`User=podman` nie ma sesji tego użytkownika (`XDG_RUNTIME_DIR`, menedżer
systemd użytkownika), na której rootless Podman polega.

Menedżer systemd użytkownika działa bez zalogowania tylko z włączonym
lingerem. Bez niego timer przestaje działać, gdy użytkownik się wyloguje, i
nie startuje po restarcie maszyny. `install-user-unit.sh` włącza linger przy
instalacji stosu; `setup.sh` sprawdza go jeszcze raz. Gdy użytkownik nie może
go włączyć sam (polityka polkit), robi to administrator:

```bash
sudo loginctl enable-linger podman
```

## Ustawienia

Plik `~/.config/oncall/backup.conf` zapisuje `setup.sh`. To wiersze
`KLUCZ=wartość`, czytane przy każdym uruchomieniu kopii (nie przez `source`).
Zmienna środowiskowa o tej samej nazwie ma pierwszeństwo przed plikiem.

| Ustawienie | Opcja `setup.sh` | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `ONCALL_BACKUP_OWNER` | `--owner` | użytkownik uruchamiający | Jedyny użytkownik, który może robić kopie i do którego należy katalog |
| `ONCALL_BACKUP_DIR` | `--backup-dir` | `~/oncall-backups` | Katalog kopii, poza katalogiem wdrożenia |
| `ONCALL_BACKUP_KEEP` | `--keep` | `30` | Ile najnowszych kopii zostaje |
| `ONCALL_BACKUP_ALERT_EMAIL` | `--alert-email` | adresy aktywnych administratorów | Odbiorcy alarmu, rozdzieleni przecinkami |
| `ONCALL_BACKUP_TIME` | `--backup-time` | `21:00` | O której startuje codzienna kopia (`GG:MM`, czas hosta), najwyżej 15 minut później |
| `ONCALL_BACKUP_WAIT_SECONDS` | - | `600` | Jak długo kopia czeka na bazę, np. gdy timer ruszy przy starcie maszyny przed stosem |

Zmiana ustawienia to ponowne `setup.sh` z nową wartością, np.
`./deploy/backup/setup.sh --keep 60`. Nowa wartość działa od następnej kopii;
nadmiarowe stare kopie znikają przy najbliższej udanej kopii.

Pora kopii to `ONCALL_BACKUP_TIME` w strefie czasowej hosta, z losowym
opóźnieniem do 15 minut. `setup.sh` zapisuje ją w drop-inie
`~/.config/systemd/user/oncall-backup.timer.d/time.conf`, więc aktualizacja,
która odświeża sam timer, jej nie zmienia. Inna pora działa od razu:

```bash
./deploy/backup/setup.sh --backup-time 23:30
```

## Sprawdzenie

Czy timer jest włączony i kiedy ruszy następny raz:

```bash
systemctl --user list-timers oncall-backup.timer
```

Czy ostatnia kopia się udała, ile ich jest i czy był błąd:

```bash
./deploy/backup/oncall-backup.sh status
./deploy/backup/oncall-backup.sh list
journalctl --user -u oncall-backup.service
```

`journalctl --user` działa tylko z dziennikiem zapisywanym na dysku. Gdy nie ma
katalogu `/var/log/journal` (dziennik tylko w pamięci), użytkownik dostaje
„No journal files were opened due to insufficient permissions”, a dziennik
znika przy restarcie maszyny. `setup.sh` to zgłasza, a `oncall-backup.sh
status` pokazuje ostatni błąd niezależnie od dziennika. Trwały dziennik, w
którym każdy użytkownik czyta swoje wpisy, włącza administrator:

```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

Kopia teraz, dokładnie tak, jak robi ją timer:

```bash
systemctl --user start oncall-backup.service
```

Czy alarm dochodzi - próbny e-mail do skonfigurowanych odbiorców:

```bash
./deploy/backup/oncall-backup.sh alert --test
```

Czy linger jest włączony (`Linger=yes`):

```bash
loginctl show-user podman --property=Linger
```

## Co jest w kopii

Jedna kopia to jeden plik `oncall-<czas UTC>-<rodzaj>-<rewizja schematu>.dump`
w formacie `pg_dump --format=custom`, kompresowany zstd, np.
`oncall-20260926T023412Z-daily-0035_outbox_created_index.dump`. Rodzaj to
`daily` (timer), `pre-update-<z>-to-<do>` (aktualizacja), `pre-restore`
(stan sprzed odtworzenia) albo `manual`. Wszystkie liczą się do tej samej
puli najnowszych kopii.

Kopia to tylko baza. `.env` i `tls/` zawierają hasła i klucz prywatny TLS i
nie wchodzą do kopii: `update.sh` trzyma ich poprzednie wersje w `.backup/`, a
ich miejsce jest w sejfie haseł organizacji.

Baza zawiera dane osobowe (imiona i nazwiska, adresy e-mail, telefony, numery
kadrowe) i skróty haseł kont lokalnych. Katalog kopii ma prawa `0700`, pliki
`0600`, a skrypt odmawia pracy, gdy katalog należy do kogoś innego albo jest
otwarty dla innych. Kopie są tylko lokalne: awaria dysku albo utrata maszyny
zabiera bazę razem z kopiami. Katalog kopii to zwykłe pliki, więc firmowy
system kopii może go objąć bez zmian w skrypcie.

## Test odtworzenia i sprzątanie

Każdy zrzut jest odtwarzany w całości (`pg_restore` w jednej transakcji) w
jednorazowym kontenerze z obrazu działającej bazy, zanim trafi do katalogu
kopii. Kontener nie ma sieci, ma system plików tylko do odczytu, a dane
trzyma w tmpfs: test nie zajmuje miejsca na dysku, tylko chwilowo tyle
pamięci, ile waży baza. Plik, który się nie odtworzy albo nie ma wszystkich
tabel bazy, nie zostaje zachowany. Samo `pg_restore --list` nie wystarcza: na
uciętym pliku kończy się sukcesem. `verify` i `restore` odtwarzają tak samo
kopię już zachowaną, ale porównują ją z jej własnym spisem tabel, bo schemat
bazy mógł się od tego czasu zmienić.

Po każdym uruchomieniu, udanym czy nie, skrypt usuwa swój kontener testowy
razem z jego wolumenami. Gdy proces zostanie zabity, zanim zdąży to zrobić,
sprząta `ExecStopPost` jednostki, a w ostateczności następne uruchomienie; to
ono zapisuje też, w którym kroku kopię przerwano, żeby alarm to podał.
Usuwa wyłącznie kontenery oznaczone własną etykietą skryptu
(`io.github.lowicz.oncall.backup-verify`) dla tego wdrożenia i własne
niedokończone pliki `.tmp.*` - nigdy nie wywołuje `podman system prune`.
Ręcznie to samo robi:

```bash
./deploy/backup/oncall-backup.sh cleanup
```

## Odtworzenie bazy

```bash
./deploy/backup/oncall-backup.sh list
./deploy/backup/oncall-backup.sh restore ~/oncall-backups/oncall-20260926T023412Z-daily-0035_outbox_created_index.dump
```

Skrypt pyta o potwierdzenie (bez terminala wymaga `--yes`), a potem:

1. odtwarza plik na próbę w jednorazowym kontenerze - plik, który się nie
   odtworzy, niczego nie zmienia,
2. robi kopię bieżącego stanu (`pre-restore`), żeby odtworzenie dało się
   cofnąć tym samym poleceniem,
3. zatrzymuje `api`, `worker` i `web` - aplikacja jest wtedy niedostępna,
4. odtwarza plik do nowej bazy obok i zamienia bazy nazwami, więc błąd w
   trakcie zostawia dotychczasową bazę nietkniętą,
5. uruchamia je z powrotem, także po błędzie; `web` na końcu, żeby nginx
   odnalazł ponownie uruchomione `api`.

`api` przy starcie stosuje migracje nowsze od schematu kopii. Kopia z nowszym
schematem niż uruchomione wydanie wymaga najpierw tego wydania.

## Przed aktualizacją

`deploy/update.sh` robi zrzut z rodzajem `pre-update-<z>-to-<do>` po pobraniu
obrazów, a przed zmianą jakiegokolwiek pliku. Używa skryptu kopii z katalogu
wdrożenia, a gdy go tam nie ma (pierwsza aktualizacja do wydania z kopiami),
skryptu z nowego wydania. Nieudany zrzut kończy aktualizację bez żadnej
zmiany. Stos musi wtedy działać: skrypt czeka na bazę najwyżej 60 sekund.

## Gdy kopia się nie uda

Jednostka `oncall-backup.service` kończy się błędem i uruchamia
`oncall-backup-alert.service`, która wysyła e-mail z nazwą hosta, krokiem,
który się nie udał, i ostatnimi komunikatami. E-mail wychodzi przez kontener
`api` (albo `worker`, gdy `api` nie działa), z ustawieniami `ONCALL_SMTP_*`
z `.env`; bez `ONCALL_SMTP_HOST` alarmu nie da się wysłać. Wcześniejsze kopie
zostają nietknięte.

Szczegóły pokazują `./deploy/backup/oncall-backup.sh status` (ostatni błąd) i
`journalctl --user -u oncall-backup.service`. Najczęstsze przyczyny:

- stos nie działa (`systemctl --user status oncall`),
- brak miejsca na dysku w katalogu kopii,
- katalog kopii zmienił właściciela albo prawa - skrypt podaje polecenie,
  które to naprawia.

Po usunięciu przyczyny kopia teraz to `systemctl --user start
oncall-backup.service`.
