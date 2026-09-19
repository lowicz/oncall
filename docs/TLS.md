# TLS dla frontendu (nginx)

Opis wdrożenia HTTPS dla serwisu `web` (nginx serwujący SPA i proxy `/api` oraz `/calendar`).
Backend (`api`, `worker`) pozostaje po HTTP wewnątrz sieci Docker - TLS jest terminowany na nginx, co jest standardowym i zalecanym kształtem dla tego stosu.

## Model wdrożenia

```
przeglądarka ──HTTPS──> web (nginx, tu kończy się TLS) ──HTTP──> api (uvicorn)
```

- Certyfikat i klucz są **montowane do kontenera** z katalogu hosta, nie wbudowane w obraz. Obraz pozostaje generyczny i można go używać w każdym środowisku.
- Opcjonalne **CA (np. wewnętrzne CA firmy)** jest montowane obok i dopisywane do magazynu zaufania kontenera przy starcie.
- Wybór konfiguracji HTTP/HTTPS odbywa się przy starcie kontenera przez skrypt `/docker-entrypoint.d/40-tls.sh`, na podstawie zmiennej `ONCALL_TLS_ENABLED`.

## Pliki montowane do kontenera

| Ścieżka w kontenerze | Wymagany | Zawartość |
| --- | --- | --- |
| `/etc/nginx/tls/fullchain.pem` | przy TLS | certyfikat serwera + pełny łańcuch pośrednich (w tej kolejności) |
| `/etc/nginx/tls/privkey.pem` | przy TLS | klucz prywatny serwera (bez hasła) |
| `/etc/nginx/tls/ca.pem` | opcjonalny | wewnętrzne CA; dopisywane do `ca-certificates.crt` kontenera i dostępne jako `proxy_ssl_trusted_certificate` |

Montowanie katalogu hosta (domyślnie `./tls`, nadpisywalne zmienną `ONCALL_TLS_DIR`):

```yaml
volumes:
  - ${ONCALL_TLS_DIR:-./tls}:/etc/nginx/tls:ro
```

Katalog jest montowany tylko do odczytu. Prawa na hoście: `fullchain.pem` 0644, `privkey.pem` 0600 (właściciel root lub 101 - nginx odczytuje klucz jako root przed zmianą użytkownika).

## Konfiguracja krok po kroku

1. **Zdobądź certyfikat** (opcje w kolejnej sekcji) i złóż pliki:

   ```
   tls/
   ├── fullchain.pem   # cert serwera, potem certyfikaty pośrednie
   ├── privkey.pem     # klucz prywatny
   └── ca.pem          # opcjonalnie: wewnętrzne CA
   ```

2. **Ustaw zmienne w `.env`:**

   ```bash
   ONCALL_TLS_ENABLED=true
   ONCALL_WEB_HTTP_PORT=8080    # port przekierowania HTTP -> HTTPS
   ONCALL_WEB_HTTPS_PORT=8443   # port HTTPS wystawiony na host
   ONCALL_TLS_DIR=./tls
   ```

3. **Poinformuj backend, że ruch idzie przez HTTPS:**

   ```bash
   ONCALL_SESSION_COOKIE_SECURE=true
   ONCALL_PUBLIC_BASE_URL=https://oncall.firma.example:8443
   ONCALL_CORS_ORIGINS=["https://oncall.firma.example:8443"]
   ```

   `SESSION_COOKIE_SECURE=true` jest wymagane, żeby cookie sesji nie wyciekło po HTTP.
   Bez tej zmiany logowanie przez HTTPS działa, ale cookie nie ma flagi `Secure`.

4. **Przebuduj i uruchom:**

   ```bash
   docker compose up -d --build web api worker
   ```

5. **Weryfikacja:**

   ```bash
   curl -v https://localhost:8443/ --cacert tls/ca.pem        # 200, HTML
   curl -sI http://localhost:8080/ | head -1                  # 301 Moved Permanently
   docker compose exec web nginx -t                           # składnia konfiguracji
   ```

## Skąd wziąć certyfikat - możliwości techniczne

### A. Wewnętrzne CA firmy (zalecane w erste/AD)

1. Wygeneruj klucz i CSR na dowolnym hoście:

   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout privkey.pem -out oncall.csr \
     -subj "/CN=oncall.firma.example" \
     -addext "subjectAltName=DNS:oncall.firma.example,DNS:oncall"
   ```

2. Podpisz CSR wewnętrznym CA (zwykle zgłoszenie do zespołu PKI; w AD CS szablon "Web Server").
3. Z odpowiedzi złóż `fullchain.pem`: najpierw certyfikat serwera, potem pośrednie, na końcu opcjonalnie root.
4. Zapisz certyfikat root CA jako `ca.pem`.

**Najważniejszy krok operacyjny:** przeglądarki użytkowników muszą ufać wewnętrznemu CA.
W środowisku domenowym robi się to centralnie przez GPO
(`Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities`).
Bez dystrybucji CA użytkownicy zobaczą ostrzeżenie o niezaufanym certyfikacie.

### B. Komercyjny CA (gdy aplikacja ma być dostępna spoza intranetu)

Standardowe zamówienie certyfikatu DV/OV (np. Let's Encrypt, DigiCert).
Łańcuch od dostawcy trafia do `fullchain.pem`; `ca.pem` nie jest potrzebne, bo root jest w magazynie systemowym klientów.
Let's Encrypt wymaga wystawienia portu 80 na zewnątrz (challenge HTTP-01) albo DNS-01; odnawianie pozostaje po stronie zamawiającego.

### C. mkcert (tylko dev/test lokalny)

```bash
mkcert -install                      # tworzy lokalne CA i dodaje je do systemu
mkcert -cert-file fullchain.pem -key-file privkey.pem localhost 127.0.0.1 oncall.local
cp "$(mkcert -CAROOT)/rootCA.pem" ca.pem
```

Daje zieloną kłódkę na maszynie deweloperskiej bez ostrzeżeń. Nie nadaje się do produkcji.

## Odnawianie i rotacja certyfikatów

Certyfikat jest montowany z hosta, więc rotacja nie wymaga przebudowy obrazu:

```bash
# po podmianie plików w ./tls
docker compose exec web nginx -s reload
```

Reload nginx nie zrywa istniejących połączeń. Warto podpiąć rotację pod monitoring daty ważności certyfikatu.

## Warianty alternatywne

| Wariant | Kiedy wybrać | Konsekwencje |
| --- | --- | --- |
| **TLS na nginx w obrazie (ten dokument)** | Brak istniejącego reverse proxy w organizacji | Pełna kontrola, zero dodatkowych usług |
| **Zewnętrzny reverse proxy przed compose** (Traefik, nginx, HAProxy, Apache, F5) | Organizacja ma centralny punkt terminacji TLS i zarządzania certami | `ONCALL_TLS_ENABLED=false`, proxy kieruje na `web:8080`; certy pozostają poza projektem |
| **TLS na API (uvicorn) zamiast nginx** | Odradzane | Rozdziela zarządzanie certami na dwa miejsca; uvicorn ma ubogą obsługę TLS w porównaniu z nginx |
| **mTLS (certyfikaty klienckie)** | Gdyby dostęp miał być ograniczony do urządzeń firmowych | `ssl_client_certificate /etc/nginx/tls/ca.pem; ssl_verify_client on;` - wymaga dystrybucji certów klienckich; nie zastępuje logowania |

## Uwagi bezpieczeństwa

- `ssl_protocols TLSv1.2 TLSv1.3` - TLS 1.0/1.1 są wyłączone.
- Klucz prywatny nigdy nie trafia do obrazu ani repozytorium; katalog `./tls` należy dodać do `.gitignore`.
- Po włączeniu TLS wszystkie linki w e-mailach i ICS korzystają z `ONCALL_PUBLIC_BASE_URL`, więc zmienna musi wskazywać adres `https://`, inaczej powiadomienia będą prowadzić na niedziałający adres.
- ICS (subskrypcje kalendarza) działa przez ten sam nginx (`/calendar/`), więc jest objęty tym samym certyfikatem.
