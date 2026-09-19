"""ASGI entry point kept stable for Uvicorn and existing deployments."""

from oncall.bootstrap.http import create_app

app = create_app()

__all__ = ["app", "create_app"]
