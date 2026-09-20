# TLS

TLS kończy się na kontenerze `web` (nginx). Backend (`api`, `worker`) zostaje po
HTTP wewnątrz sieci kontenerów - to standardowy i zalecany kształt dla tego
stosu.

```
przeglądarka ──HTTPS──> web (nginx, tu kończy się TLS) ──HTTP──> api (uvicorn)
```

## Trzy pliki, nie katalog

Konfiguracja montuje **trzy osobne pliki**, każdy pod własną ścieżką i wskazany
własną zmienną:

| Ścieżka w kontenerze | Zmienna | Zawartość |
| --- | --- | --- |
| `/etc/nginx/tls/cert.pem` | `ONCALL_TLS_CERT_FILE` | **sam certyfikat serwera, bez łańcucha** |
| `/etc/nginx/tls/privkey.pem` | `ONCALL_TLS_KEY_FILE` | klucz prywatny, bez hasła |
| `/etc/nginx/tls/ca.pem` | `ONCALL_TLS_CA_FILE` | **kompletny systemowy pakiet zaufania CA** |

Dlaczego trzy pliki, a nie jeden katalog:

- **Trzy różne źródła.** Certyfikat przychodzi z PKI, klucz powstaje lokalnie i
  nigdy nie opuszcza hosta, a pakiet CA jest wspólny dla całej organizacji.
  Każdy ma inny cykl życia i inne prawa dostępu.
- **Rotacja pojedynczego pliku.** Wymiana certyfikatu nie dotyka klucza ani CA.
- **Jednoznaczny błąd.** Przy montowaniu katalogu brak pliku wychodzi dopiero
  jako błąd nginx. Skrypt startowy sprawdza każdy z trzech plików osobno i
  mówi, którego brakuje i która zmienna go wskazuje.
- **Ten sam wynik pod Dockerem i Podmanem.** Nieistniejąca ścieżka hosta nie
  jest odrzucana: zostaje utworzona jako **pusty katalog**. Mount się udaje,
  a nginx wywraca się później na ścieżce pliku, nie mówiąc, która zmienna jest
  zła. Kontrola trzech plików przy starcie zamienia to w jedno zdanie i
  zachowuje się identycznie w obu środowiskach.

### Certyfikat bez łańcucha

`ssl_certificate` wskazuje **wyłącznie certyfikat serwera**. Certyfikaty
pośrednie nie są do niego doklejane - klienci tego wdrożenia mają je w tym samym
pakiecie zaufania, który jest montowany jako `ca.pem` i rozprowadzany w
organizacji (w domenie zwykle przez GPO).

Konsekwencja, którą trzeba znać: **przeglądarka, która nie ma tego pakietu, nie
zbuduje łańcucha sama.** To jest wdrożenie wewnętrzne, gdzie zaufanie jest
rozprowadzane centralnie. Jeżeli aplikacja ma być dostępna dla klientów spoza
organizacji, użyj certyfikatu komercyjnego i tam, gdzie łańcuch musi jechać z
serwerem, wskaż w `ONCALL_TLS_CERT_FILE` plik zawierający certyfikat serwera
wraz z pośrednimi - format pliku nie zmienia się, zmienia się jego zawartość.

### Kompletny systemowy pakiet zaufania

`ca.pem` to pełny zestaw urzędów, którym ma ufać to wdrożenie. Przy starcie
kontenera jest:

1. **dopisywany do magazynu zaufania kontenera** (`/etc/ssl/certs/ca-certificates.crt`),
   więc proxowane backendy HTTPS i narzędzia w kontenerze ufają tym samym
   urzędom co wdrożenie; publiczne korzenie z obrazu zostają na miejscu,
2. wskazywany nginx jako `ssl_trusted_certificate`.

Ten sam plik jest gotowy jako `proxy_ssl_trusted_certificate`, gdyby API miało
kiedyś być proxowane po HTTPS - odpowiednie linie są w
`frontend/nginx.https.conf` jako komentarz.

## Włączenie

TLS jest nakładką na plik bazowy, żeby wdrożenie bez certyfikatu nie musiało
mieć żadnych plików na hoście:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
podman compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

Nakładka ustawia `ONCALL_TLS_ENABLED=true` i montuje trzy pliki. Domyślne
ścieżki hosta to `./tls/cert.pem`, `./tls/privkey.pem` i `./tls/ca.pem`; każdą z
nich nadpisuje odpowiednia zmienna:

```bash
# .env
ONCALL_TLS_CERT_FILE=/etc/pki/oncall/oncall.crt
ONCALL_TLS_KEY_FILE=/etc/pki/oncall/oncall.key
ONCALL_TLS_CA_FILE=/etc/pki/tls/certs/ca-bundle.crt
ONCALL_WEB_HTTP_PORT=8080     # przekierowanie HTTP -> HTTPS
ONCALL_WEB_HTTPS_PORT=8443
```

Powiedz też backendowi, że ruch idzie po HTTPS:

```bash
ONCALL_SESSION_COOKIE_SECURE=true
ONCALL_PUBLIC_BASE_URL=https://oncall.firma.example:8443
ONCALL_CORS_ORIGINS=["https://oncall.firma.example:8443"]
```

`ONCALL_SESSION_COOKIE_SECURE=true` jest wymagane, żeby cookie sesji nie
wyciekło po HTTP. Bez `ONCALL_PUBLIC_BASE_URL` na `https://` linki w e-mailach i
kanałach ICS prowadziłyby pod adres, który już nie działa.

Wszystkie trzy pliki muszą istnieć na hoście **przed** startem kontenera.

Prawa na hoście: certyfikat i pakiet CA `0644`, klucz `0600` (właściciel `root`
albo `101`; nginx czyta klucz jako root przed zmianą użytkownika).

## Weryfikacja

```bash
# nginx sprawdza konfigurację sam, przy starcie kontenera - to tylko powtórzenie
docker compose exec web nginx -t

curl -sI http://localhost:8080/ | head -1          # 301 Moved Permanently
curl -v https://localhost:8443/ --cacert ./tls/ca.pem   # 200, HTML
openssl s_client -connect localhost:8443 -showcerts </dev/null | head -20
```

Skrypt startowy nie pozwala wystartować z brakującym plikiem. Typowe komunikaty:

```
oncall: ONCALL_TLS_ENABLED=true but /etc/nginx/tls/cert.pem is missing or empty.
oncall: mount the server certificate without its chain there, through ONCALL_TLS_CERT_FILE.
```

```
oncall: /etc/nginx/tls/privkey.pem is a directory, not a file.
oncall: ONCALL_TLS_KEY_FILE must point at the private key. A bind source that does not
oncall: exist on the host is created as an empty directory rather than
oncall: refused, so create the file first.
```

## Skąd wziąć pliki

### A. Wewnętrzne CA organizacji (zalecane)

1. Wygeneruj klucz i CSR:

   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout privkey.pem -out oncall.csr \
     -subj "/CN=oncall.firma.example" \
     -addext "subjectAltName=DNS:oncall.firma.example,DNS:oncall"
   ```

2. Podpisz CSR wewnętrznym CA (zwykle zgłoszenie do zespołu PKI; w AD CS szablon
   „Web Server”).
3. Zapisz **sam certyfikat serwera** jako `cert.pem`, bez doklejania pośrednich.
4. Jako `ca.pem` zapisz pakiet zaufania organizacji (root plus pośrednie).

Najważniejszy krok operacyjny: przeglądarki użytkowników muszą ufać temu CA. W
domenie robi się to centralnie przez GPO (`Computer Configuration → Windows
Settings → Security Settings → Public Key Policies → Trusted Root Certification
Authorities`). Bez dystrybucji CA użytkownicy zobaczą ostrzeżenie.

### B. Komercyjne CA

Dla aplikacji dostępnej spoza intranetu. Certyfikat serwera trafia do
`cert.pem`; ponieważ przeglądarki spoza organizacji budują łańcuch same,
`ONCALL_TLS_CERT_FILE` powinno wtedy wskazywać plik z certyfikatem serwera i
pośrednimi. Jako `ca.pem` wskaż systemowy pakiet zaufania hosta, na przykład
`/etc/pki/tls/certs/ca-bundle.crt` albo `/etc/ssl/certs/ca-certificates.crt`.

### C. mkcert (tylko lokalny dev/test)

```bash
mkcert -install
mkcert -cert-file tls/cert.pem -key-file tls/privkey.pem localhost 127.0.0.1 oncall.local
cp "$(mkcert -CAROOT)/rootCA.pem" tls/ca.pem
```

Daje zieloną kłódkę na maszynie deweloperskiej. Nie nadaje się do produkcji.

## Rotacja

Pliki są montowane z hosta, więc rotacja nie wymaga przebudowy obrazu:

```bash
# po podmianie pliku certyfikatu
docker compose exec web nginx -s reload
```

Reload nie zrywa istniejących połączeń. Wymiana pojedynczego pliku nie dotyka
pozostałych dwóch. Warto podpiąć datę ważności certyfikatu pod monitoring.

## Warianty alternatywne

| Wariant | Kiedy | Konsekwencje |
| --- | --- | --- |
| TLS na nginx w tym obrazie | brak centralnego reverse proxy | pełna kontrola, zero dodatkowych usług |
| Zewnętrzne reverse proxy przed Compose (Traefik, nginx, HAProxy, F5) | organizacja ma centralny punkt terminacji | `ONCALL_TLS_ENABLED=false`, proxy kieruje na `web`, certyfikaty poza projektem |
| TLS na uvicorn zamiast nginx | odradzane | rozdziela zarządzanie certyfikatami na dwa miejsca, uboższa obsługa TLS |
| mTLS (certyfikaty klienckie) | dostęp tylko z urządzeń firmowych | `ssl_client_certificate /etc/nginx/tls/ca.pem; ssl_verify_client on;` - wymaga dystrybucji certyfikatów klienckich i nie zastępuje logowania |

## Uwagi bezpieczeństwa

- `ssl_protocols TLSv1.2 TLSv1.3` - TLS 1.0 i 1.1 są wyłączone.
- Klucz prywatny nigdy nie trafia do obrazu ani do repozytorium. Katalog `tls/`
  oraz `*.pem`, `*.key`, `*.crt` i `*.p12` są w `.gitignore` i w `.dockerignore`.
- Kanały ICS idą przez ten sam nginx (`/calendar/`), więc są objęte tym samym
  certyfikatem.
- Po włączeniu TLS sprawdź `ONCALL_PUBLIC_BASE_URL`: to z niego powstają linki
  w powiadomieniach i adresy kanałów ICS.
