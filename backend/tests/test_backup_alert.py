"""`python -m oncall.backup_alert`: the mail `deploy/backup/oncall-backup.sh`
sends when a database backup fails, straight through the application's SMTP
settings."""

import io
import runpy
import sys
from pathlib import Path

import aiosmtplib
import pytest

from oncall import backup_alert, config
from oncall.config import Settings
from tests.smtp_relay import Relay, private_ca, serving

ARGS = [
    "--to",
    "admin@example.com",
    "--to",
    "ops@example.com",
    "--host",
    "oncall-prod",
    "--step",
    "verify",
    "--failed-at",
    "2026-09-24T02:30:00+02:00",
]


def settings(**overrides) -> Settings:
    values = {
        "smtp_host": "smtp.example.com",
        "email_from": "On-call <oncall@example.com>",
        "public_base_url": "https://oncall.example.com",
        "session_cookie_secure": True,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def sent(monkeypatch) -> list:
    messages: list = []

    async def fake_send(email_message, **kwargs):
        if email_message["To"] in {"refused@example.com"}:
            raise aiosmtplib.SMTPRecipientsRefused([])
        messages.append(email_message)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr(backup_alert, "get_settings", lambda: settings())
    return messages


def run(monkeypatch, argv: list[str], details: str) -> int:
    monkeypatch.setattr(sys, "stdin", io.StringIO(details))
    return backup_alert.main(argv)


def test_the_alert_reaches_every_recipient_with_the_recorded_details(monkeypatch, sent) -> None:
    details = "restore test: pg_restore exited 1\n\npg_restore: error: could not read input\n"
    assert run(monkeypatch, ARGS, details) == 0
    assert [mail["To"] for mail in sent] == ["admin@example.com", "ops@example.com"]
    mail = sent[0]
    assert mail["Subject"] == "Kopia zapasowa bazy nie powiodła się: oncall-prod"
    text = mail.get_body(("plain",)).get_content()
    assert "24-09-2026 02:30" in text
    assert "Krok: test odtworzenia" in text
    assert "  pg_restore: error: could not read input" in text
    assert "https://oncall.example.com/docs/wdrozenie/kopie-zapasowe.html" in text
    assert mail.get_body(("html",)) is not None


def test_only_the_last_detail_lines_are_sent(monkeypatch, sent) -> None:
    details = "".join(f"line {n}\n" for n in range(100))
    assert run(monkeypatch, ARGS, details) == 0
    text = sent[0].get_body(("plain",)).get_content()
    assert "line 99" in text
    assert f"line {100 - backup_alert.MAX_DETAIL_LINES}\n" in text
    assert f"line {99 - backup_alert.MAX_DETAIL_LINES}\n" not in text


def test_a_refused_recipient_does_not_stop_the_others(monkeypatch, sent, capsys) -> None:
    argv = ["--to", "refused@example.com", *ARGS]
    assert run(monkeypatch, argv, "dump failed\n") == 1
    assert [mail["To"] for mail in sent] == ["admin@example.com", "ops@example.com"]
    assert "backup alert to refused@example.com failed" in capsys.readouterr().err


def test_without_smtp_the_alert_says_it_was_not_sent(monkeypatch, sent, capsys) -> None:
    monkeypatch.setattr(backup_alert, "get_settings", lambda: settings(smtp_host=None))
    assert run(monkeypatch, ARGS, "dump failed\n") == 2
    assert sent == []
    assert "ONCALL_SMTP_HOST is not set" in capsys.readouterr().err


def test_the_test_alert_says_nothing_failed(monkeypatch, sent) -> None:
    argv = [*ARGS[:6], "--step", "test", "--failed-at", "2026-09-24T09:00:00+02:00", "--test"]
    assert run(monkeypatch, argv, "") == 0
    mail = sent[0]
    assert mail["Subject"] == "Test powiadomienia o kopii zapasowej: oncall-prod"
    text = mail.get_body(("plain",)).get_content()
    assert "Nic się nie stało." in text
    assert "(brak szczegółów)" in text


def test_the_script_reads_its_arguments_and_exits_with_the_outcome(
    monkeypatch, sent, capsys
) -> None:
    """How the backup script calls it: arguments on the command line, details
    on standard input, the result as the exit status."""
    monkeypatch.setattr(config, "get_settings", lambda: settings())
    monkeypatch.setattr(sys, "argv", ["oncall.backup_alert", *ARGS])
    monkeypatch.setattr(sys, "stdin", io.StringIO("pg_dump: connection refused\n"))
    monkeypatch.delitem(sys.modules, "oncall.backup_alert")

    with pytest.raises(SystemExit) as exited:
        runpy.run_module("oncall.backup_alert", run_name="__main__")

    assert exited.value.code == 0
    assert [mail["To"] for mail in sent] == ["admin@example.com", "ops@example.com"]
    assert "pg_dump: connection refused" in sent[0].get_body(("plain",)).get_content()
    assert "backup alert sent to admin@example.com, ops@example.com" in capsys.readouterr().out


@pytest.mark.parametrize("credentials", [None, ("oncall", "secret")], ids=["no-login", "login"])
def test_the_alert_goes_out_with_or_without_an_smtp_login(monkeypatch, credentials) -> None:
    """The alert takes the application's own path to the SMTP server: to a
    relay that takes no login and trusts the EHLO name, and to a server that
    wants the application to log in first."""
    username, password = credentials or ("", "")
    with serving(Relay(credentials=credentials, trusted_client="oncall-prod.example.com")) as relay:
        configured = settings(
            smtp_host="127.0.0.1",
            smtp_port=relay.port,
            smtp_starttls=False,
            smtp_local_hostname="oncall-prod.example.com",
            smtp_username=username,
            smtp_password=password,
        )
        monkeypatch.setattr(backup_alert, "get_settings", lambda: configured)
        exit_code = run(monkeypatch, ARGS, "pg_dump: connection refused\n")

    assert exit_code == 0
    assert relay.commands[0] == "EHLO oncall-prod.example.com"
    assert relay.verbs.count("AUTH") == (2 if credentials else 0)
    assert [b"pg_dump: connection refused" in mail for mail in relay.messages] == [True, True]


def test_the_alert_reaches_a_server_on_an_internal_pki_through_its_ca_file(
    monkeypatch, tmp_path: Path, capsys
) -> None:
    """`oncall-backup.sh alert --test` against a STARTTLS server whose
    certificate an internal CA issued: refused without the CA, sent with it."""
    ca_file, server_tls = private_ca(tmp_path)
    with serving(Relay(tls=server_tls)) as relay:
        for ca in (None, str(ca_file)):
            configured = settings(smtp_host="127.0.0.1", smtp_port=relay.port, smtp_ca_file=ca)
            monkeypatch.setattr(backup_alert, "get_settings", lambda c=configured: c)
            assert run(monkeypatch, [*ARGS[:2], *ARGS[4:], "--test"], "") == (0 if ca else 1)

    output = capsys.readouterr()
    assert "certificate verify failed: self-signed certificate in certificate chain" in output.err
    assert "backup alert sent to admin@example.com" in output.out
    assert len(relay.messages) == 1
