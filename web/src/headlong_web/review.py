"""Identity-workspace review runs, provenance, and append-only feedback.

Review data belongs to the operator-configured PROJECT_DIR from an identity's
``.env``.  The only accepted layout is::

    <PROJECT_DIR>/artifacts/runs/<run-id>/manifest.json

Manifest references are project-relative and must resolve back into that run
directory.  In particular, provenance ``local_file`` references are displayed
as persisted locators/excerpts; this module never opens them.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
import fcntl
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator, model_validator

from headlong_web import discovery, envfile, safety


RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
RECORD_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REVIEW_ROOT = Path("artifacts/runs")
MANIFEST_NAME = "manifest.json"
MAX_MANIFEST_BYTES = 512 * 1024
MAX_LEDGER_BYTES = 16 * 1024 * 1024
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
_PEM_PRIVATE_KEY_BLOCK_RE = re.compile(
    r"-----BEGIN (?P<label>[A-Z0-9 ]*PRIVATE KEY)-----.*?"
    r"-----END (?P=label)-----",
    re.DOTALL,
)
_SECRET_PATTERNS = (
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"\b(?:sk|sk-proj|ghp|github_pat)-[A-Za-z0-9_-]{8,}"),
    re.compile(
        r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b"
    ),
    re.compile(r"\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b"),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    re.compile(r"-----END [A-Z0-9 ]*PRIVATE KEY-----"),
    re.compile(
        r"(?i)\b(?:api[_ -]?key|token|password|secret|credential|"
        r"aws_access_key_id|aws_secret_access_key|aws_session_token)\s*[:=]\s*"
        r"[^\s,;]{4,}"
    ),
)


class ReviewError(Exception):
    """Base error translated to an HTTP response by server.py."""


class ReviewNotFound(ReviewError):
    pass


class ReviewInvalid(ReviewError):
    pass


class ReviewConflict(ReviewError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _identifier(value: str) -> str:
    if not RECORD_ID_RE.fullmatch(value):
        raise ValueError("invalid identifier")
    return value


def _relative_ref(value: str) -> str:
    if not value or "\x00" in value or "\\" in value:
        raise ValueError("must be a non-empty POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise ValueError("must be a contained relative path")
    return value


def _iso8601(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError("must include a UTC offset")
    return value


class ArtifactRef(StrictModel):
    path: str = Field(min_length=1, max_length=1024)
    title: str = Field(min_length=1, max_length=300)
    media_type: Literal["text/markdown"]
    sha256: str

    _path = field_validator("path")(_relative_ref)

    @field_validator("sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


class DecisionRequest(StrictModel):
    decision_request_id: str
    question: str = Field(min_length=1, max_length=2000)
    authorized_scope: str = Field(min_length=1, max_length=2000)
    context: str | None = Field(default=None, max_length=4000)
    claim_id: str | None = None

    _id = field_validator("decision_request_id")(_identifier)
    _claim_id = field_validator("claim_id")(
        lambda value: _identifier(value) if value is not None else value
    )

    @model_validator(mode="before")
    @classmethod
    def legacy_request_id(cls, value):
        if isinstance(value, dict) and "request_id" in value and "decision_request_id" not in value:
            value = dict(value)
            value["decision_request_id"] = value.pop("request_id")
        return value


class NextStepOption(StrictModel):
    option_id: str | None = None
    title: str = Field(min_length=1, max_length=300)
    scope: str = Field(min_length=1, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=1, le=7 * 24 * 60)
    duration: str | None = Field(default=None, min_length=1, max_length=100)
    expected_artifact: str = Field(min_length=1, max_length=1000)
    stopping_rule: str = Field(min_length=1, max_length=1000)
    recommended: bool = False

    _id = field_validator("option_id")(
        lambda value: _identifier(value) if value is not None else value
    )

    @model_validator(mode="after")
    def duration_contract(self) -> "NextStepOption":
        if self.duration_minutes is None and self.duration is None:
            raise ValueError("duration_minutes or duration is required")
        return self


class RunResult(StrictModel):
    kind: Literal["failure"]
    summary: str = Field(min_length=1, max_length=2000)


class RunManifest(StrictModel):
    schema_version: Literal[1]
    run_id: str
    identity_id: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    goal_ref: str = Field(min_length=1, max_length=1024)
    status: Literal[
        "running", "ready_for_review", "waiting_on_toma", "complete", "failed"
    ]
    started_at: str
    deadline: str
    progress_summary: str | None = Field(default=None, max_length=4000)
    updated_at: str | None = None
    imported_from: str | None = Field(default=None, max_length=1024)
    primary_artifact: ArtifactRef | None = None
    supporting_artifacts: list[ArtifactRef] = Field(default_factory=list, max_length=100)
    sentience_receipt_ref: str = Field(max_length=1024)
    provenance_ref: str = Field(max_length=1024)
    decision_ledger_ref: str = Field(max_length=1024)
    annotation_ledger_ref: str = Field(max_length=1024)
    decision_requests: list[DecisionRequest] = Field(default_factory=list, max_length=100)
    next_step_options: list[NextStepOption] = Field(default_factory=list, max_length=20)
    result: RunResult | None = None
    failure_reason: str | None = Field(default=None, max_length=2000)

    _run_id = field_validator("run_id")(_identifier)
    _started_at = field_validator("started_at")(_iso8601)
    _deadline = field_validator("deadline")(_iso8601)
    _updated_at = field_validator("updated_at")(
        lambda value: _iso8601(value) if value is not None else value
    )
    _goal_ref = field_validator("goal_ref")(_relative_ref)
    _imported_from = field_validator("imported_from")(
        lambda value: _relative_ref(value) if value is not None else value
    )
    _sidecar_refs = field_validator(
        "sentience_receipt_ref",
        "provenance_ref",
        "decision_ledger_ref",
        "annotation_ledger_ref",
    )(_relative_ref)

    @model_validator(mode="after")
    def status_contract(self) -> "RunManifest":
        if self.status in {"ready_for_review", "waiting_on_toma", "complete"} and self.primary_artifact is None:
            raise ValueError(f"{self.status} requires a primary_artifact")
        if self.status == "waiting_on_toma" and not self.decision_requests:
            raise ValueError("waiting_on_toma requires decision_requests")
        if self.status == "failed" and self.result is None and not self.failure_reason:
            raise ValueError("failed requires result or failure_reason")
        if self.result is None and self.failure_reason:
            self.result = RunResult(kind="failure", summary=self.failure_reason)
        ids = [request.decision_request_id for request in self.decision_requests]
        if len(ids) != len(set(ids)):
            raise ValueError("decision_request_id values must be unique")
        return self


class EvidenceSource(StrictModel):
    kind: Literal["web", "local_file", "trajectory_step", "sentience"]
    ref: str = Field(min_length=1, max_length=2048)
    label: str = Field(min_length=1, max_length=500)
    excerpt: str = Field(default="", max_length=8000)
    retrieved_at: str | None = None

    _retrieved = field_validator("retrieved_at")(
        lambda value: _iso8601(value) if value is not None else value
    )


class ProvenanceRecord(StrictModel):
    claim_id: str
    artifact_ref: str
    artifact_sha256: str
    claim_text: str = Field(min_length=1, max_length=10000)
    evidence_class: Literal["observed", "inferred", "proposed", "sentience_judgment"]
    sources: list[EvidenceSource] = Field(default_factory=list, max_length=100)
    reason: str = Field(min_length=1, max_length=8000)
    rejected_alternatives: list[str] = Field(default_factory=list, max_length=100)
    uncertainty: str | None = Field(default=None, max_length=8000)

    _claim_id = field_validator("claim_id")(_identifier)
    _artifact_ref = field_validator("artifact_ref")(_relative_ref)

    @field_validator("artifact_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


class SentienceReceipt(StrictModel):
    receipt_id: str
    question: str = Field(min_length=1, max_length=10000)
    response: str = Field(min_length=1, max_length=20000)
    thread_ref: str | None = Field(default=None, max_length=500)
    request_ref: str | None = Field(default=None, max_length=500)
    timestamp: str
    affected_claim_id: str | None = None
    affected_decision_request_id: str | None = None
    resulting_change: str = Field(min_length=1, max_length=4000)

    _receipt_id = field_validator("receipt_id")(_identifier)
    _timestamp = field_validator("timestamp")(_iso8601)
    _affected_ids = field_validator(
        "affected_claim_id", "affected_decision_request_id"
    )(lambda value: _identifier(value) if value is not None else value)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_shape(cls, value):
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if "thread_receipt" in normalized and "thread_ref" not in normalized:
            normalized["thread_ref"] = normalized.pop("thread_receipt")
        if "affected_ref" in normalized and not (
            normalized.get("affected_claim_id")
            or normalized.get("affected_decision_request_id")
        ):
            normalized["affected_claim_id"] = normalized.pop("affected_ref")
        return normalized


class DecisionRecord(StrictModel):
    operation_id: str | None = None
    decision_id: str
    run_id: str
    decision_request_id: str
    question: str = Field(min_length=1, max_length=2000)
    answer: Literal["yes", "no", "hold", "need_more_evidence"]
    rationale: str = Field(default="", max_length=4000)
    decided_at: str
    supersedes: str | None = None
    authorized_scope: str = Field(min_length=1, max_length=2000)

    _ids = field_validator("decision_id", "run_id", "decision_request_id")(_identifier)
    _operation_id = field_validator("operation_id")(
        lambda value: _identifier(value) if value is not None else value
    )
    _supersedes = field_validator("supersedes")(
        lambda value: _identifier(value) if value is not None else value
    )
    _decided_at = field_validator("decided_at")(_iso8601)


AnnotationCategory = Literal[
    "wrong_fact",
    "weak_or_missing_evidence",
    "overconfident_inference",
    "ignored_counterevidence",
    "wrong_tradeoff_or_value_judgment",
    "exceeded_authorized_scope",
    "unclear_or_too_much_text",
    "other",
]


class AnnotationRecord(StrictModel):
    type: Literal["annotation"]
    operation_id: str | None = None
    annotation_id: str
    run_id: str
    target_type: Literal["claim", "decision"]
    target_id: str
    artifact_ref: str
    artifact_sha256: str
    category: AnnotationCategory
    note: str = Field(default="", max_length=4000)
    created_at: str

    _ids = field_validator("annotation_id", "run_id", "target_id")(_identifier)
    _operation_id = field_validator("operation_id")(
        lambda value: _identifier(value) if value is not None else value
    )
    _artifact_ref = field_validator("artifact_ref")(_relative_ref)
    _created_at = field_validator("created_at")(_iso8601)

    @field_validator("artifact_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


class AddressRecord(StrictModel):
    type: Literal["addressed"]
    operation_id: str | None = None
    address_id: str
    annotation_id: str
    addressed_by_run_id: str
    replacement_claim_id: str
    replacement_artifact_ref: str
    replacement_artifact_sha256: str
    note: str = Field(default="", max_length=4000)
    addressed_at: str

    _ids = field_validator(
        "address_id", "annotation_id", "addressed_by_run_id", "replacement_claim_id"
    )(_identifier)
    _operation_id = field_validator("operation_id")(
        lambda value: _identifier(value) if value is not None else value
    )
    _artifact_ref = field_validator("replacement_artifact_ref")(_relative_ref)
    _addressed_at = field_validator("addressed_at")(_iso8601)

    @field_validator("replacement_artifact_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


AnnotationEvent = Annotated[AnnotationRecord | AddressRecord, Field(discriminator="type")]


class DecisionInput(StrictModel):
    operation_id: str
    decision_request_id: str
    answer: Literal["yes", "no", "hold", "need_more_evidence"]
    rationale: str = Field(default="", max_length=4000)
    supersedes: str | None = None

    _id = field_validator("decision_request_id")(_identifier)
    _operation_id = field_validator("operation_id")(_identifier)
    _supersedes = field_validator("supersedes")(
        lambda value: _identifier(value) if value is not None else value
    )


class AnnotationInput(StrictModel):
    operation_id: str
    target_type: Literal["claim", "decision"]
    target_id: str
    artifact_ref: str
    artifact_sha256: str
    category: AnnotationCategory
    note: str = Field(default="", max_length=4000)

    _target_id = field_validator("target_id")(_identifier)
    _operation_id = field_validator("operation_id")(_identifier)
    _artifact_ref = field_validator("artifact_ref")(_relative_ref)

    @field_validator("artifact_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


class AddressInput(StrictModel):
    operation_id: str
    later_run_id: str
    replacement_claim_id: str
    replacement_artifact_ref: str
    replacement_artifact_sha256: str
    note: str = Field(default="", max_length=4000)

    _ids = field_validator("later_run_id", "replacement_claim_id")(_identifier)
    _operation_id = field_validator("operation_id")(_identifier)
    _artifact_ref = field_validator("replacement_artifact_ref")(_relative_ref)

    @field_validator("replacement_artifact_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        value = value.lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 digest")
        return value


_locks_guard = threading.Lock()
_ledger_locks: dict[Path, threading.Lock] = {}


def _ledger_lock(path: Path) -> threading.Lock:
    with _locks_guard:
        return _ledger_locks.setdefault(path, threading.Lock())


@contextmanager
def _ledger_transaction(path: Path):
    """Serialize a ledger read/validate/append transaction across processes."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = path.with_suffix(".lock")
    with _ledger_lock(lock_path):
        try:
            lock_fd = os.open(lock_path, os.O_APPEND | os.O_CREAT | os.O_RDWR, 0o600)
        except OSError as exc:
            raise ReviewInvalid(f"{path.name} lock cannot be opened") from exc
        try:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX)
            except OSError as exc:
                raise ReviewInvalid(f"{path.name} cannot be locked") from exc
            try:
                ledger_fd = os.open(
                    path, os.O_APPEND | os.O_CREAT | os.O_RDWR, 0o600
                )
            except OSError as exc:
                raise ReviewInvalid(f"{path.name} cannot be opened for append") from exc
            try:
                yield ledger_fd
            finally:
                os.close(ledger_fd)
        finally:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
            finally:
                os.close(lock_fd)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redact_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = _PEM_PRIVATE_KEY_BLOCK_RE.sub("<redacted>", value)
    for pattern in _SECRET_PATTERNS:
        value = pattern.sub("<redacted>", value)
    return value


def _redact_receipt(receipt: dict) -> dict:
    return {
        **receipt,
        "question": _redact_text(receipt["question"]),
        "response": _redact_text(receipt["response"]),
        "thread_ref": _redact_text(receipt.get("thread_ref")),
        "request_ref": _redact_text(receipt.get("request_ref")),
        "resulting_change": _redact_text(receipt["resulting_change"]),
    }


def _project_dir(identity: discovery.IdentityInfo) -> Path | None:
    values = dict(envfile.parse_env_file(identity.path / ".env"))
    raw = values.get("PROJECT_DIR", "").strip()
    if not raw:
        return None
    home = str(Path.home())
    raw = raw.replace("${HOME}", home).replace("$HOME", home)
    path = Path(raw).expanduser()
    if not path.is_absolute():
        return None
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return None
    return resolved if resolved.is_dir() else None


def _runs_root(identity: discovery.IdentityInfo) -> Path | None:
    project = _project_dir(identity)
    if project is None:
        return None
    lexical = project.joinpath(*REVIEW_ROOT.parts)
    try:
        path = safety.contained_path(project, *REVIEW_ROOT.parts)
    except (OSError, HTTPException):
        return None
    if path != lexical:
        return None
    return path if path.is_dir() else None


def _run_dir(identity: discovery.IdentityInfo, run_id: str) -> tuple[Path, Path]:
    if not RUN_ID_RE.fullmatch(run_id):
        raise ReviewNotFound("Review run not found")
    project = _project_dir(identity)
    if project is None:
        raise ReviewNotFound("Identity has no configured review workspace")
    root = safety.contained_path(project, *REVIEW_ROOT.parts)
    if root != project.joinpath(*REVIEW_ROOT.parts):
        raise ReviewNotFound("Identity has no configured review workspace")
    path = safety.contained_path(root, run_id)
    if path.parent != root:
        raise ReviewNotFound("Review run not found")
    if not path.is_dir():
        raise ReviewNotFound("Review run not found")
    return project, path


def _read_small_json(path: Path) -> object:
    try:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ReviewInvalid("manifest exceeds size limit")
        return json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except ReviewInvalid:
        raise
    except FileNotFoundError as exc:
        raise ReviewInvalid("manifest.json is missing") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReviewInvalid(f"manifest is unreadable: {exc}") from exc


def _validation_messages(exc: ValidationError) -> list[str]:
    messages = []
    for error in exc.errors(include_url=False):
        where = ".".join(str(part) for part in error["loc"])
        messages.append(f"{where}: {error['msg']}" if where else error["msg"])
    return messages


def _contained_ref(project: Path, run_dir: Path, ref: str) -> Path:
    try:
        _relative_ref(ref)
        path = safety.contained_path(project, *PurePosixPath(ref).parts)
    except (ValueError, OSError, HTTPException) as exc:
        raise ReviewInvalid(f"unsafe manifest reference: {ref}") from exc
    run_resolved = run_dir.resolve()
    if path != run_resolved and not path.is_relative_to(run_resolved):
        raise ReviewInvalid(f"manifest reference leaves its run directory: {ref}")
    return path


def _sha256(path: Path) -> str:
    try:
        if not path.is_file():
            raise ReviewInvalid(f"artifact is missing: {path.name}")
        if path.stat().st_size > MAX_ARTIFACT_BYTES:
            raise ReviewInvalid(f"artifact exceeds {MAX_ARTIFACT_BYTES} bytes")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(128 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except ReviewInvalid:
        raise
    except OSError as exc:
        raise ReviewInvalid(f"artifact is unreadable: {path.name}") from exc


def _load_valid_manifest(
    identity: discovery.IdentityInfo, project: Path, run_dir: Path
) -> RunManifest:
    raw = _read_small_json(run_dir / MANIFEST_NAME)
    try:
        manifest = RunManifest.model_validate(raw)
    except ValidationError as exc:
        raise ReviewInvalid("; ".join(_validation_messages(exc))) from exc
    if manifest.run_id != run_dir.name:
        raise ReviewInvalid("manifest run_id does not match its directory")
    if manifest.identity_id not in {identity.id, identity.name}:
        raise ReviewInvalid("manifest identity_id does not match the route identity")

    refs = [
        manifest.sentience_receipt_ref,
        manifest.provenance_ref,
        manifest.decision_ledger_ref,
        manifest.annotation_ledger_ref,
    ]
    refs.extend(artifact.path for artifact in manifest.supporting_artifacts)
    if manifest.primary_artifact is not None:
        refs.append(manifest.primary_artifact.path)
    for ref in refs:
        _contained_ref(project, run_dir, ref)

    for artifact in [
        artifact
        for artifact in [manifest.primary_artifact, *manifest.supporting_artifacts]
        if artifact is not None
    ]:
        actual = _sha256(_contained_ref(project, run_dir, artifact.path))
        if actual != artifact.sha256:
            raise ReviewInvalid(f"artifact SHA-256 mismatch: {artifact.path}")
    return manifest


def _invalid_summary(run_dir: Path, raw: object | None, errors: list[str]) -> dict:
    data = raw if isinstance(raw, dict) else {}
    status = data.get("status")
    if status not in {"running", "ready_for_review", "waiting_on_toma", "complete", "failed"}:
        status = "failed"
    return {
        "run_id": data.get("run_id") if isinstance(data.get("run_id"), str) else run_dir.name,
        "title": data.get("title") if isinstance(data.get("title"), str) else run_dir.name,
        "goal_ref": data.get("goal_ref") if isinstance(data.get("goal_ref"), str) else "",
        "status": status,
        "started_at": data.get("started_at") if isinstance(data.get("started_at"), str) else None,
        "deadline": data.get("deadline") if isinstance(data.get("deadline"), str) else None,
        "time_remaining_s": None,
        "primary_artifact": None,
        "pending_decision_count": 0,
        "valid": False,
        "validation_errors": errors,
    }


def _time_remaining(deadline: str | None) -> int | None:
    if deadline is None:
        return None
    target = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    return max(0, int((target - datetime.now(timezone.utc)).total_seconds()))


def _read_jsonl(path: Path, model) -> list[dict]:
    """Read complete, strict JSONL records. A torn final write waits for reload."""
    try:
        if not path.exists():
            return []
        if path.stat().st_size > MAX_LEDGER_BYTES:
            raise ReviewInvalid(f"{path.name} exceeds size limit")
        raw = path.read_bytes()
    except ReviewInvalid:
        raise
    except OSError as exc:
        raise ReviewInvalid(f"{path.name} is unreadable") from exc
    lines = raw.splitlines(keepends=True)
    result = []
    for index, line in enumerate(lines, start=1):
        if not line.endswith(b"\n"):
            continue
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
            record = model.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ReviewInvalid(f"{path.name} line {index} is invalid") from exc
        result.append(record.model_dump(mode="json"))
    return result


def _load_ledgers(project: Path, run_dir: Path, manifest: RunManifest) -> dict:
    provenance = _read_jsonl(
        _contained_ref(project, run_dir, manifest.provenance_ref), ProvenanceRecord
    )
    receipts = _read_jsonl(
        _contained_ref(project, run_dir, manifest.sentience_receipt_ref), SentienceReceipt
    )
    receipts = [_redact_receipt(receipt) for receipt in receipts]
    decisions = _read_jsonl(
        _contained_ref(project, run_dir, manifest.decision_ledger_ref), DecisionRecord
    )

    adapter = TypeAdapter(AnnotationEvent)
    annotation_path = _contained_ref(project, run_dir, manifest.annotation_ledger_ref)
    try:
        if not annotation_path.exists():
            annotations = []
        else:
            if annotation_path.stat().st_size > MAX_LEDGER_BYTES:
                raise ReviewInvalid(f"{annotation_path.name} exceeds size limit")
            lines = annotation_path.read_bytes().splitlines(keepends=True)
            annotations = []
            for index, line in enumerate(lines, start=1):
                if not line.endswith(b"\n"):
                    continue
                if not line.strip():
                    continue
                try:
                    annotations.append(adapter.validate_json(line).model_dump(mode="json"))
                except ValidationError as exc:
                    raise ReviewInvalid(
                        f"{annotation_path.name} line {index} is invalid"
                    ) from exc
    except ReviewInvalid:
        raise
    except OSError as exc:
        raise ReviewInvalid(f"{annotation_path.name} is unreadable") from exc

    artifacts = {
        artifact.path: artifact.sha256
        for artifact in [manifest.primary_artifact, *manifest.supporting_artifacts]
        if artifact is not None
    }
    for trace in provenance:
        expected_hash = artifacts.get(trace["artifact_ref"])
        if expected_hash is None or trace["artifact_sha256"] != expected_hash:
            raise ReviewInvalid(
                f"provenance claim {trace['claim_id']} is not pinned to a manifest artifact"
            )

    requests = {
        request.decision_request_id: request for request in manifest.decision_requests
    }
    decisions_by_id: dict[str, dict] = {}
    for decision in decisions:
        request = requests.get(decision["decision_request_id"])
        if (
            decision["run_id"] != manifest.run_id
            or request is None
            or decision["question"] != request.question
            or decision["authorized_scope"] != request.authorized_scope
        ):
            raise ReviewInvalid(
                f"decision {decision['decision_id']} does not match its manifest request"
            )
        supersedes = decision.get("supersedes")
        if supersedes is not None:
            earlier = decisions_by_id.get(supersedes)
            if (
                earlier is None
                or earlier["decision_request_id"] != decision["decision_request_id"]
            ):
                raise ReviewInvalid(
                    f"decision {decision['decision_id']} has an invalid supersedes link"
                )
        decisions_by_id[decision["decision_id"]] = decision

    annotations_by_id: set[str] = set()
    claim_ids = {trace["claim_id"] for trace in provenance}
    for event in annotations:
        if event["type"] == "annotation":
            if event["run_id"] != manifest.run_id:
                raise ReviewInvalid(
                    f"annotation {event['annotation_id']} belongs to another run"
                )
            expected_hash = artifacts.get(event["artifact_ref"])
            if expected_hash is None or event["artifact_sha256"] != expected_hash:
                raise ReviewInvalid(
                    f"annotation {event['annotation_id']} is not pinned to a manifest artifact"
                )
            if (
                event["target_type"] == "claim"
                and event["target_id"] not in claim_ids
            ) or (
                event["target_type"] == "decision"
                and event["target_id"] not in decisions_by_id
            ):
                raise ReviewInvalid(
                    f"annotation {event['annotation_id']} has an unknown target"
                )
            annotations_by_id.add(event["annotation_id"])
        elif event["annotation_id"] not in annotations_by_id:
            raise ReviewInvalid(
                f"address event {event['address_id']} precedes its annotation"
            )
    return {
        "provenance": provenance,
        "sentience_receipts": receipts,
        "decisions": decisions,
        "annotations": annotations,
    }


def _pending_requests(manifest: RunManifest, decisions: list[dict]) -> list[dict]:
    answered = {record["decision_request_id"] for record in decisions}
    return [
        {
            **request.model_dump(mode="json"),
            "answered": request.decision_request_id in answered,
            "latest_decision_id": next(
                (
                    row["decision_id"]
                    for row in reversed(decisions)
                    if row["decision_request_id"] == request.decision_request_id
                ),
                None,
            ),
        }
        for request in manifest.decision_requests
    ]


def _valid_run(identity: discovery.IdentityInfo, run_id: str):
    project, run_dir = _run_dir(identity, run_id)
    manifest = _load_valid_manifest(identity, project, run_dir)
    ledgers = _load_ledgers(project, run_dir, manifest)
    return project, run_dir, manifest, ledgers


def review_summary(identity: discovery.IdentityInfo) -> dict:
    root = _runs_root(identity)
    summaries = []
    if root is not None:
        project = root.parents[1]
        for run_dir in sorted(root.iterdir()):
            if not run_dir.is_dir():
                continue
            raw: object | None = None
            try:
                resolved_dir = run_dir.resolve(strict=True)
                if not resolved_dir.is_relative_to(root.resolve()):
                    raise ReviewInvalid("run directory leaves the configured review root")
                raw = _read_small_json(run_dir / MANIFEST_NAME)
                manifest = _load_valid_manifest(identity, project, run_dir)
                ledgers = _load_ledgers(project, run_dir, manifest)
                requests = _pending_requests(manifest, ledgers["decisions"])
                summaries.append(
                    {
                        "run_id": manifest.run_id,
                        "title": manifest.title,
                        "goal_ref": manifest.goal_ref,
                        "status": manifest.status,
                        "started_at": manifest.started_at,
                        "deadline": manifest.deadline,
                        "time_remaining_s": _time_remaining(manifest.deadline),
                        "primary_artifact": (
                            manifest.primary_artifact.model_dump(mode="json")
                            if manifest.primary_artifact
                            else None
                        ),
                        "pending_decision_count": sum(
                            not request["answered"] for request in requests
                        ),
                        "valid": True,
                        "validation_errors": [],
                    }
                )
            except (ReviewInvalid, OSError) as exc:
                summaries.append(_invalid_summary(run_dir, raw, [str(exc)]))
    summaries.sort(key=lambda row: row.get("started_at") or "", reverse=True)
    return {
        "identity": {"id": identity.id, "name": identity.name},
        "review_count": sum(
            row["valid"] and row["status"] in {"ready_for_review", "waiting_on_toma"}
            for row in summaries
        ),
        "runs": summaries,
    }


def run_detail(identity: discovery.IdentityInfo, run_id: str) -> dict:
    project, run_dir, manifest, ledgers = _valid_run(identity, run_id)
    requests = _pending_requests(manifest, ledgers["decisions"])
    artifact = None
    if manifest.primary_artifact is not None:
        ref = manifest.primary_artifact
        path = _contained_ref(project, run_dir, ref.path)
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise ReviewInvalid("primary artifact is unreadable") from exc
        artifact = {**ref.model_dump(mode="json"), "content": content}
    return {
        "identity": {"id": identity.id, "name": identity.name},
        "manifest": manifest.model_dump(mode="json"),
        "valid": True,
        "validation_errors": [],
        "time_remaining_s": _time_remaining(manifest.deadline),
        "pending_decision_count": sum(not request["answered"] for request in requests),
        "artifact": artifact,
        "provenance": ledgers["provenance"],
        "sentience_receipts": ledgers["sentience_receipts"],
        "decision_requests": requests,
        "decisions": ledgers["decisions"],
        "annotations": ledgers["annotations"],
    }


def claim_trace(identity: discovery.IdentityInfo, run_id: str, claim_id: str) -> dict:
    try:
        _identifier(claim_id)
    except ValueError as exc:
        raise ReviewNotFound("Claim not found") from exc
    _project, _run_dir_path, _manifest, ledgers = _valid_run(identity, run_id)
    trace = next(
        (row for row in ledgers["provenance"] if row["claim_id"] == claim_id), None
    )
    if trace is None:
        return {"claim_id": claim_id, "linked": False, "message": "No evidence linked"}
    receipts = [
        row
        for row in ledgers["sentience_receipts"]
        if row.get("affected_claim_id") == claim_id
    ]
    return {
        "claim_id": claim_id,
        "linked": True,
        "trace": trace,
        "sentience_receipts": receipts,
    }


def _append_jsonl(fd: int, record: dict) -> None:
    payload = (json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    if len(payload) > 64 * 1024:
        raise ReviewInvalid("record exceeds append limit")
    try:
        written = os.write(fd, payload)
        if written != len(payload):
            raise ReviewInvalid("record append was incomplete")
        os.fsync(fd)
    except ReviewInvalid:
        raise
    except OSError as exc:
        raise ReviewInvalid("record append failed") from exc


def _idempotent_retry(
    records: list[dict], operation_id: str, expected: dict
) -> dict | None:
    prior = next(
        (
            record
            for record in records
            if record.get("operation_id") == operation_id
        ),
        None,
    )
    if prior is None:
        return None
    if all(prior.get(key) == value for key, value in expected.items()):
        return prior
    raise ReviewConflict("operation_id was already used for another operation")


def append_decision(
    identity: discovery.IdentityInfo, run_id: str, body: DecisionInput
) -> dict:
    project, run_dir, manifest, _ledgers = _valid_run(identity, run_id)
    path = _contained_ref(project, run_dir, manifest.decision_ledger_ref)
    with _ledger_transaction(path) as ledger_fd:
        ledgers = _load_ledgers(project, run_dir, manifest)
        retry = _idempotent_retry(
            ledgers["decisions"],
            body.operation_id,
            {
                "decision_request_id": body.decision_request_id,
                "answer": body.answer,
                "rationale": body.rationale,
                "supersedes": body.supersedes,
            },
        )
        if retry is not None:
            return retry
        request = next(
            (
                item
                for item in manifest.decision_requests
                if item.decision_request_id == body.decision_request_id
            ),
            None,
        )
        if request is None:
            raise ReviewInvalid("decision_request_id is not declared by the manifest")
        prior = [
            row
            for row in ledgers["decisions"]
            if row["decision_request_id"] == body.decision_request_id
        ]
        if body.supersedes is None and prior:
            raise ReviewConflict("A reversal must name the decision it supersedes")
        if body.supersedes is not None:
            old = next(
                (row for row in ledgers["decisions"] if row["decision_id"] == body.supersedes),
                None,
            )
            if old is None or old["decision_request_id"] != body.decision_request_id:
                raise ReviewInvalid("supersedes must name a decision for this request and run")
        record = DecisionRecord(
            operation_id=body.operation_id,
            decision_id=str(uuid.uuid4()),
            run_id=manifest.run_id,
            decision_request_id=request.decision_request_id,
            question=request.question,
            answer=body.answer,
            rationale=body.rationale,
            decided_at=_now(),
            supersedes=body.supersedes,
            authorized_scope=request.authorized_scope,
        ).model_dump(mode="json")
        _append_jsonl(ledger_fd, record)
    return record


def _artifact_for(manifest: RunManifest, ref: str) -> ArtifactRef | None:
    for artifact in [manifest.primary_artifact, *manifest.supporting_artifacts]:
        if artifact is not None and artifact.path == ref:
            return artifact
    return None


def append_annotation(
    identity: discovery.IdentityInfo, run_id: str, body: AnnotationInput
) -> dict:
    project, run_dir, manifest, _ledgers = _valid_run(identity, run_id)
    path = _contained_ref(project, run_dir, manifest.annotation_ledger_ref)
    with _ledger_transaction(path) as ledger_fd:
        ledgers = _load_ledgers(project, run_dir, manifest)
        retry = _idempotent_retry(
            ledgers["annotations"],
            body.operation_id,
            {
                "type": "annotation",
                "run_id": manifest.run_id,
                "target_type": body.target_type,
                "target_id": body.target_id,
                "artifact_ref": body.artifact_ref,
                "artifact_sha256": body.artifact_sha256,
                "category": body.category,
                "note": body.note,
            },
        )
        if retry is not None:
            return retry
        artifact = _artifact_for(manifest, body.artifact_ref)
        if artifact is None or artifact.sha256 != body.artifact_sha256:
            raise ReviewInvalid("annotation must pin a manifest artifact and its SHA-256")
        if body.target_type == "claim":
            exists = any(
                row["claim_id"] == body.target_id for row in ledgers["provenance"]
            )
        else:
            exists = any(
                row["decision_id"] == body.target_id for row in ledgers["decisions"]
            )
        if not exists:
            raise ReviewInvalid("annotation target does not exist in this run")
        record = AnnotationRecord(
            type="annotation",
            operation_id=body.operation_id,
            annotation_id=str(uuid.uuid4()),
            run_id=manifest.run_id,
            target_type=body.target_type,
            target_id=body.target_id,
            artifact_ref=artifact.path,
            artifact_sha256=artifact.sha256,
            category=body.category,
            note=body.note,
            created_at=_now(),
        ).model_dump(mode="json")
        _append_jsonl(ledger_fd, record)
    return record


def append_address(
    identity: discovery.IdentityInfo,
    run_id: str,
    annotation_id: str,
    body: AddressInput,
) -> dict:
    project, run_dir, manifest, _ledgers = _valid_run(identity, run_id)
    path = _contained_ref(project, run_dir, manifest.annotation_ledger_ref)
    with _ledger_transaction(path) as ledger_fd:
        ledgers = _load_ledgers(project, run_dir, manifest)
        retry = _idempotent_retry(
            ledgers["annotations"],
            body.operation_id,
            {
                "type": "addressed",
                "annotation_id": annotation_id,
                "addressed_by_run_id": body.later_run_id,
                "replacement_claim_id": body.replacement_claim_id,
                "replacement_artifact_ref": body.replacement_artifact_ref,
                "replacement_artifact_sha256": body.replacement_artifact_sha256,
                "note": body.note,
            },
        )
        if retry is not None:
            return retry
        annotation = next(
            (
                row
                for row in ledgers["annotations"]
                if row.get("type") == "annotation"
                and row.get("annotation_id") == annotation_id
            ),
            None,
        )
        if annotation is None:
            raise ReviewNotFound("Annotation not found")
        if body.later_run_id == run_id:
            raise ReviewInvalid("an annotation can only be addressed by a later run")
        _later_project, _later_dir, later, later_ledgers = _valid_run(
            identity, body.later_run_id
        )
        original_started = datetime.fromisoformat(
            manifest.started_at.replace("Z", "+00:00")
        )
        later_started = datetime.fromisoformat(later.started_at.replace("Z", "+00:00"))
        if later_started <= original_started:
            raise ReviewInvalid("addressing run must start after the annotated run")
        artifact = _artifact_for(later, body.replacement_artifact_ref)
        if artifact is None or artifact.sha256 != body.replacement_artifact_sha256:
            raise ReviewInvalid("address event must pin a later-run manifest artifact")
        replacement = next(
            (
                row
                for row in later_ledgers["provenance"]
                if row["claim_id"] == body.replacement_claim_id
            ),
            None,
        )
        if replacement is None or replacement["artifact_ref"] != artifact.path:
            raise ReviewInvalid(
                "replacement claim is not linked to the pinned later artifact"
            )
        record = AddressRecord(
            type="addressed",
            operation_id=body.operation_id,
            address_id=str(uuid.uuid4()),
            annotation_id=annotation_id,
            addressed_by_run_id=later.run_id,
            replacement_claim_id=body.replacement_claim_id,
            replacement_artifact_ref=artifact.path,
            replacement_artifact_sha256=artifact.sha256,
            note=body.note,
            addressed_at=_now(),
        ).model_dump(mode="json")
        _append_jsonl(ledger_fd, record)
    return record
