"""One channel for the numbers an operator watches.

Two processes hold the answers between them: the API can see what is waiting in
the database, but only the worker knows how long a solve took or why a run
failed. A scrape endpoint would therefore cover half the questions, and the
other half would need a table and a retention policy to reach it. Log records
reach both halves from the process that measured them, keep their history in
whatever already collects the worker's output, and need no dependency.

Records are logfmt - `event=queue queued=3 oldest_queued_seconds=41.0` - so one
line is readable on its own and a field is still greppable across thousands.
Values are numbers or single words; nothing here quotes, so a field whose value
could contain a space does not belong in a record.

The sampled records are emitted on a fixed interval whether or not anything is
happening. A gauge that goes quiet when all is well is indistinguishable from a
worker that has died, and the silence is worth more than the saved lines.
"""

import logging
from collections.abc import Mapping

#: Its own logger, so an operator can route measurements away from the
#: narrative log without losing either.
logger = logging.getLogger("oncall.metrics")


def render(event: str, fields: Mapping[str, object]) -> str:
    """One logfmt record: the event name first, then the fields as given.

    Floats are fixed at one decimal place here rather than at each call site,
    so a duration reads the same wherever it was measured.
    """
    parts = [f"event={event}"]
    parts.extend(f"{name}={_rendered(value)}" for name, value in fields.items())
    return " ".join(parts)


def _rendered(value: object) -> str:
    return f"{value:.1f}" if isinstance(value, float) else str(value)


def emit(event: str, *, level: int = logging.INFO, **fields: object) -> None:
    """Record one measurement.

    `level` is keyword-only and reserved: an event that genuinely needs an
    operator's attention, such as a reclaimed run, carries its severity here
    rather than in a second log line saying the same thing.
    """
    logger.log(level, "%s", render(event, fields))


__all__ = ["emit", "logger", "render"]
