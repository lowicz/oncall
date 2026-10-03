"""Send the database backup alert through the application's own SMTP settings.

`deploy/backup/oncall-backup.sh` runs this inside the running `api` (or
`worker`) container, which already carries every `ONCALL_SMTP_*` value, so
the host needs no mail setup of its own:

    podman exec -i <api> python -m oncall.backup_alert \\
        --to admin@example.com --host db1 --step dump \\
        --failed-at 2026-09-26T21:05:00+02:00 < details

The details are the lines the script recorded, read from standard input. The
message goes straight to SMTP, not through the outbox: the database may be
what failed, and the alert must not depend on it.
"""

import argparse
import asyncio
import sys
from datetime import datetime

from oncall.config import get_settings
from oncall.notifications.base import NotificationDisabled, NotificationError, NotificationMessage
from oncall.notifications.email import SmtpEmailProvider
from oncall.notifications.layout import Brand
from oncall.notifications.templates import backup_failed

#: Standard input is the script's own record of one run; anything longer is
#: not a detail any more.
MAX_DETAIL_LINES = 40


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m oncall.backup_alert")
    parser.add_argument("--to", action="append", required=True, help="recipient, repeatable")
    parser.add_argument("--host", required=True, help="the host whose backup failed")
    parser.add_argument("--step", required=True, help="the backup step that failed")
    parser.add_argument(
        "--failed-at",
        required=True,
        type=datetime.fromisoformat,
        help="ISO 8601 time of the failure, with its offset",
    )
    parser.add_argument("--test", action="store_true", help="send the test alert instead")
    return parser.parse_args(argv)


async def send_alert(args: argparse.Namespace, details: list[str]) -> list[str]:
    """Send one message per recipient; return the recipients that failed."""
    settings = get_settings()
    rendered = backup_failed(
        host=args.host,
        failed_at=args.failed_at,
        step=args.step,
        details=details,
        app=Brand.from_settings(settings),
        test=args.test,
    )
    provider = SmtpEmailProvider(settings)
    failed = []
    for recipient in args.to:
        message = NotificationMessage(
            channel=SmtpEmailProvider.channel,
            recipient=recipient,
            subject=rendered.subject,
            body=rendered.text,
            html_body=rendered.html,
        )
        try:
            await provider.send(message)
        except NotificationDisabled:
            raise
        except NotificationError as exc:
            print(f"backup alert to {recipient} failed: {exc}", file=sys.stderr)
            failed.append(recipient)
    return failed


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    details = [line.rstrip() for line in sys.stdin.read().splitlines() if line.strip()]
    try:
        failed = asyncio.run(send_alert(args, details[-MAX_DETAIL_LINES:]))
    except NotificationDisabled:
        print("backup alert not sent: ONCALL_SMTP_HOST is not set", file=sys.stderr)
        return 2
    if failed:
        return 1
    print(f"backup alert sent to {', '.join(args.to)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
