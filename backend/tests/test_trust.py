"""The deployment's trust: the image's public roots plus `ONCALL_CA_FILE`."""

import ssl
from pathlib import Path

import pytest

from oncall.config import Settings
from oncall.trust import CaFileUnreadable, ca_file, tls_context
from tests.smtp_relay import private_ca


def test_without_a_ca_file_the_public_roots_alone_decide(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The roots come from OpenSSL's default bundle, pinned here: a hashed
    directory, the runner's default, loads lazily and counts as none."""
    roots, _ = private_ca(tmp_path)
    monkeypatch.setenv("SSL_CERT_FILE", str(roots))
    monkeypatch.setenv("SSL_CERT_DIR", str(tmp_path / "no-such-dir"))

    assert ca_file(Settings(ca_file=None)) is None
    assert tls_context(Settings(ca_file=None)).cert_store_stats()["x509_ca"] == 1


def test_the_ca_file_is_added_to_the_verified_public_roots(tmp_path: Path) -> None:
    bundle, _ = private_ca(tmp_path)
    public = tls_context(Settings(ca_file=None)).cert_store_stats()["x509_ca"]

    context = tls_context(Settings(ca_file=str(bundle)))

    assert context.cert_store_stats()["x509_ca"] == public + 1
    assert context.verify_mode is ssl.CERT_REQUIRED
    assert context.check_hostname


def test_a_missing_bind_source_is_unreadable_and_named(tmp_path: Path) -> None:
    """Compose creates a missing bind source as an empty directory."""
    settings = Settings(ca_file=str(tmp_path))
    with pytest.raises(CaFileUnreadable, match=rf"ONCALL_CA_FILE is unreadable \({tmp_path}\)"):
        ca_file(settings)


def test_a_file_holding_no_certificate_is_unreadable(tmp_path: Path) -> None:
    bundle = tmp_path / "ca.pem"
    bundle.write_text("not a certificate\n")
    settings = Settings(ca_file=str(bundle))

    with pytest.raises(CaFileUnreadable) as refused:
        tls_context(settings)

    assert refused.value.path == str(bundle)
