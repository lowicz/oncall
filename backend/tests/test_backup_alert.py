"""`python -m oncall.backup_alert`: the mail `deploy/backup/oncall-backup.sh`
sends when a database backup fails, straight through the application's SMTP
settings."""

import io
import sys

import aiosmtplib
import pytest

from oncall import backup_alert
from oncall.config import Settings

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
