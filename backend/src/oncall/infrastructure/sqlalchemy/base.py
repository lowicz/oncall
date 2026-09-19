"""Shared declarative registry for all SQLAlchemy persistence models."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


__all__ = ["Base"]
