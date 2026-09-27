from fastapi.middleware.cors import CORSMiddleware

from oncall.bootstrap import http
from oncall.config import Settings
from oncall.i18n.middleware import RequestLanguageMiddleware
from oncall.main import create_app


def test_app_factory_uses_explicit_settings() -> None:
    app = create_app(
        Settings(
            app_name="Contract App",
            cors_origins=["https://calendar.example"],
        )
    )

    assert app.title == "Contract App"
    cors = next(
        middleware
        for middleware in app.user_middleware
        if middleware.cls.__name__ == "CORSMiddleware"
    )
    assert cors.kwargs["allow_origins"] == ["https://calendar.example"]
    assert [middleware.cls for middleware in app.user_middleware[:2]] == [
        CORSMiddleware,
        RequestLanguageMiddleware,
    ]


async def test_starting_the_app_configures_logging_through_the_language_middleware(
    monkeypatch,
) -> None:
    """The lifespan events pass through `RequestLanguageMiddleware` untouched
    (it serves only HTTP), and startup is where the process's logging is set."""
    configured: list[str] = []
    monkeypatch.setattr(http, "configure_logging", lambda: configured.append("logging"))
    app = create_app(Settings())
    incoming = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
    sent: list[str] = []

    async def receive() -> dict:
        return next(incoming)

    async def send(message) -> None:
        sent.append(message["type"])

    await app({"type": "lifespan", "asgi": {"version": "3.0"}, "state": {}}, receive, send)

    assert configured == ["logging"]
    assert sent == ["lifespan.startup.complete", "lifespan.shutdown.complete"]
