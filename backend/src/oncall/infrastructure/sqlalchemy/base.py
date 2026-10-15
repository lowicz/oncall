"""Shared declarative registry for all SQLAlchemy persistence models."""

from typing import Any

from sqlalchemy import Connection, MetaData, String, event, select, text
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

#: ICU's Polish collation, which the PostgreSQL image ships: a letter with a
#: diacritic sorts right after its base letter and case does not decide the
#: order, where the database default compares code points and puts every
#: such letter, and every lower-case name, after Z.
POLISH_COLLATION = "pl-PL-x-icu"


class Base(DeclarativeBase):
    pass


async def load_singleton[Row: Base](db: AsyncSession, model: type[Row]) -> Row:
    """The one row of a table that holds one at most, by its unique
    `singleton` column, created with the model's defaults on first use.

    A created row is written, not committed: it belongs to whichever unit of
    work the caller is in. Of two callers creating it at once, the second
    skips its insert and reads the first one's row.
    """
    row = await db.scalar(select(model).limit(1))
    if row is not None:
        return row
    insert = postgresql.insert if db.get_bind().dialect.name == "postgresql" else sqlite.insert
    await db.execute(
        insert(model).values(singleton=True).on_conflict_do_nothing(index_elements=["singleton"])
    )
    return (await db.scalars(select(model).limit(1))).one()


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
