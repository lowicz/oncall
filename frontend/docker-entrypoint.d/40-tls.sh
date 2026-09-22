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
# nginx reads the CA bundle itself, as `ssl_trusted_certificate`. The
# container's own trust store is left as the image ships it: the image runs as
# an unprivileged user on a read-only root filesystem, and nothing in it checks
# a peer certificate against that store.
#
# Nothing is mounted as a directory. A directory mount hides which of the three
# files is actually missing, and a bind source that does not exist on the host
# is created as an empty directory rather than refused - so the mount succeeds
# and nginx fails later, on a path, with no hint as to which variable is
# wrong. Checking each file here turns that into one sentence.
#
# nginx runs as uid 101 and reads each file as that user, the private key
# included, so a file that user cannot read stops the start here, named,
# rather than in nginx's own error.
#
# The chosen preset is copied into /etc/nginx/conf.d, which Compose mounts as a
# tmpfs: under the read-only root filesystem it is the one configuration
# directory nginx may write.
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
    if [ ! -r "$path" ]; then
        echo "oncall: $path is not readable by the nginx user (uid $(id -u))." >&2
        echo "oncall: nginx runs unprivileged, so the file $variable points at must be" >&2
        echo "oncall: readable by the container's uid $(id -u); docs/wdrozenie/tls.md shows how." >&2
        exit 1
    fi
}

if [ "${ONCALL_TLS_ENABLED:-false}" = "true" ]; then
    require_file "$CERT_FILE" "the server certificate without its chain" ONCALL_TLS_CERT_FILE
    require_file "$KEY_FILE" "the private key" ONCALL_TLS_KEY_FILE
    require_file "$CA_FILE" "the complete system trust CA bundle" ONCALL_TLS_CA_FILE

    cp /etc/nginx/presets/https.conf "$CONF_DIR/default.conf"
    echo "oncall: TLS enabled, serving HTTPS on container port 8443 and redirecting HTTP on 8080"
else
    cp /etc/nginx/presets/http.conf "$CONF_DIR/default.conf"
    echo "oncall: TLS disabled, serving plain HTTP on container port 8080"
fi

# Fails here, with the offending directive named, rather than after the daemon
# has already claimed to be starting.
nginx -t
