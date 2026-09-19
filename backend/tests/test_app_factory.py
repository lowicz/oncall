from oncall.config import Settings
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
