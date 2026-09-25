# TLS

TLS terminates at the `web` container (nginx). The backend (`api`, `worker`)
stays on HTTP inside the container network - this is the standard and
recommended shape for this stack.

```
browser ──HTTPS──> web (nginx, TLS terminates here) ──HTTP──> api (uvicorn)
```

## Three files, not a directory

The configuration mounts **three separate files**, each under its own path and
pointed at by its own variable:

| Path in the container | Variable | Contents |
| --- | --- | --- |
| `/etc/nginx/tls/cert.pem` | `ONCALL_TLS_CERT_FILE` | **the server certificate alone, without the chain** |
| `/etc/nginx/tls/privkey.pem` | `ONCALL_TLS_KEY_FILE` | the private key, without a passphrase |
| `/etc/nginx/tls/ca.pem` | `ONCALL_TLS_CA_FILE` | **the complete system CA trust bundle** |

Why three files and not one directory:

- **Three different sources.** The certificate comes from the PKI, the key is
  generated locally and never leaves the host, and the CA bundle is shared by
  the whole organisation. Each has a different lifecycle and different access
  rights.
- **Rotation of a single file.** Replacing the certificate touches neither the
  key nor the CA.
- **An unambiguous error.** With a directory mount a missing file surfaces
  only as an nginx error. The entrypoint script checks each of the three files
  separately and says which one is missing and which variable points at it.
- **The same result under Docker and Podman.** A non-existent host path is not
  refused: it is created as an **empty directory**. The mount succeeds, and
  nginx falls over later on the file path, without saying which variable is
  wrong. Checking the three files at start turns this into one sentence and
  behaves identically in both environments.

### Certificate without the chain

`ssl_certificate` points at **the server certificate only**. Intermediate
certificates are not appended to it - this deployment's clients have them in
the same trust bundle that is mounted as `ca.pem` and distributed in the
organisation (in a domain usually through GPO).

A consequence to be aware of: **a browser that does not have this bundle will
not build the chain by itself.** This is an internal deployment, where trust
is distributed centrally. If the application is to be available to clients
outside the organisation, use a commercial certificate and, where the chain
has to travel with the server, point `ONCALL_TLS_CERT_FILE` at a file
containing the server certificate together with the intermediates - the file
format does not change, its contents do.

### Complete system trust bundle

`ca.pem` is the full set of authorities this deployment is to trust. nginx
reads it directly as `ssl_trusted_certificate`.

The same file is ready as `proxy_ssl_trusted_certificate`, should the API ever
be proxied over HTTPS - the relevant lines are in
`frontend/nginx.https.conf` as a comment.

The entrypoint script does not change the container's own trust store
(`/etc/ssl/certs`): the image runs as an unprivileged user on a read-only
filesystem, and nothing in it verifies certificates against that store.

## Enabling

TLS is an overlay on the base file, so that a deployment without a certificate
does not need any files on the host:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
podman compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

The overlay sets `ONCALL_TLS_ENABLED=true` and mounts the three files. The
default host paths are `./tls/cert.pem`, `./tls/privkey.pem` and
`./tls/ca.pem`; each of them is overridden by the corresponding variable:

```bash
# .env
ONCALL_TLS_CERT_FILE=/etc/pki/oncall/oncall.crt
ONCALL_TLS_KEY_FILE=/etc/pki/oncall/oncall.key
ONCALL_TLS_CA_FILE=/etc/pki/tls/certs/ca-bundle.crt
ONCALL_WEB_HTTP_PORT=8080     # HTTP -> HTTPS redirect
ONCALL_WEB_HTTPS_PORT=8443
```

Also tell the backend that the traffic goes over HTTPS:

```bash
ONCALL_PUBLIC_BASE_URL=https://oncall.firma.example:8443
ONCALL_CORS_ORIGINS=["https://oncall.firma.example:8443"]
```

The TLS overlay sets `ONCALL_SESSION_COOKIE_SECURE=true` for the `api` and
`worker` services by itself, so the session cookie does not leak over HTTP
without a manual edit of `.env` (an explicit `ONCALL_SESSION_COOKIE_SECURE` in
`.env` still takes precedence). In addition the backend **will not start** if
`ONCALL_PUBLIC_BASE_URL` is on `https://` and the session cookie is not
`Secure` - a wrong configuration cannot be run quietly. Without
`ONCALL_PUBLIC_BASE_URL` on `https://`, the links in e-mails and ICS feeds
would lead to an address that no longer works.

All three files must exist on the host **before** the container starts.

### File permissions

nginx runs in the container as an unprivileged user with number `101` and
reads all three files as that user. The certificate and the CA bundle have
`0644` permissions, the key `0600` with owner `101`:

```bash
sudo chown 101:101 /etc/pki/oncall/oncall.key
sudo chmod 600 /etc/pki/oncall/oncall.key
```

Under **rootless Podman** the container's user `101` has a different number on
the host, so the owner is set from Podman's user namespace:

```bash
podman unshare chown 101:101 ./tls/privkey.pem
```

A key that this user cannot read stops the container start with a message
pointing at the file - see below.

## Verification

```bash
# nginx checks the configuration itself, at container start - this only repeats it
docker compose exec web nginx -t

curl -sI http://localhost:8080/ | head -1          # 301 Moved Permanently
curl -v https://localhost:8443/ --cacert ./tls/ca.pem   # 200, HTML
openssl s_client -connect localhost:8443 -showcerts </dev/null | head -20
```

The entrypoint script does not allow a start with a missing or unreadable
file. Typical messages:

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

```
oncall: /etc/nginx/tls/privkey.pem is not readable by the nginx user (uid 101).
oncall: nginx runs unprivileged, so the file ONCALL_TLS_KEY_FILE points at must be
oncall: readable by the container's uid 101; docs/wdrozenie/tls.md shows how.
```

The last message means that the key has the wrong owner or the wrong
permissions - see [File permissions](#file-permissions).

## Where to get the files

### A. The organisation's internal CA (recommended)

1. Generate a key and a CSR:

   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout privkey.pem -out oncall.csr \
     -subj "/CN=oncall.firma.example" \
     -addext "subjectAltName=DNS:oncall.firma.example,DNS:oncall"
   ```

2. Have the CSR signed by the internal CA (usually a request to the PKI team;
   in AD CS the “Web Server” template).
3. Save **the server certificate alone** as `cert.pem`, without appending the
   intermediates.
4. As `ca.pem` save the organisation's trust bundle (root plus intermediates).

The most important operational step: users' browsers must trust this CA. In a
domain this is done centrally through GPO (`Computer Configuration → Windows
Settings → Security Settings → Public Key Policies → Trusted Root Certification
Authorities`). Without CA distribution users will see a warning.

### B. A commercial CA

For an application available from outside the intranet. The server certificate
goes into `cert.pem`; because browsers outside the organisation build the
chain themselves, `ONCALL_TLS_CERT_FILE` should then point at a file with the
server certificate and the intermediates. As `ca.pem` point at the host's
system trust bundle, for example `/etc/pki/tls/certs/ca-bundle.crt` or
`/etc/ssl/certs/ca-certificates.crt`.

### C. mkcert (local dev/test only)

```bash
mkcert -install
mkcert -cert-file tls/cert.pem -key-file tls/privkey.pem localhost 127.0.0.1 oncall.local
cp "$(mkcert -CAROOT)/rootCA.pem" tls/ca.pem
sudo chown 101:101 tls/privkey.pem
# under rootless Podman instead: podman unshare chown 101:101 tls/privkey.pem
```

Gives a green padlock on a development machine. Not suitable for production.

## Rotation

The files are mounted from the host, so rotation requires no image rebuild:

```bash
# after replacing the certificate file
docker compose exec web nginx -s reload
```

A reload does not drop existing connections. Replacing a single file does not
touch the other two. A new key needs the same permissions as the previous one
([File permissions](#file-permissions)). It is worth hooking the certificate's
expiry date up to monitoring.

## Alternative variants

| Variant | When | Consequences |
| --- | --- | --- |
| TLS on nginx in this image | no central reverse proxy | full control, zero additional services |
| An external reverse proxy in front of Compose (Traefik, nginx, HAProxy, F5) | the organisation has a central termination point | `ONCALL_TLS_ENABLED=false`, the proxy directs to `web` (the host port or `web:8080` in the Compose network), certificates outside the project |
| TLS on uvicorn instead of nginx | discouraged | splits certificate management into two places, poorer TLS support |
| mTLS (client certificates) | access only from company devices | `ssl_client_certificate /etc/nginx/tls/ca.pem; ssl_verify_client on;` - requires distributing client certificates and does not replace sign-in |

## Security notes

- nginx adds security headers to every response
  (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`), and on the HTTPS path additionally
  `Strict-Transport-Security`. The nginx version is not disclosed
  (`server_tokens off`).
- `ssl_protocols TLSv1.2 TLSv1.3` - TLS 1.0 and 1.1 are disabled.
- nginx runs as the unprivileged user `101`, without kernel capabilities and
  on a read-only filesystem - see
  [Container privileges](uruchomienie.md#container-privileges).
- The private key never goes into the image or the repository. The `tls/`
  directory and `*.pem`, `*.key`, `*.crt` and `*.p12` are in `.gitignore` and
  in `.dockerignore`.
- The ICS feeds go through the same nginx (`/calendar/`), so they are covered
  by the same certificate.
- After enabling TLS check `ONCALL_PUBLIC_BASE_URL`: the links in
  notifications and the ICS feed addresses are built from it.
