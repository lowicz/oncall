import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import oncall.infrastructure.sqlalchemy.model_registry  # noqa: F401  # registers every mapper
from oncall.config import Settings, get_settings
from oncall.routes.access import router as access_router
from oncall.routes.admin import router as admin_router
from oncall.routes.availability import router as availability_router
from oncall.routes.calendar import router as calendar_router
from oncall.routes.fairness import router as fairness_router
from oncall.routes.feeds import router as feeds_router
from oncall.routes.history import router as history_router
from oncall.routes.published import router as published_router
from oncall.routes.reports import router as reports_router
from oncall.routes.scheduling import router as scheduling_router
from oncall.routes.share_links import router as share_links_router
from oncall.routes.swaps import router as swaps_router
from oncall.routes.system import router as system_router
from oncall.routes.team import router as team_router

_VALIDATION_MESSAGES = {
    "missing": "To pole jest wymagane.",
    "string_too_short": "Wartość jest za krótka (minimum {min_length} znaków).",
    "string_too_long": "Wartość jest za długa (maksimum {max_length} znaków).",
    "enum": "Nieprawidłowa wartość. Dozwolone: {expected}.",
}


def _translate_validation_error(error: dict) -> str:
    template = _VALIDATION_MESSAGES.get(error["type"])
    if template is not None:
        return template.format(**error.get("ctx", {}))
    if error["type"] == "value_error":
        return str(error.get("ctx", {}).get("error", error["msg"])).removeprefix("Value error, ")
    return error["msg"]


async def translated_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "detail": [
                {
                    "loc": error["loc"],
                    "msg": _translate_validation_error(error),
                    "type": error["type"],
                }
                for error in exc.errors()
            ]
        },
    )


def configure_logging() -> None:
    """Give the application's own records somewhere to go in the API process.

    Uvicorn configures its own loggers and leaves the root one bare, so an
    `oncall.*` record at INFO - a refused sign-in and why - was dropped, and a
    warning came out with neither a time nor a level. The format is the
    worker's. Libraries stay at WARNING: SQLAlchemy below that would log every
    statement with its parameters, password hashes among them.
    """
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("oncall").setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    yield


def create_app(app_settings: Settings | None = None) -> FastAPI:
    """Build the HTTP application and wire every feature router once."""
    configured = app_settings or get_settings()
    application = FastAPI(title=configured.app_name, version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configured.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
        expose_headers=["X-CSRF-Token"],
    )
    application.add_exception_handler(RequestValidationError, translated_validation_error)
    for router in (
        team_router,
        availability_router,
        calendar_router,
        history_router,
        scheduling_router,
        swaps_router,
        share_links_router,
        feeds_router,
        admin_router,
        fairness_router,
        reports_router,
        system_router,
        access_router,
        published_router,
    ):
        application.include_router(router)
    return application
