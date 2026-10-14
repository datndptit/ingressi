"""Read-only check: union(source VM 1, source VM 2) == both replicas.

Usage: python3 verify-fingerprints.py old1.tsv old2.tsv new1.tsv new2.tsv
Checks counts and two order-independent, non-cryptographic fingerprints.
It does not prove collision-free equality or detect duplicated source events.
"""
import sys
from pathlib import Path

TABLES = {"traffic_events", "waf_events"}
MASK = (1 << 64) - 1


def read(path):
    rows = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        name, count, total, xor = line.split("\t")
        if name in rows:
            raise ValueError(f"Duplicate table in {path}: {name}")
        rows[name] = tuple(map(int, (count, total, xor)))
    if set(rows) != TABLES:
        raise ValueError(f"Expected {sorted(TABLES)} in {path}")
    return rows


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    old1, old2, new1, new2 = map(read, sys.argv[1:])
    good = True
    for name in sorted(TABLES):
        a, b = old1[name], old2[name]
        expected = (a[0] + b[0], (a[1] + b[1]) & MASK, a[2] ^ b[2])
        passed = new1[name] == expected and new2[name] == expected
        good &= passed
        print(f"{'PASS' if passed else 'FAIL'} {name}: expected={expected}; replica1={new1[name]}; replica2={new2[name]}")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
