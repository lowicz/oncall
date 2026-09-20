#!/usr/bin/env python3
"""One Markdown line for the job summary from a JUnit XML report.

    junit-summary.py "<label>" <report.xml>

pytest (--junitxml) and vitest (--reporter=junit) both write the format read
here. A missing report, which happens when the tests never ran, is reported
as such rather than as zero tests.
"""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def main() -> int:
    label, report = sys.argv[1], Path(sys.argv[2])
    if not report.exists():
        print(f"- **{label}**: no report (the tests did not run)")
        return 0
    root = ET.parse(report).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    total = sum(int(suite.get("tests", 0)) for suite in suites)
    failures = sum(int(suite.get("failures", 0)) for suite in suites)
    errors = sum(int(suite.get("errors", 0)) for suite in suites)
    skipped = sum(int(suite.get("skipped", 0)) for suite in suites)
    seconds = sum(float(suite.get("time", 0)) for suite in suites)
    verdict = "passed" if failures == 0 and errors == 0 else "FAILED"
    print(
        f"- **{label}**: {verdict} - {total} tests, {failures} failures, "
        f"{errors} errors, {skipped} skipped, {seconds:.0f} s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
