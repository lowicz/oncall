"""Create or verify the versioned OpenAPI contract snapshot."""

import argparse
import json
from pathlib import Path

from oncall.main import app

SNAPSHOT = Path(__file__).resolve().parents[1] / "contracts" / "openapi.json"


def serialized_schema() -> str:
    """Return the canonical, deterministic representation stored in Git."""
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--update",
        action="store_true",
        help="replace the snapshot after an explicitly approved API contract change",
    )
    args = parser.parse_args()
    current = serialized_schema()
    if args.update:
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(current)
        print(f"updated {SNAPSHOT}")
        return 0
    if not SNAPSHOT.exists():
        print(f"missing {SNAPSHOT}; run this command with --update")
        return 1
    if SNAPSHOT.read_text() != current:
        print(
            "OpenAPI contract differs from contracts/openapi.json. "
            "Inspect the diff; update only after the contract change is explicitly approved."
        )
        return 1
    print("OpenAPI contract matches the snapshot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
