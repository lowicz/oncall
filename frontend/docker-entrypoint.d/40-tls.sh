#!/bin/sh
# Picks the HTTP or HTTPS nginx preset before nginx starts.
#
# With ONCALL_TLS_ENABLED=true exactly three files have to be mounted, each one
# on its own path so it can be sourced and rotated independently:
#
#   /etc/nginx/tls/cert.pem     server certificate, on its own, without a chain
#   /etc/nginx/tls/privkey.pem  its private key, unencrypted
#   /etc/nginx/tls/ca.pem       the complete CA trust bundle for this system
#
# The CA bundle is added to the container trust store, so proxied HTTPS
# backends and in-container tools trust the same authorities the deployment
# does, and is wired into nginx as `ssl_trusted_certificate`.
#
# Nothing is mounted as a directory. A directory mount hides which of the three
# files is actually missing, and a bind source that does not exist on the host
# is created as an empty directory rather than refused - so the mount succeeds
# and nginx fails later, on a path, with no hint as to which variable is
# wrong. Checking each file here turns that into one sentence.
set -eu

CONF_DIR=/etc/nginx/conf.d
TLS_DIR=/etc/nginx/tls

CERT_FILE="$TLS_DIR/cert.pem"
KEY_FILE="$TLS_DIR/privkey.pem"
CA_FILE="$TLS_DIR/ca.pem"

require_file() {
    path=$1
    what=$2
    variable=$3
    if [ -d "$path" ]; then
        echo "oncall: $path is a directory, not a file." >&2
        echo "oncall: $variable must point at $what. A bind source that does not" >&2
        echo "oncall: exist on the host is created as an empty directory rather than" >&2
        echo "oncall: refused, so create the file first." >&2
        exit 1
    fi
    if [ ! -s "$path" ]; then
        echo "oncall: ONCALL_TLS_ENABLED=true but $path is missing or empty." >&2
        echo "oncall: mount $what there, through $variable." >&2
        exit 1
    fi
}

if [ "${ONCALL_TLS_ENABLED:-false}" = "true" ]; then
    require_file "$CERT_FILE" "the server certificate without its chain" ONCALL_TLS_CERT_FILE
    require_file "$KEY_FILE" "the private key" ONCALL_TLS_KEY_FILE
    require_file "$CA_FILE" "the complete system trust CA bundle" ONCALL_TLS_CA_FILE

    cp /etc/nginx/presets/https.conf "$CONF_DIR/default.conf"

    # Appended, not replaced: the bundle carries the authorities this
    # deployment must trust, and the image's public roots stay in place for
    # everything else. Duplicates are harmless.
    cat "$CA_FILE" >> /etc/ssl/certs/ca-certificates.crt
    echo "oncall: CA bundle from $CA_FILE added to the container trust store"
    echo "oncall: TLS enabled, serving HTTPS on 443 and redirecting HTTP on 80"
else
    cp /etc/nginx/presets/http.conf "$CONF_DIR/default.conf"
    echo "oncall: TLS disabled, serving plain HTTP on 80"
fi

# Fails here, with the offending directive named, rather than after the daemon
# has already claimed to be starting.
nginx -t
