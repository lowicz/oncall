# Systemd (Podman Compose)

Żeby stos wstawał sam po restarcie maszyny i po nienadzorowanej aktualizacji, uruchamiaj go jednostką **użytkownika**, nie systemową.
Jednostka jest typu `oneshot` z `RemainAfterExit=yes` i woła skrypt `deploy/systemd/oncall-stack.sh`, a nie wklejone polecenie `podman compose`.
Skrypt jest jedynym wejściem na stos: pliki Compose zostają definicją usług.

Domyślna, produkcyjna ścieżka startuje wszystkie trzy pliki:

```bash
podman compose -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.ldap-ca.yml up -d
```

To nie jest Quadlet i nie zmienia zachowania obrazów, TLS ani LDAP.
Compose czyta `.env` z katalogu wdrożenia; jednostka, skrypty i ta strona nie wczytują tego pliku.
Kontenery mają w Compose `restart: unless-stopped`, więc ich awarie zostają przy Podmanie.
Zadaniem jednostki jest utworzyć stos, gdy startuje systemd użytkownika.

## Wymagania

Checkout wydania z plikami Compose i uzupełnionym `.env` - patrz [Uruchomienie](uruchomienie.md).
Podman z `podman compose` oraz gniazdem użytkownika (`podman.socket`).
Domyślna ścieżka wymaga też nakładek TLS i CA katalogu - patrz [TLS](tls.md) i [LDAP](ldap.md).

## Instalacja

Jako użytkownik, który ma uruchamiać stos (nie root):

```bash
./deploy/systemd/install-user-unit.sh /ścieżka/do/checkoutu
```

Argument to katalog wdrożenia (pliki Compose i `.env`), a nie zgadywany katalog domowy.
Skrypt jest idempotentny.
Kolejno:

1. kopiuje `deploy/systemd/oncall.service` do `~/.config/systemd/user/`
2. zapisuje katalog checkoutu jako `WorkingDirectory` w drop-inie `oncall.service.d/checkout.conf` (nie w samej jednostce)
3. włącza linger (`loginctl enable-linger`), żeby sesja systemd użytkownika wstawała bez interaktywnego logowania
4. włącza i startuje `podman.socket` oraz `oncall.service`

## Bez nakładki

Host, który nie potrzebuje TLS albo CA katalogu, pomija plik **bez edycji jednostki**.
Podaj nazwy plików Compose skryptowi setupu:

```bash
./deploy/systemd/install-user-unit.sh /ścieżka/do/checkoutu docker-compose.yml
./deploy/systemd/install-user-unit.sh /ścieżka/do/checkoutu docker-compose.yml docker-compose.tls.yml
```

Setup zapisze je w drop-inie jako `ONCALL_COMPOSE_FILES` (nazwy rozdzielone dwukropkiem).
Skrypt stosu czyta tę zmienną z środowiska systemd, nie z `.env`.

## Ręcznie

Ta sama sekwencja bez skryptu setupu, z katalogu checkoutu:

```bash
install -D -m 644 deploy/systemd/oncall.service ~/.config/systemd/user/oncall.service
mkdir -p ~/.config/systemd/user/oncall.service.d
cat > ~/.config/systemd/user/oncall.service.d/checkout.conf <<EOF
[Service]
WorkingDirectory=/ścieżka/do/checkoutu
EOF
loginctl enable-linger
systemctl --user daemon-reload
systemctl --user enable --now podman.socket
systemctl --user enable --now oncall.service
```

`WorkingDirectory` musi być ścieżką bezwzględną.
Żeby pominąć nakładkę, dopisz w tym samym drop-inie na przykład `Environment=ONCALL_COMPOSE_FILES=docker-compose.yml`.
Nie wstawiaj do jednostki ani drop-inu `EnvironmentFile=` wskazującego na `.env`.

## Sterowanie

```bash
systemctl --user status oncall
systemctl --user restart oncall
systemctl --user stop oncall
```

Po starcie jednostka zostaje `active (exited)`: polecenie `up` się udało; kontenerami zajmuje się Podman.
`restart` robi `down`, a potem znowu `up`.
`stop` woła `oncall-stack.sh down` **bez** `-v`, więc wolumeny (w tym baza) zostają.

## Po restarcie

Linger sprawia, że systemd użytkownika startuje razem z maszyną, bez logowania.
Włączona jednostka odpala wtedy skrypt `up` z katalogu checkoutu.
Gniazdo Podmana musi być włączone - skrypt setupu robi `systemctl --user enable --now podman.socket`.
Ręczne `systemctl --user start podman.socket` jest opisane też w [Uruchomienie](uruchomienie.md#podman).

## Aktualizacja wydania

Jak w [Wydania i wersje](wydania.md): checkout tagu, nowy `ONCALL_VERSION` w `.env`, potem:

```bash
systemctl --user restart oncall
```

Jeśli zmieniła się jednostka albo skrypt stosu w checkoutcie, uruchom skrypt setupu jeszcze raz i zrestartuj usługę.
