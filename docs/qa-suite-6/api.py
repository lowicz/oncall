"""Thin API client for the QA6 run: session cookie + CSRF, like the SPA."""
import httpx

BASE = "http://localhost:8080"
PASSWORD = "QA6-Testowe-Haslo!"


class Api:
    def __init__(self, username, password=PASSWORD, base=BASE, timeout=120.0):
        self.c = httpx.Client(base_url=base, timeout=timeout, follow_redirects=False)
        r = self.c.post("/api/v1/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        self.me = r.json()
        self.csrf = self.c.get("/api/v1/auth/csrf").json()["csrf_token"]

    def _h(self, extra=None):
        h = {"X-CSRF-Token": self.csrf}
        if extra:
            h.update(extra)
        return h

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, **kw):
        kw.setdefault("headers", {}).update(self._h())
        return self.c.post(path, **kw)

    def patch(self, path, **kw):
        kw.setdefault("headers", {}).update(self._h())
        return self.c.patch(path, **kw)

    def put(self, path, **kw):
        kw.setdefault("headers", {}).update(self._h())
        return self.c.put(path, **kw)

    def delete(self, path, **kw):
        kw.setdefault("headers", {}).update(self._h())
        return self.c.delete(path, **kw)
