#!/usr/bin/env python3
"""Clean Room audit verifier: an independent check of an exported audit chain.

Re-implements the rules in spacetimedb/src/audit/chain.ts with nothing but the
Python standard library, so a reviewer can verify the log without trusting the
dashboard, the database, or our TypeScript.

Usage:
  python3 tools/verify_audit.py export.json
  python3 tools/verify_audit.py export.json --anchor 12:9f3c...    # witness-saved hash
  python3 tools/verify_audit.py export.json --json                 # machine-readable

Exit code: 0 = intact, 1 = tampering detected, 2 = unreadable input.
"""
import argparse, hashlib, json, sys

FORMAT = "CRAUDIT-v1"
SKEW_WARN_MICROS = 120_000_000
WARNING_ONLY = {"CLOCK_SKEW"}

EXPLAIN = {
    "WRONG_INCIDENT": ("Event belongs to a different incident's chain.", "Integrity: splicing"),
    "SEQ_GAP": ("A sequence number is missing.", "Evidence deletion"),
    "SEQ_DUPLICATE": ("Two events claim the same number.", "Evidence insertion"),
    "LINK_BROKEN": ("prev_hash doesn't match the event before it.", "Chain of custody broken"),
    "HASH_MISMATCH": ("Contents changed after the event was written.", "Integrity violation"),
    "TIME_REVERSED": ("Server time goes backwards.", "Reordering or forgery"),
    "HEAD_MISMATCH": ("The log doesn't end where the chain head says.", "Tail truncation"),
    "ANCHOR_MISMATCH": ("A hash a witness saved earlier is gone or different.", "Whole-chain rewrite"),
    "CLOCK_SKEW": ("Client clock far from server clock (warning).", "Timestamp analysis lead"),
}


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical(e: dict) -> str:
    fields = [FORMAT, e["incident_id"], e["seq"], e["actor"], e["actor_kind"], e["server_ts_micros"],
              e["client_ts_micros"], e["action"], e["entity_type"], e["entity_id"], e["metadata"],
              e["client_sig"], e["prev_hash"]]
    # Same bytes as JavaScript's JSON.stringify on an array of strings.
    return json.dumps([str(f) for f in fields], separators=(",", ":"), ensure_ascii=False)


def genesis(incident_id: str) -> str:
    return sha256_hex(f"{FORMAT}|genesis|{incident_id}")


def verify(doc: dict, anchors=()) -> dict:
    if doc.get("format") != FORMAT:
        raise ValueError(f"unsupported format {doc.get('format')!r}")
    inc = str(doc["incident_id"])
    events = sorted(doc["events"], key=lambda e: int(e["seq"]))
    findings = []
    add = lambda code, seq, detail: findings.append({"code": code, "seq": seq, "detail": detail})

    prev_hash, expect, prev_ts = genesis(inc), 1, None
    for e in events:
        seq = int(e["seq"])
        if str(e["incident_id"]) != inc:
            add("WRONG_INCIDENT", seq, f"belongs to incident {e['incident_id']}")
        if seq < expect:
            add("SEQ_DUPLICATE", seq, f"seq {seq} appears more than once")
        elif seq > expect:
            add("SEQ_GAP", seq, f"seq {expect}..{seq - 1} missing")
        if e["prev_hash"] != prev_hash:
            add("LINK_BROKEN", seq, "prev_hash does not match the previous event")
        if sha256_hex(canonical(e)) != e["hash"]:
            add("HASH_MISMATCH", seq, "stored hash does not match contents")
        ts = int(e["server_ts_micros"])
        if prev_ts is not None and ts < prev_ts:
            add("TIME_REVERSED", seq, "server time earlier than previous event")
        client = int(e["client_ts_micros"])
        if client != 0 and abs(client - ts) > SKEW_WARN_MICROS:
            add("CLOCK_SKEW", seq, f"client clock off by {int((client - ts) / 1_000_000)} s")
        prev_hash, expect, prev_ts = e["hash"], seq + 1, ts

    last = events[-1] if events else None
    head = doc.get("head")
    if head:
        if not last or int(last["seq"]) != int(head["seq"]) or last["hash"] != head["hash"]:
            add("HEAD_MISMATCH", int(head["seq"]), f"head says seq {head['seq']}; log ends at {last['seq'] if last else 'nothing'}")
    for a_seq, a_hash in anchors:
        match = next((e for e in events if int(e["seq"]) == a_seq), None)
        if not match or match["hash"] != a_hash:
            add("ANCHOR_MISMATCH", a_seq, "witness-saved hash no longer matches")

    hard = [f for f in findings if f["code"] not in WARNING_ONLY]
    seqs = [f["seq"] for f in hard if f["seq"] is not None]
    return {"ok": not hard, "checked": len(events), "first_break_seq": min(seqs) if seqs else None,
            "findings": findings, "head_hash": last["hash"] if last else None}


def parse_anchor(s: str):
    seq, _, h = s.partition(":")
    if not seq.isdigit() or len(h) != 64:
        raise argparse.ArgumentTypeError("anchor must look like SEQ:64-hex-hash")
    return int(seq), h.lower()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("export", help="JSON produced by exportChain()")
    ap.add_argument("--anchor", action="append", type=parse_anchor, default=[], help="SEQ:HASH saved by a witness (repeatable)")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    a = ap.parse_args(argv)
    try:
        with open(a.export, encoding="utf-8") as f:
            res = verify(json.load(f), a.anchor)
    except (OSError, ValueError, KeyError) as exc:
        print(f"ERROR: cannot read export: {exc}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        status = "INTACT" if res["ok"] else f"TAMPERING DETECTED (first break at seq {res['first_break_seq']})"
        print(f"Clean Room audit chain: {status}")
        print(f"  events checked: {res['checked']}   head: {(res['head_hash'] or '-')[:16]}")
        for f in res["findings"]:
            what, concept = EXPLAIN[f["code"]]
            print(f"  [{f['code']}] seq {f['seq']}: {what} {f['detail']}. -> {concept}")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
