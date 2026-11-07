#!/usr/bin/env python3
"""Attack simulator for demos and tests: tampers with an exported audit chain
the way an attacker with database access could. Run the verifier afterwards.

  python3 tools/tamper_audit.py export.json edit     --seq 5 -o tampered.json
  python3 tools/tamper_audit.py export.json edit-rehash --seq 5 -o tampered.json
  python3 tools/tamper_audit.py export.json delete   --seq 5 -o tampered.json
  python3 tools/tamper_audit.py export.json truncate --seq 5 -o tampered.json   # drop seq>=5, fix head
  python3 tools/tamper_audit.py export.json reorder  --seq 5 -o tampered.json
  python3 tools/tamper_audit.py export.json rewrite  --seq 5 -o tampered.json   # edit + re-hash everything after
  python3 tools/tamper_audit.py export.json splice   --seq 5 --other other.json -o tampered.json

SYNTHETIC DEMO TOOL. It only edits a JSON file; it never touches a database.
"""
import argparse, copy, json, sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from verify_audit import canonical, sha256_hex  # noqa: E402

def rehash(e):
    e["hash"] = sha256_hex(canonical(e))

def find(events, seq):
    for i, e in enumerate(events):
        if int(e["seq"]) == seq:
            return i
    raise SystemExit(f"no event with seq {seq}")

def edit_meta(e):
    meta = json.loads(e["metadata"] or "{}")
    meta["tampered"] = True
    e["metadata"] = json.dumps(meta, separators=(",", ":"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export"); ap.add_argument("attack", choices=["edit", "edit-rehash", "delete", "truncate", "reorder", "rewrite", "splice"])
    ap.add_argument("--seq", type=int, required=True); ap.add_argument("--other"); ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    doc = json.load(open(a.export, encoding="utf-8")); ev = doc["events"]; i = find(ev, a.seq)

    if a.attack == "edit":                       # change contents, leave hash
        edit_meta(ev[i])
    elif a.attack == "edit-rehash":              # change contents, fix this hash only
        edit_meta(ev[i]); rehash(ev[i])
    elif a.attack == "delete":                   # remove one event
        ev.pop(i)
    elif a.attack == "truncate":                 # cut the tail AND fix the head table to match
        del ev[i:]
        doc["head"] = {"seq": ev[-1]["seq"], "hash": ev[-1]["hash"]} if ev else None
    elif a.attack == "reorder":                  # swap two events' timestamps
        j = i + 1 if i + 1 < len(ev) else i - 1
        ev[i]["server_ts_micros"], ev[j]["server_ts_micros"] = ev[j]["server_ts_micros"], ev[i]["server_ts_micros"]
    elif a.attack == "rewrite":                  # best-case attacker: edit, then re-hash and re-link everything after
        edit_meta(ev[i])
        for k in range(i, len(ev)):
            if k: ev[k]["prev_hash"] = ev[k - 1]["hash"]
            rehash(ev[k])
        doc["head"] = {"seq": ev[-1]["seq"], "hash": ev[-1]["hash"]}
    elif a.attack == "splice":                   # paste a valid event from another incident
        other = json.load(open(a.other, encoding="utf-8"))["events"]
        ev[i] = copy.deepcopy(other[find(other, a.seq)])

    json.dump(doc, open(a.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"{a.attack} applied at seq {a.seq} -> {a.out}")

if __name__ == "__main__":
    main()
