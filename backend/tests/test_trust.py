"""The deployment's trust: the image's public roots plus `ONCALL_CA_FILE`."""

import ssl
from pathlib import Path

import pytest

from oncall.config import Settings
from oncall.trust import CaFileUnreadable, ca_file, tls_context
from tests.smtp_relay import private_ca


def test_without_a_ca_file_the_public_roots_alone_decide() -> None:
    assert ca_file(Settings(ca_file=None)) is None
    assert tls_context(Settings(ca_file=None)).cert_store_stats()["x509_ca"] > 0


def test_the_ca_file_is_added_to_the_verified_public_roots(tmp_path: Path) -> None:
    bundle, _ = private_ca(tmp_path)
    public = tls_context(Settings(ca_file=None)).cert_store_stats()["x509_ca"]

    context = tls_context(Settings(ca_file=str(bundle)))

    assert context.cert_store_stats()["x509_ca"] == public + 1
    assert context.verify_mode is ssl.CERT_REQUIRED
    assert context.check_hostname


def test_a_missing_bind_source_is_unreadable_and_named(tmp_path: Path) -> None:
    """Compose creates a missing bind source as an empty directory."""
    with pytest.raises(CaFileUnreadable, match=rf"ONCALL_CA_FILE is unreadable \({tmp_path}\)"):
        ca_file(Settings(ca_file=str(tmp_path)))


def test_a_file_holding_no_certificate_is_unreadable(tmp_path: Path) -> None:
    bundle = tmp_path / "ca.pem"
    bundle.write_text("not a certificate\n")

    with pytest.raises(CaFileUnreadable) as refused:
        tls_context(Settings(ca_file=str(bundle)))

    assert refused.value.path == str(bundle)
