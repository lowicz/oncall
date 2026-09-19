"""Shared API client for the QA suite."""
import httpx

BASE = "http://localhost:8080"
PASSWORD = "TestOncall2026!"
ADMIN_PASSWORD = "Qwertyuiop1!"


class Api:
    def __init__(self, username=None, password=None):
        self.c = httpx.Client(base_url=BASE, timeout=120.0, follow_redirects=False)
        self.csrf = None
        self.username = username
        if username:
            self.login(username, password or PASSWORD)

    def login(self, username, password):
        r = self.c.post("/api/v1/auth/login", json={"username": username, "password": password})
        if r.status_code == 200:
            self.csrf = r.headers.get("X-CSRF-Token")
        return r

    def req(self, method, path, **kw):
        headers = kw.pop("headers", {}) or {}
        if method != "GET" and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        return self.c.request(method, path, headers=headers, **kw)

    def get(self, p, **kw):
        return self.req("GET", p, **kw)

    def post(self, p, **kw):
        return self.req("POST", p, **kw)

    def patch(self, p, **kw):
        return self.req("PATCH", p, **kw)

    def put(self, p, **kw):
        return self.req("PUT", p, **kw)

    def delete(self, p, **kw):
        return self.req("DELETE", p, **kw)

    def close(self):
        self.c.close()


FINDINGS = []


def check(cid, ok, title, detail=""):
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {cid}: {title}" + (f"  -- {detail}" if detail and not ok else ""))
    if not ok:
        FINDINGS.append((cid, title, detail))
    return ok
