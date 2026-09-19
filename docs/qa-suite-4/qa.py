"""Shared HTTP client for the QA round 4 scripts."""
import httpx

BASE = "http://localhost:8080"
PASSWORD = "OncallQA-2026!"
ADMIN_PASSWORD = "Qwertyuiop1!"


class Client:
    def __init__(self, username: str, password: str | None = None, base: str = BASE) -> None:
        self.username = username
        self.http = httpx.Client(base_url=base, timeout=120.0, follow_redirects=True)
        secret = password or (ADMIN_PASSWORD if username == "admin" else PASSWORD)
        response = self.http.post("/api/v1/auth/login", json={"username": username, "password": secret})
        response.raise_for_status()
        self.csrf = self.http.get("/api/v1/auth/csrf").json()["csrf_token"]

    def headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.csrf}

    def get(self, path, **kwargs):
        return self.http.get(path, **kwargs)

    def post(self, path, **kwargs):
        kwargs.setdefault("headers", {}).update(self.headers())
        return self.http.post(path, **kwargs)

    def patch(self, path, **kwargs):
        kwargs.setdefault("headers", {}).update(self.headers())
        return self.http.patch(path, **kwargs)

    def put(self, path, **kwargs):
        kwargs.setdefault("headers", {}).update(self.headers())
        return self.http.put(path, **kwargs)

    def delete(self, path, **kwargs):
        kwargs.setdefault("headers", {}).update(self.headers())
        return self.http.delete(path, **kwargs)
