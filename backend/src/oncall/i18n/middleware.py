"""The ASGI middleware that reads `Accept-Language` into the request's language."""

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from oncall.i18n import negotiate, reset_request_language, set_request_language


class RequestLanguageMiddleware:
    """Serve each HTTP request in the language its `Accept-Language` prefers.

    The negotiated language is kept in a context variable for the whole
    request, so every sentence built while serving it (a refused rule, a
    validation message, a holiday's name) comes out in that language without
    the language being passed along. The response says which language it is in
    with `Content-Language`.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        language = negotiate(Headers(scope=scope).get("accept-language"))

        async def send_with_language(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).setdefault("content-language", language)
            await send(message)

        token = set_request_language(language)
        try:
            await self.app(scope, receive, send_with_language)
        finally:
            reset_request_language(token)
