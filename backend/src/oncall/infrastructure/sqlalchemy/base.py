"""Shared declarative registry for all SQLAlchemy persistence models."""

from typing import Any

from sqlalchemy import Connection, MetaData, String, event, text
from sqlalchemy.orm import DeclarativeBase

#: ICU's Polish collation, which the PostgreSQL image ships: a letter with a
#: diacritic sorts right after its base letter and case does not decide the
#: order, where the database default compares code points and puts every
#: such letter, and every lower-case name, after Z.
POLISH_COLLATION = "pl-PL-x-icu"


class Base(DeclarativeBase):
    pass


def polish_text(length: int) -> String:
    """A name people read in sorted lists, ordered the Polish way.

    PostgreSQL only: SQLite has no ICU, and the test databases keep its
    ordering, which no test depends on for non-ASCII names.
    """
    return String(length).with_variant(String(length, collation=POLISH_COLLATION), "postgresql")


# The exclusion constraints on eligibility and availability compare a uuid
# and a varchar with GiST, which takes this extension. Migration 0038 creates
# it on a deployed database; this does the same for a schema built from the
# models.
@event.listens_for(Base.metadata, "before_create")
def _create_btree_gist(_: MetaData, connection: Connection, **__: Any) -> None:
    if connection.dialect.name == "postgresql":
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
