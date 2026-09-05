"""Contract and containment tests for IMP-632 Daily Review."""

from __future__ import annotations

import hashlib
import json
import multiprocessing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from headlong_web.server import create_app


IDENTITY_ID = ".identities~reviewer"


def _decision_process(identity_path: str, body: dict, start, result_queue) -> None:
    """Spawn-safe worker used to exercise the advisory file lock."""
    from headlong_web import discovery, review

    identity = discovery.IdentityInfo(
        id=IDENTITY_ID,
        name="reviewer",
        path=Path(identity_path),
        path_rel=".identities/reviewer",
        created="2026-09-04T12:00:00Z",
        root_trajectory="none",
        group=".identities",
    )
    start.wait()
    try:
        record = review.append_decision(
            identity, "process-run", review.DecisionInput.model_validate(body)
        )
        result_queue.put({"ok": True, "record": record})
    except Exception as exc:  # pragma: no cover - diagnostic crosses process boundary
        result_queue.put({"ok": False, "error": repr(exc)})


def _jsonl(path: Path, records: list[dict]) -> None:
    path.write_text("".join(json.dumps(record) + "\n" for record in records))


def _artifact_ref(project: Path, run_id: str, content: str) -> dict:
    path = project / "artifacts" / "runs" / run_id / "artifact.md"
    path.write_text(content)
    return {
        "path": path.relative_to(project).as_posix(),
        "title": f"Artifact {run_id}",
        "media_type": "text/markdown",
        "sha256": hashlib.sha256(content.encode()).hexdigest(),
    }


def _write_run(
    project: Path,
    run_id: str,
    status: str,
    *,
    started_at: str = "2026-09-04T12:00:00Z",
    with_request: bool = False,
    content: str | None = None,
) -> dict:
    directory = project / "artifacts" / "runs" / run_id
    directory.mkdir(parents=True)
    has_artifact = status in {"ready_for_review", "waiting_on_toma", "complete"}
    artifact = None
    if has_artifact:
        content = content or f"# {run_id}\n\nTraced claim [†](headlong://trace/claim-{run_id}).\n"
        artifact = _artifact_ref(project, run_id, content)

    decision_requests = []
    if with_request or status == "waiting_on_toma":
        decision_requests = [
            {
                "decision_request_id": f"request-{run_id}",
                "question": "Proceed with the bounded follow-up?",
                "authorized_scope": "Only inspect the named artifact.",
                "claim_id": f"claim-{run_id}" if artifact else None,
            }
        ]
    manifest = {
        "schema_version": 1,
        "run_id": run_id,
        "identity_id": "reviewer",
        "title": f"Run {run_id}",
        "goal_ref": "goals/review.md",
        "status": status,
        "started_at": started_at,
        "deadline": "2099-09-04T12:30:00Z",
        "progress_summary": "A compact persisted checkpoint.",
        "primary_artifact": artifact,
        "supporting_artifacts": [],
        "sentience_receipt_ref": f"artifacts/runs/{run_id}/sentience-receipts.jsonl",
        "provenance_ref": f"artifacts/runs/{run_id}/provenance.jsonl",
        "decision_ledger_ref": f"artifacts/runs/{run_id}/decisions.jsonl",
        "annotation_ledger_ref": f"artifacts/runs/{run_id}/annotations.jsonl",
        "decision_requests": decision_requests,
        "next_step_options": [],
    }
    if status == "failed":
        manifest["result"] = {"kind": "failure", "summary": "Provider unavailable."}

    provenance = []
    receipts = []
    if artifact:
        provenance = [
            {
                "claim_id": f"claim-{run_id}",
                "artifact_ref": artifact["path"],
                "artifact_sha256": artifact["sha256"],
                "claim_text": "A persisted claim.",
                "evidence_class": "observed",
                "sources": [
                    {
                        "kind": "local_file",
                        "ref": "/private/untrusted/secret.txt",
                        "label": "Persisted locator only",
                        "excerpt": "A safe persisted excerpt.",
                        "retrieved_at": "2026-09-04T12:00:00Z",
                    }
                ],
                "reason": "The persisted excerpt supports this bounded statement.",
                "rejected_alternatives": ["A broader unsupported conclusion."],
                "uncertainty": "No independent replication.",
            }
        ]
        receipts = [
            {
                "receipt_id": f"receipt-{run_id}",
                "question": "Check token=never-return-this-token before answering.",
                "response": (
                    "The credential is sk-proj-neverreturnthissecretvalue. "
                    "JWT eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZC1zZWNyZXQ.c2lnbmF0dXJl. "
                    "AWS AKIA1234567890ABCDEF.\n"
                    "-----BEGIN PRIVATE KEY-----\nprivate-material\n"
                    "-----END PRIVATE KEY-----"
                ),
                "thread_ref": "thread-redacted",
                "request_ref": "request-redacted",
                "timestamp": "2026-09-04T12:01:00Z",
                "affected_claim_id": f"claim-{run_id}",
                "affected_decision_request_id": None,
                "resulting_change": "Narrowed the claim.",
            }
        ]
    (directory / "manifest.json").write_text(json.dumps(manifest))
    _jsonl(directory / "provenance.jsonl", provenance)
    _jsonl(directory / "sentience-receipts.jsonl", receipts)
    _jsonl(directory / "decisions.jsonl", [])
    _jsonl(directory / "annotations.jsonl", [])
    return manifest


@pytest.fixture
def review_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setenv("HOME", str(tmp_path))
    root = tmp_path / "serve"
    identity = root / ".identities" / "reviewer"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        "name=reviewer\ncreated=2026-09-04T12:00:00Z\nroot_trajectory=none\n"
    )
    project = tmp_path / "review project"
    (project / "artifacts" / "runs").mkdir(parents=True)
    # Exercise both quote handling in envfile and explicit $HOME expansion.
    (identity / ".env").write_text("PROJECT_DIR='$HOME/review project'\n")
    return {"root": root, "identity": identity, "project": project}


@pytest.mark.parametrize(
    "status",
    ["running", "ready_for_review", "waiting_on_toma", "complete", "failed"],
)
def test_review_lists_all_five_states(review_env: dict, status: str):
    project = review_env["project"]
    _write_run(project, f"run-{status}", status)
    response = TestClient(create_app(review_env["root"])).get(
        f"/api/identities/{IDENTITY_ID}/review"
    )
    assert response.status_code == 200
    run = response.json()["runs"][0]
    assert run["status"] == status
    assert run["valid"] is True
    assert set(run) == {
        "run_id",
        "title",
        "goal_ref",
        "status",
        "started_at",
        "deadline",
        "time_remaining_s",
        "primary_artifact",
        "pending_decision_count",
        "valid",
        "validation_errors",
    }


def test_review_count_is_on_review_and_identity_payloads(review_env: dict):
    project = review_env["project"]
    for status in ("running", "ready_for_review", "waiting_on_toma", "complete", "failed"):
        _write_run(project, f"count-{status}", status)
    client = TestClient(create_app(review_env["root"]))
    assert client.get(f"/api/identities/{IDENTITY_ID}/review").json()["review_count"] == 2
    identity = client.get("/api/identities").json()[0]
    assert identity["review_count"] == 2


def test_detail_trace_no_evidence_and_receipt_redaction(review_env: dict):
    project = review_env["project"]
    _write_run(project, "trace-run", "ready_for_review")
    Path("/private/untrusted/secret.txt").write_text("must not be read") if False else None
    client = TestClient(create_app(review_env["root"]))
    base = f"/api/identities/{IDENTITY_ID}/review/runs/trace-run"

    detail = client.get(base)
    assert detail.status_code == 200
    payload = detail.json()
    encoded = json.dumps(payload)
    assert "never-return-this-token" not in encoded
    assert "neverreturnthissecretvalue" not in encoded
    assert "eyJhbGciOiJIUzI1NiJ9" not in encoded
    assert "AKIA1234567890ABCDEF" not in encoded
    assert "BEGIN PRIVATE KEY" not in encoded
    assert "private-material" not in encoded
    assert "<redacted>" in encoded
    assert payload["provenance"][0]["sources"][0]["ref"] == "/private/untrusted/secret.txt"
    assert payload["provenance"][0]["sources"][0]["excerpt"] == "A safe persisted excerpt."

    linked = client.get(f"{base}/traces/claim-trace-run").json()
    assert linked["linked"] is True
    assert linked["trace"]["evidence_class"] == "observed"
    missing = client.get(f"{base}/traces/unlinked-claim")
    assert missing.status_code == 200
    assert missing.json() == {
        "claim_id": "unlinked-claim",
        "linked": False,
        "message": "No evidence linked",
    }


def test_invalid_manifests_stay_visible_and_fail_closed(review_env: dict):
    project = review_env["project"]
    manifest = _write_run(project, "escape-run", "ready_for_review")
    manifest["primary_artifact"]["path"] = "../../outside.md"
    directory = project / "artifacts" / "runs" / "escape-run"
    (directory / "manifest.json").write_text(json.dumps(manifest))

    malformed = project / "artifacts" / "runs" / "malformed-run"
    malformed.mkdir()
    (malformed / "manifest.json").write_text('{"schema_version": 1')

    client = TestClient(create_app(review_env["root"]))
    summary = client.get(f"/api/identities/{IDENTITY_ID}/review").json()
    assert summary["review_count"] == 0
    assert {run["run_id"] for run in summary["runs"]} == {"escape-run", "malformed-run"}
    assert all(not run["valid"] and run["validation_errors"] for run in summary["runs"])
    assert client.get(
        f"/api/identities/{IDENTITY_ID}/review/runs/escape-run"
    ).status_code == 422


def test_symlink_escape_is_visible_but_never_read(review_env: dict, tmp_path: Path):
    project = review_env["project"]
    manifest = _write_run(project, "symlink-run", "ready_for_review")
    directory = project / "artifacts" / "runs" / "symlink-run"
    outside = tmp_path / "outside.md"
    outside.write_text("private")
    (directory / "escape.md").symlink_to(outside)
    manifest["primary_artifact"] = {
        "path": "artifacts/runs/symlink-run/escape.md",
        "title": "Unsafe",
        "media_type": "text/markdown",
        "sha256": hashlib.sha256(b"private").hexdigest(),
    }
    (directory / "manifest.json").write_text(json.dumps(manifest))
    response = TestClient(create_app(review_env["root"])).get(
        f"/api/identities/{IDENTITY_ID}/review"
    )
    assert response.status_code == 200
    assert response.json()["runs"][0]["valid"] is False


def test_jsonl_torn_tail_waits_for_reload_but_complete_malformed_line_fails(review_env: dict):
    project = review_env["project"]
    _write_run(project, "torn-run", "ready_for_review")
    directory = project / "artifacts" / "runs" / "torn-run"
    with (directory / "provenance.jsonl").open("ab") as handle:
        handle.write(b'{"claim_id":"not-finished"')
    client = TestClient(create_app(review_env["root"]))
    base = f"/api/identities/{IDENTITY_ID}/review/runs/torn-run"
    assert client.get(base).status_code == 200

    with (directory / "provenance.jsonl").open("ab") as handle:
        handle.write(b"}\n")
    response = client.get(base)
    assert response.status_code == 422
    assert "provenance.jsonl line 2 is invalid" in response.json()["detail"]


def test_decisions_append_reload_and_require_supersession(review_env: dict):
    project = review_env["project"]
    manifest = _write_run(project, "decision-run", "waiting_on_toma")
    client = TestClient(create_app(review_env["root"]))
    url = f"/api/identities/{IDENTITY_ID}/review/runs/decision-run/decisions"
    body = {
        "operation_id": "decision-operation-1",
        "decision_request_id": "request-decision-run",
        "answer": "yes",
        "rationale": "The scope is bounded.",
        "supersedes": None,
    }
    first = client.post(url, json=body)
    assert first.status_code == 201
    decision = first.json()["decision"]
    retry = client.post(url, json=body)
    assert retry.status_code == 201
    assert retry.json()["decision"] == decision
    assert client.post(url, json={**body, "answer": "no"}).status_code == 409
    assert decision["question"] == manifest["decision_requests"][0]["question"]
    assert decision["authorized_scope"] == manifest["decision_requests"][0]["authorized_scope"]

    assert client.post(
        url,
        json={**body, "operation_id": "decision-operation-2", "answer": "hold"},
    ).status_code == 409
    reversal = client.post(
        url,
        json={
            **body,
            "operation_id": "decision-operation-3",
            "answer": "hold",
            "supersedes": decision["decision_id"],
        },
    )
    assert reversal.status_code == 201
    reloaded = client.get(
        f"/api/identities/{IDENTITY_ID}/review/runs/decision-run"
    ).json()
    assert len(reloaded["decisions"]) == 2
    assert reloaded["decisions"][-1]["supersedes"] == decision["decision_id"]
    assert reloaded["pending_decision_count"] == 0


def test_annotation_pins_hash_and_only_later_run_can_address(review_env: dict):
    project = review_env["project"]
    original = _write_run(
        project, "original-run", "ready_for_review", started_at="2026-09-04T12:00:00Z"
    )
    later = _write_run(
        project, "later-run", "complete", started_at="2026-09-04T13:00:00Z"
    )
    client = TestClient(create_app(review_env["root"]))
    base = f"/api/identities/{IDENTITY_ID}/review/runs/original-run"
    annotation_body = {
        "operation_id": "annotation-operation-1",
        "target_type": "claim",
        "target_id": "claim-original-run",
        "artifact_ref": original["primary_artifact"]["path"],
        "artifact_sha256": original["primary_artifact"]["sha256"],
        "category": "overconfident_inference",
        "note": "Narrow this conclusion.",
    }
    assert client.post(f"{base}/annotations", json={**annotation_body, "artifact_sha256": "0" * 64}).status_code == 422
    response = client.post(f"{base}/annotations", json=annotation_body)
    assert response.status_code == 201
    annotation = response.json()["annotation"]
    retry = client.post(f"{base}/annotations", json=annotation_body)
    assert retry.status_code == 201
    assert retry.json()["annotation"] == annotation
    assert client.post(
        f"{base}/annotations", json={**annotation_body, "note": "Different payload."}
    ).status_code == 409

    address_body = {
        "operation_id": "address-operation-1",
        "later_run_id": "original-run",
        "replacement_claim_id": "claim-original-run",
        "replacement_artifact_ref": original["primary_artifact"]["path"],
        "replacement_artifact_sha256": original["primary_artifact"]["sha256"],
        "note": "Same-run attempts are forbidden.",
    }
    address_url = f"{base}/annotations/{annotation['annotation_id']}/address"
    assert client.post(address_url, json=address_body).status_code == 422
    addressed = client.post(
        address_url,
        json={
            **address_body,
            "later_run_id": "later-run",
            "replacement_claim_id": "claim-later-run",
            "replacement_artifact_ref": later["primary_artifact"]["path"],
            "replacement_artifact_sha256": later["primary_artifact"]["sha256"],
            "note": "A later artifact narrows the claim.",
        },
    )
    assert addressed.status_code == 201
    address = addressed.json()["address"]
    assert address["addressed_by_run_id"] == "later-run"
    successful_body = {
        **address_body,
        "later_run_id": "later-run",
        "replacement_claim_id": "claim-later-run",
        "replacement_artifact_ref": later["primary_artifact"]["path"],
        "replacement_artifact_sha256": later["primary_artifact"]["sha256"],
        "note": "A later artifact narrows the claim.",
    }
    retry = client.post(address_url, json=successful_body)
    assert retry.status_code == 201
    assert retry.json()["address"] == address
    assert client.post(
        address_url, json={**successful_body, "note": "Different payload."}
    ).status_code == 409
    assert [event["type"] for event in client.get(base).json()["annotations"]] == [
        "annotation",
        "addressed",
    ]


def test_duplicate_decision_is_idempotent_across_processes(review_env: dict):
    project = review_env["project"]
    _write_run(project, "process-run", "waiting_on_toma")
    body = {
        "operation_id": "cross-process-operation",
        "decision_request_id": "request-process-run",
        "answer": "yes",
        "rationale": "This retry must append exactly once.",
        "supersedes": None,
    }
    context = multiprocessing.get_context("spawn")
    start = context.Event()
    result_queue = context.Queue()
    processes = [
        context.Process(
            target=_decision_process,
            args=(str(review_env["identity"]), body, start, result_queue),
        )
        for _ in range(2)
    ]
    for process in processes:
        process.start()
    start.set()
    for process in processes:
        process.join(timeout=15)
        assert process.exitcode == 0
    results = [result_queue.get(timeout=2) for _ in processes]
    assert all(result["ok"] for result in results), results
    assert results[0]["record"] == results[1]["record"]
    ledger = project / "artifacts" / "runs" / "process-run" / "decisions.jsonl"
    assert len(ledger.read_text().splitlines()) == 1


def test_all_review_writes_are_forbidden_in_read_only_mode(review_env: dict):
    project = review_env["project"]
    manifest = _write_run(project, "readonly-run", "waiting_on_toma")
    client = TestClient(create_app(review_env["root"], read_only=True))
    base = f"/api/identities/{IDENTITY_ID}/review/runs/readonly-run"
    requests = [
        (
            f"{base}/decisions",
            {
                "operation_id": "readonly-decision-operation",
                "decision_request_id": "request-readonly-run",
                "answer": "yes",
                "rationale": "No write is allowed.",
                "supersedes": None,
            },
        ),
        (
            f"{base}/annotations",
            {
                "operation_id": "readonly-annotation-operation",
                "target_type": "claim",
                "target_id": "claim-readonly-run",
                "artifact_ref": manifest["primary_artifact"]["path"],
                "artifact_sha256": manifest["primary_artifact"]["sha256"],
                "category": "wrong_fact",
                "note": "No write is allowed.",
            },
        ),
        (
            f"{base}/annotations/any-annotation/address",
            {
                "operation_id": "readonly-address-operation",
                "later_run_id": "other-run",
                "replacement_claim_id": "claim-other-run",
                "replacement_artifact_ref": "artifacts/runs/other-run/artifact.md",
                "replacement_artifact_sha256": "0" * 64,
                "note": "No write is allowed.",
            },
        ),
    ]
    for url, body in requests:
        response = client.post(url, json=body)
        assert response.status_code == 403
        assert response.json()["detail"] == "Server is read-only"
