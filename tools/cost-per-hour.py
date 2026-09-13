#!/usr/bin/env python3
"""Recompute $/active-agent-hour from headlong usage ledgers.

The doc's "$1-2/hour" claim rotted because it was measured once and written
down. This script exists so the replacement number never has to.

Usage:
  python3 tools/cost-per-hour.py                 # human summary
  python3 tools/cost-per-hour.py --json          # machine readable
  python3 tools/cost-per-hour.py --sonnet-only   # pure-sonnet hours only
  python3 tools/cost-per-hour.py --root DIR      # extra ledger root (repeatable)
"""
import argparse, glob, json, os, sys
from collections import defaultdict

# Anthropic list prices, $ per 1M tokens.
# cache write = 1.25x base input, cache read = 0.10x base input.
PRICES = {
    "opus":   {"in": 15.0, "out": 75.0},
    "sonnet": {"in":  3.0, "out": 15.0},
    "haiku":  {"in":  0.80, "out": 4.0},
}
DEFAULT_ROOTS = [
    "/Users/tomaitagaki/implicit-labs/linglong/headlong/.identities",
    "/Users/tomaitagaki/headlong-workspace/headlong-harden/.identities",
]

def family(model):
    m = (model or "").lower()
    for f in ("opus", "sonnet", "haiku"):
        if f in m:
            return f
    return None

def cost_of(rec):
    f = family(rec.get("model"))
    if f is None:
        return None, None
    p = PRICES[f]
    c = (rec.get("in_tok", 0) or 0) * p["in"] / 1e6
    c += (rec.get("out_tok", 0) or 0) * p["out"] / 1e6
    c += (rec.get("cache_write_tok", 0) or 0) * p["in"] * 1.25 / 1e6
    c += (rec.get("cache_read_tok", 0) or 0) * p["in"] * 0.10 / 1e6
    return c, f

def pct(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    i = (len(sorted_vals) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", action="append", default=[])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--key", choices=("identity","dir"), default="identity",
                    help="attribute a call by its identity field (default) or by ledger directory (reproduces 2026-09-11 baseline)")
    ap.add_argument("--sonnet-only", action="store_true")
    args = ap.parse_args()

    roots = args.root + DEFAULT_ROOTS
    ledgers = []
    for r in roots:
        ledgers += sorted(glob.glob(os.path.join(r, "*", "usage", "llm.jsonl")))
    ledgers = sorted(set(ledgers))

    hour_cost = defaultdict(float)          # (identity, hour) -> $
    hour_fams = defaultdict(set)            # (identity, hour) -> {families}
    agent = defaultdict(lambda: {"cost": 0.0, "calls": 0, "sonnet": 0, "opus": 0})
    cache = {"in": 0, "read": 0, "write": 0}
    calls = skipped = 0

    for path in ledgers:
        ident = path.split("/.identities/")[-1].split("/")[0]
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    skipped += 1
                    continue
                c, fam = cost_of(rec)
                if c is None:
                    skipped += 1
                    continue
                ts = rec.get("ts", "")
                if len(ts) < 13:
                    skipped += 1
                    continue
                calls += 1
                who = ident if args.key == "dir" else (rec.get("identity") or ident)
                key = (who, ts[:13])
                hour_cost[key] += c
                hour_fams[key].add(fam)
                a = agent[who]
                a["cost"] += c
                a["calls"] += 1
                if fam == "sonnet": a["sonnet"] += 1
                if fam == "opus":   a["opus"] += 1
                cache["in"]    += rec.get("in_tok", 0) or 0
                cache["read"]  += rec.get("cache_read_tok", 0) or 0
                cache["write"] += rec.get("cache_write_tok", 0) or 0

    keys = list(hour_cost)
    if args.sonnet_only:
        keys = [k for k in keys if hour_fams[k] == {"sonnet"}]
    vals = sorted(hour_cost[k] for k in keys)
    n = len(vals)
    in_band = sum(1 for v in vals if 1.0 <= v <= 2.0)
    above   = sum(1 for v in vals if v > 2.0)
    tot = cache["in"] + cache["read"] + cache["write"]

    out = {
        "ledgers": len(ledgers), "calls": calls, "skipped": skipped,
        "active_agent_hours": n,
        "median": round(pct(vals, .50), 2), "mean": round(sum(vals)/n, 2) if n else 0,
        "p25": round(pct(vals, .25), 2), "p75": round(pct(vals, .75), 2),
        "p90": round(pct(vals, .90), 2), "max": round(vals[-1], 2) if vals else 0,
        "in_1_2_band": in_band, "above_2": above,
        "pct_in_band": round(100*in_band/n, 1) if n else 0,
        "pct_above_2": round(100*above/n, 1) if n else 0,
        "cache_write_read_ratio": round(cache["write"]/cache["read"], 2) if cache["read"] else None,
        "cache_pct_write": round(100*cache["write"]/tot, 1) if tot else 0,
        "cache_pct_read": round(100*cache["read"]/tot, 1) if tot else 0,
        "fleet_total_cost": round(sum(a["cost"] for a in agent.values()), 2),
        "agents": len(agent),
    }
    if args.json:
        print(json.dumps(out, indent=2)); return

    label = "PURE-SONNET" if args.sonnet_only else "ALL"
    print(f"{label} agent-hours: {n}   (from {len(ledgers)} ledgers, {calls} calls, {skipped} skipped)")
    print(f"  median = ${out['median']:,.2f}")
    print(f"  mean   = ${out['mean']:,.2f}")
    for k in ("p25","p75","p90","max"):
        print(f"  {k:6s} = ${out[k]:,.2f}")
    print(f"  inside the doc's $1-2/hr band: {in_band}/{n} = {out['pct_in_band']}%")
    print(f"  above $2/hr:                   {above}/{n} = {out['pct_above_2']}%")
    print(f"\nCACHE across {calls} calls: write {out['cache_pct_write']}%  read {out['cache_pct_read']}%"
          f"  write:read = {out['cache_write_read_ratio']}")
    print(f"\nFLEET TOTAL across {out['agents']} agents: ${out['fleet_total_cost']:,.2f}")
    print("\nper-agent totals (top by cost):")
    for who, a in sorted(agent.items(), key=lambda kv: -kv[1]["cost"])[:10]:
        print(f"  {who:22s} ${a['cost']:9,.2f}  calls={a['calls']:6d} sonnet={a['sonnet']:5d} opus={a['opus']:5d}")

main()
