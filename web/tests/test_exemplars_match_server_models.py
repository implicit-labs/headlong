"""Every shipped exemplar must round-trip through the real producer and then
satisfy the server's own models.  Producer/server drift has bitten twice
(anchor_node, review_surface.format); this runs the two sides against each
other in the one CI job that has both.  Lives here rather than in the bash
suite because that job has no Python environment."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from headlong_web.review import RunManifest, parse_brief

REPO = Path(__file__).resolve().parents[2]
PRODUCER = REPO / "tools" / "headlong-review-run"
EXEMPLARS = sorted((REPO / "workspace-template" / "exemplars").glob("*.brief.json"))
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63f8ffff3f0005fe02fea79aa0a00000000049454e44ae426082"
)


def run(*args: str) -> str:
    proc = subprocess.run([sys.executable, str(PRODUCER), *args], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return proc.stdout.strip()


@pytest.mark.parametrize("exemplar", EXEMPLARS, ids=[p.name for p in EXEMPLARS])
def test_exemplar_survives_producer_and_server(tmp_path: Path, exemplar: Path):
    ws = tmp_path / "ws"
    (ws / "analysis" / "figures").mkdir(parents=True)
    shutil.copy(exemplar, ws / "analysis" / "brief.json")
    shutil.copy(exemplar.with_name(exemplar.name.replace(".brief.json", ".provenance.json")), ws / "analysis" / "provenance.json")
    (ws / "analysis" / "figures" / "dropoff.png").write_bytes(PNG_1X1)

    run_id = run("begin", "--workspace", str(ws), "--identity", "reviewer", "--run-id", "ex", "--title", "E",
                 "--goal-ref", "goals/test.md", "--started-at", "2026-09-05T00:00:00+00:00", "--deadline", "2026-09-05T01:00:00+00:00")
    run("validate-brief", "--workspace", str(ws), "--brief", "analysis/brief.json", "--provenance", "analysis/provenance.json")
    run("ready", "--workspace", str(ws), "--run-id", run_id, "--artifact", "analysis/brief.json", "--artifact-title", "E",
        "--progress-summary", "S", "--provenance", "analysis/provenance.json", "--status", "waiting_on_toma")

    manifest = json.loads((ws / "artifacts" / "runs" / run_id / "manifest.json").read_text())
    parsed = RunManifest.model_validate(manifest)          # the reader's strict model accepts what the producer wrote
    assert parsed.primary_artifact is not None
    assert parsed.primary_artifact.media_type == "application/vnd.headlong.brief+json"
    assert parsed.brief is not None and parsed.brief.question.endswith("?")
    assert parsed.review_surface is not None and parsed.review_surface.format == "brief"
    assert parsed.decision_requests and all(r.headline and r.summary for r in parsed.decision_requests)
    brief = parse_brief((ws / parsed.primary_artifact.path).read_text())
    assert brief.blocks
    for block in brief.blocks:                              # snapshotted figures live inside the run directory
        if getattr(block, "type", None) == "figure":
            assert block.path.startswith(f"artifacts/runs/{run_id}/artifacts/figure-")
