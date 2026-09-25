"""Where Polish is allowed to be written in the source.

The interface is served in the language of the request, so every sentence a
person reads over HTTP comes from the catalogs in `oncall.i18n`: a Polish
sentence written anywhere else in `src/oncall` is one English readers would
still see. The exception is what the application records or sends rather than
answers - audit summaries, decision notes, run diagnostics, draft names,
e-mails, ICS feeds, the operator's log - which is written once, in the
recorded language, and listed here module by module so that a new one cannot
join unnoticed.
"""

import re
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "src" / "oncall"
POLISH = re.compile("[ąęłńóśżźćĄĘŁŃÓŚŻŹĆ]")

#: The Polish catalog itself.
CATALOG = "i18n/pl.py"

#: Modules that write Polish on purpose, and why.
RECORDED_LANGUAGE = {
    # audit summaries and recorded notes
    "infrastructure/sqlalchemy/access.py",
    "infrastructure/sqlalchemy/admin.py",
    "infrastructure/sqlalchemy/availability.py",
    "infrastructure/sqlalchemy/calendar.py",
    "infrastructure/sqlalchemy/history.py",
    "infrastructure/sqlalchemy/overrides.py",
    "infrastructure/sqlalchemy/scheduling_journal.py",
    "infrastructure/sqlalchemy/scheduling_publication.py",
    "infrastructure/sqlalchemy/sharing.py",
    "infrastructure/sqlalchemy/swaps.py",
    "domain/admin/models.py",  # the display name of an erased member
    "domain/availability/models.py",  # availability kinds as the audit log names them
    "domain/scheduling/drafts.py",  # the kind of schedule an audit entry says was deleted
    "domain/scheduling/generation.py",  # the draft's name and an abandoned run's error
    "domain/swaps/models.py",  # the decision note of an automatic cancellation
    # solver diagnostics and worker errors, stored on the generation run
    "scheduler.py",
    "worker.py",
    # e-mails
    "notifications/email.py",
    "notifications/layout.py",
    "notifications/service.py",
    "notifications/templates.py",
    "notifications/triggers.py",
    # the operator's log and the demo seed
    "ldap_auth.py",
    "seed_demo.py",
    # integrity guards on the mapped rows, never answered to a request
    "infrastructure/sqlalchemy/access_models.py",
}


def _modules_writing_polish() -> set[str]:
    return {
        path.relative_to(SOURCE_ROOT).as_posix()
        for path in SOURCE_ROOT.rglob("*.py")
        if POLISH.search(path.read_text(encoding="utf-8"))
    }


def test_polish_is_written_only_in_the_catalog_and_the_recorded_modules() -> None:
    unexpected = _modules_writing_polish() - RECORDED_LANGUAGE - {CATALOG}
    assert sorted(unexpected) == [], (
        "Polish text outside the catalog; move it to oncall.i18n or, if it is "
        "recorded rather than answered, list the module in RECORDED_LANGUAGE"
    )


def test_the_recorded_language_list_names_only_modules_that_still_write_polish() -> None:
    stale = RECORDED_LANGUAGE - _modules_writing_polish()
    assert sorted(stale) == [], "modules listed in RECORDED_LANGUAGE no longer write Polish"
