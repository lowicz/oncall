# Systemd (Podman Compose)

For the stack to come up on its own after a machine reboot and after an unattended update, run it as a **user** unit, not a system one.
The unit is of type `oneshot` with `RemainAfterExit=yes` and calls the script `deploy/systemd/oncall-stack.sh`, not a pasted-in `podman compose` command.
The script is the only entry point to the stack: the Compose files remain the definition of the services.

The default, production path starts all three files:

```bash
podman compose -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.ldap-ca.yml up -d
```

This is not Quadlet and it does not change the behaviour of the images, TLS or LDAP.
Compose reads `.env` from the deployment directory; the unit, the scripts and this page do not load that file.
The containers have `restart: unless-stopped` in Compose, so their failures stay with Podman.
The unit's job is to create the stack when the user's systemd starts.

## Requirements

A checkout of the release with the Compose files and a filled-in `.env` - see [Running the stack](uruchomienie.md).
Podman with `podman compose` and the user socket (`podman.socket`).
The default path also requires the TLS and directory CA overlays - see [TLS](tls.md) and [LDAP](ldap.md).

## Installation

As the user who is to run the stack (not root):

```bash
./deploy/systemd/install-user-unit.sh /path/to/checkout
```

The argument is the deployment directory (the Compose files and `.env`), not a guessed home directory.
The script is idempotent.
In order, it:

1. copies `deploy/systemd/oncall.service` to `~/.config/systemd/user/`
2. records the checkout directory as `WorkingDirectory` in the drop-in `oncall.service.d/checkout.conf` (not in the unit itself)
3. enables linger (`loginctl enable-linger`), so that the user's systemd session comes up without an interactive login
4. enables and starts `podman.socket` and `oncall.service`

## Without an overlay

A host that needs neither TLS nor the directory CA skips that file **without editing the unit**.
Pass the Compose file names to the setup script:

```bash
./deploy/systemd/install-user-unit.sh /path/to/checkout docker-compose.yml
./deploy/systemd/install-user-unit.sh /path/to/checkout docker-compose.yml docker-compose.tls.yml
```

The setup writes them into the drop-in as `ONCALL_COMPOSE_FILES` (names separated by colons).
The stack script reads this variable from the systemd environment, not from `.env`.

## Manually

The same sequence without the setup script, from the checkout directory:

```bash
install -D -m 644 deploy/systemd/oncall.service ~/.config/systemd/user/oncall.service
mkdir -p ~/.config/systemd/user/oncall.service.d
cat > ~/.config/systemd/user/oncall.service.d/checkout.conf <<EOF
[Service]
WorkingDirectory=/path/to/checkout
EOF
loginctl enable-linger
systemctl --user daemon-reload
systemctl --user enable --now podman.socket
systemctl --user enable --now oncall.service
```

`WorkingDirectory` must be an absolute path.
To skip an overlay, add for example `Environment=ONCALL_COMPOSE_FILES=docker-compose.yml` to the same drop-in.
Do not put an `EnvironmentFile=` pointing at `.env` into the unit or the drop-in.

## Control

```bash
systemctl --user status oncall
systemctl --user restart oncall
systemctl --user stop oncall
```

After the start the unit stays `active (exited)`: the `up` command succeeded; the containers are Podman's business.
`restart` does a `down` and then an `up` again.
`stop` calls `oncall-stack.sh down` **without** `-v`, so the volumes (including the database) stay.

## After a reboot

Linger makes the user's systemd start together with the machine, without a login.
The enabled unit then runs the `up` script from the checkout directory.
The Podman socket must be enabled - the setup script does `systemctl --user enable --now podman.socket`.
The manual `systemctl --user start podman.socket` is also described in [Running the stack](uruchomienie.md#podman).

## Updating the release

With one command, together with filling in `.env` and restarting the unit - see [Updating a deployment](aktualizacja.md):

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

Manually, as in [Releases and versions](wydania.md): check out the tag, set the new `ONCALL_VERSION` in `.env`, then:

```bash
systemctl --user restart oncall
```

If the unit has changed, copy it to `~/.config/systemd/user/` and run `systemctl --user daemon-reload` before the restart.
Run the setup script again with the same Compose file names as at installation: without them it writes the drop-in afresh, without `ONCALL_COMPOSE_FILES`.
