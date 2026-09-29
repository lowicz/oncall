"""An SMTP server on the loopback for the tests of the e-mail path.

It speaks just enough of RFC 5321 for aiosmtplib to hand over a message and
records what the client said, so a test sees the conversation a real server
would: the EHLO name, whether the client logged in, the envelope and the
message. It serves from a thread of its own, so a test that runs an event
loop of its own (`asyncio.run` in `oncall.backup_alert`) reaches it as well
as an async test does.
"""

import base64
import socketserver
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class Relay:
    #: Offer AUTH PLAIN, accept only this pair and refuse mail until the client
    #: logged in with it. None is a relay that offers no AUTH at all.
    credentials: tuple[str, str] | None = None
    #: The EHLO name the relay lets send, refusing every recipient of any other
    #: client - how a relay that trusts the application's identity decides.
    #: None lets every client send.
    trusted_client: str | None = None
    port: int = 0
    #: Every command line the client sent, in order.
    commands: list[str] = field(default_factory=list)
    #: The DATA of every message accepted, as the client sent it.
    messages: list[bytes] = field(default_factory=list)

    @property
    def verbs(self) -> list[str]:
        return [command.split(" ", 1)[0].upper() for command in self.commands]


class _Session(socketserver.StreamRequestHandler):
    server: _Server

    def reply(self, code: int, *lines: str) -> None:
        last = len(lines) - 1
        self.wfile.write(
            "".join(
                f"{code}{' ' if n == last else '-'}{line}\r\n" for n, line in enumerate(lines)
            ).encode()
        )

    def handle(self) -> None:
        relay = self.server.relay
        client: str | None = None
        logged_in = False
        self.reply(220, "relay.test ESMTP")
        while line := self.rfile.readline():
            command = line.decode().rstrip("\r\n")
            relay.commands.append(command)
            verb, _, argument = command.partition(" ")
            match verb.upper():
                case "EHLO":
                    client = argument
                    offers = ["AUTH PLAIN"] if relay.credentials else []
                    self.reply(250, "relay.test", "8BITMIME", *offers, "SIZE 10240000")
                case "AUTH":
                    logged_in = self.authenticate(argument)
                case "MAIL" if relay.credentials and not logged_in:
                    self.reply(530, "5.7.0 Authentication required")
                case "RCPT" if relay.trusted_client not in (None, client):
                    self.reply(550, f"5.7.1 Relaying denied for {client}")
                case "MAIL" | "RCPT" | "RSET" | "NOOP":
                    self.reply(250, "2.0.0 OK")
                case "DATA":
                    self.reply(354, "End data with <CR><LF>.<CR><LF>")
                    relay.messages.append(self.read_data())
                    self.reply(250, "2.0.0 Queued")
                case "QUIT":
                    self.reply(221, "2.0.0 Bye")
                    return
                case _:
                    self.reply(502, "5.5.2 Command not recognized")

    def authenticate(self, argument: str) -> bool:
        mechanism, _, response = argument.partition(" ")
        try:
            _, username, password = base64.b64decode(response).decode().split("\0")
        except ValueError:
            username = password = ""
        if mechanism.upper() == "PLAIN" and (username, password) == self.server.relay.credentials:
            self.reply(235, "2.7.0 Authentication successful")
            return True
        self.reply(535, "5.7.8 Authentication credentials invalid")
        return False

    def read_data(self) -> bytes:
        data = b""
        while (line := self.rfile.readline()) not in (b".\r\n", b""):
            data += line
        return data


class _Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, relay: Relay) -> None:
        super().__init__(("127.0.0.1", 0), _Session)
        self.relay = relay


@contextmanager
def serving(relay: Relay) -> Iterator[Relay]:
    """Serve `relay` on a free loopback port, recorded in `relay.port`."""
    with _Server(relay) as server:
        relay.port = server.server_address[1]
        # A short poll, or `shutdown` waits half a second for the loop to look.
        thread = threading.Thread(target=server.serve_forever, args=(0.01,), daemon=True)
        thread.start()
        try:
            yield relay
        finally:
            server.shutdown()
            thread.join()
