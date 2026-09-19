#!/bin/sh
# Picks the HTTP or HTTPS nginx preset before nginx starts.
#
# ONCALL_TLS_ENABLED=true requires the certificate and key mounted at
# /etc/nginx/tls/fullchain.pem and /etc/nginx/tls/privkey.pem. A CA mounted at
# /etc/nginx/tls/ca.pem is additionally appended to the container trust store,
# so proxied HTTPS backends and in-container tools trust it.
set -eu

CONF_DIR=/etc/nginx/conf.d
TLS_DIR=/etc/nginx/tls

if [ "${ONCALL_TLS_ENABLED:-false}" = "true" ]; then
    for required in fullchain.pem privkey.pem; do
        if [ ! -s "$TLS_DIR/$required" ]; then
            echo "ONCALL_TLS_ENABLED=true but $TLS_DIR/$required is missing or empty" >&2
            exit 1
        fi
    done
    cp /etc/nginx/presets/https.conf "$CONF_DIR/default.conf"
    echo "oncall: TLS enabled, serving HTTPS on 443 and redirecting HTTP on 80"
else
    cp /etc/nginx/presets/http.conf "$CONF_DIR/default.conf"
    echo "oncall: TLS disabled, serving plain HTTP on 80"
fi

if [ -s "$TLS_DIR/ca.pem" ]; then
    cat "$TLS_DIR/ca.pem" >> /etc/ssl/certs/ca-certificates.crt
    echo "oncall: internal CA from $TLS_DIR/ca.pem added to the trust store"
fi
