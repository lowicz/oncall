"""Registers every mapped class with the shared declarative registry.

Import this module for its side effect only. Relationships between feature
modules name their targets as forward references, which SQLAlchemy resolves
the first time any mapper is used; that works only once every model module has
been imported. Process entry points, Alembic and the test database bootstrap
import this module so `Base.metadata` and the mapper graph are complete.

It names no class. Feature code imports a row from the module that owns it.
"""

import oncall.infrastructure.sqlalchemy.access_models  # noqa: F401
import oncall.infrastructure.sqlalchemy.audit_model  # noqa: F401
import oncall.infrastructure.sqlalchemy.availability_model  # noqa: F401
import oncall.infrastructure.sqlalchemy.calendar_model  # noqa: F401
import oncall.infrastructure.sqlalchemy.notification_models  # noqa: F401
import oncall.infrastructure.sqlalchemy.scheduling_models  # noqa: F401
import oncall.infrastructure.sqlalchemy.sharing_models  # noqa: F401
import oncall.infrastructure.sqlalchemy.swap_models  # noqa: F401
import oncall.infrastructure.sqlalchemy.team_models  # noqa: F401
