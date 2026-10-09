#!/usr/bin/env python3
"""AppFactory: opt-in, host-local Compose rollout. Never invoked by CI automatically.

Input JSON is read from stdin and contains no credentials. The host must already
have the approved release checkout, runtime env file, authenticated GHCR access,
and a separate backup/drain hook. No Git fetch, install, or cloud provisioning.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request

SLUG = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SHA = re.compile(r"^[a-f0-9]{40}$")
IMAGE = re.compile(r"^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+@sha256:[a-f0-9]{64}$")
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
PATH = re.compile(r"^[a-zA-Z0-9_./-]+$")
LOCAL_HEALTH = re.compile(r"^http://127\.0\.0\.1(?::[1-9][0-9]{1,4})?/[A-Za-z0-9_./-]*$")
STATEFUL = frozenset({"db", "database", "postgres", "redis", "mongo", "mongodb"})
ROOT = Path("/opt/appfactory")


class RolloutError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RolloutError(message)


def json_file(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(payload, dict), "expected JSON object")
    return payload


def safe_child(base: Path, value: str) -> Path:
    require(isinstance(value, str) and bool(PATH.fullmatch(value)), "invalid relative path")
    require(not value.startswith(("/", "./")) and "//" not in value
            and ".." not in value.split("/"), "path escapes approved directory")
    base_real = base.resolve(strict=True)
    destination = (base / value).resolve(strict=False)
    require(destination.is_relative_to(base_real), "symlink path escapes approved directory")
    return destination


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def run(args: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    result = subprocess.run(args, cwd=cwd, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=180, check=False)
    if result.returncode:
        raise RolloutError("command failed (details redacted): " + args[0])


def capture(args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                            timeout=30, check=False)
    require(result.returncode == 0, "cannot validate host Git identity")
    return result.stdout.strip()


def check_release_checkout(repo: Path, repository: str, source_sha: str) -> None:
    require(repo.is_dir() and not repo.is_symlink() and (repo / ".git").exists(),
            "host checkout is missing or unsafe")
    origin = capture(["git", "remote", "get-url", "origin"], cwd=repo)
    allowed = {
        "https://github.com/" + repository,
        "https://github.com/" + repository + ".git",
        "git@github.com:" + repository + ".git",
    }
    require(origin in allowed, "host Git origin does not match expected repository")
    require(capture(["git", "rev-parse", "HEAD"], cwd=repo) == source_sha,
            "host checkout must already be at the CI-proven SHA")


def validate_input(payload: dict) -> dict:
    require(isinstance(payload, dict), "rollout payload must be an object")
    expected = {"schemaVersion", "projectId", "environment", "repository",
                "sourceSha", "composeProject", "composePath", "runtimeEnvTarget",
                "predeployHook", "healthUrl", "images", "imageServices", "backupKinds"}
    require(set(payload) == expected, "rollout payload fields are missing/unknown")
    require(payload["schemaVersion"] == 1, "unsupported rollout schema")
    project, environment, repository, source_sha = (
        payload["projectId"], payload["environment"],
        payload["repository"], payload["sourceSha"])
    require(isinstance(project, str) and bool(SLUG.fullmatch(project)), "invalid project ID")
    require(isinstance(environment, str) and bool(SLUG.fullmatch(environment)), "invalid environment")
    require(isinstance(repository, str) and
            bool(re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", repository)), "invalid repository")
    require(isinstance(source_sha, str) and bool(SHA.fullmatch(source_sha)), "invalid source SHA")
    require(payload["composeProject"] == project + "-" + environment,
            "Compose project does not match app/environment")
    require(isinstance(payload["healthUrl"], str) and
            bool(LOCAL_HEALTH.fullmatch(payload["healthUrl"])) and
            ".." not in payload["healthUrl"], "health URL must use local loopback")
    for key in ("composePath", "runtimeEnvTarget", "predeployHook"):
        value = payload[key]
        require(isinstance(value, str) and bool(PATH.fullmatch(value))
                and not value.startswith("/") and
                ".." not in value.split("/") and "//" not in value,
                "unsafe " + key)
    require(Path(payload["runtimeEnvTarget"]).name.startswith(".env"),
            "runtime environment must be a dedicated .env file")
    images, mapping = payload["images"], payload["imageServices"]
    require(isinstance(images, dict) and 1 <= len(images) <= 6, "images missing")
    require(isinstance(mapping, dict) and set(mapping) == set(images), "image/service mismatch")
    services = list(mapping.values())
    require(len(services) == len(set(services)), "duplicate target services")
    for name, ref in images.items():
        require(bool(SLUG.fullmatch(name)) and isinstance(ref, str)
                and bool(IMAGE.fullmatch(ref)), "invalid image digest ref")
        repo_prefix = "ghcr.io/" + repository.lower() + "-" + name + "@sha256:"
        require(ref.startswith(repo_prefix), "image belongs to another tenant")
    for service in services:
        require(isinstance(service, str) and bool(SLUG.fullmatch(service))
                and service not in STATEFUL, "stateful/unsafe service target")
    kinds = payload["backupKinds"]
    require(isinstance(kinds, list) and 1 <= len(kinds) <= 8
            and len(set(kinds)) == len(kinds)
            and all(isinstance(x, str) and SLUG.fullmatch(x) for x in kinds),
            "backup kind policy missing")
    return payload


def verify_backup(proof: dict, payload: dict, root: Path, started: float) -> None:
    require(isinstance(proof, dict), "backup proof absent")
    require(set(proof) == {"projectId", "environment", "sourceSha", "createdAt",
                            "quiescent", "imageRollbackCompatible", "artifacts"},
            "backup proof has missing/unknown fields")
    for key in ("projectId", "environment", "sourceSha"):
        require(proof[key] == payload[key], "backup evidence belongs to another release")
    require(proof["quiescent"] is True, "active jobs were not drained")
    require(proof["imageRollbackCompatible"] is True,
            "image rollback is not proven compatible with the database schema")
    created = proof["createdAt"]
    require(isinstance(created, (int, float)) and
            started - 60 <= created <= time.time() + 30,
            "backup proof is stale or from the future")
    artifacts = proof["artifacts"]
    require(isinstance(artifacts, list) and len(artifacts) == len(payload["backupKinds"]),
            "missing backup artifacts")
    backup_root = (root / "backups").resolve(strict=True)
    seen = set()
    for item in artifacts:
        require(isinstance(item, dict) and
                set(item) == {"kind", "path", "sha256", "bytes"},
                "invalid backup artifact")
        kind = item["kind"]
        require(kind in payload["backupKinds"] and kind not in seen, "unexpected/duplicate backup")
        seen.add(kind)
        file = Path(item["path"])
        require(file.is_absolute() and not file.is_symlink(), "backup path is not a real file")
        file_real = file.resolve(strict=True)
        require(file_real.is_relative_to(backup_root), "backup file escapes tenant backup root")
        require(file.is_file() and file.stat().st_size > 0 and
                file.stat().st_size == item["bytes"], "backup is absent or empty")
        require(isinstance(item["sha256"], str) and bool(DIGEST.fullmatch(item["sha256"]))
                and sha256(file) == item["sha256"], "backup data checksum mismatch")


def validate_previous(previous: dict, payload: dict, compose_digest: str) -> dict:
    require(isinstance(previous, dict) and
            set(previous) == {"schemaVersion", "projectId", "environment",
                              "repository", "sourceSha", "composeChecksum", "images"},
            "no valid rollback baseline on this host")
    for key in ("projectId", "environment", "repository"):
        require(previous[key] == payload[key], "rollback baseline belongs to another tenant")
    require(previous["schemaVersion"] == 1
            and isinstance(previous["sourceSha"], str)
            and bool(SHA.fullmatch(previous["sourceSha"])), "invalid rollback version")
    require(previous["composeChecksum"] == compose_digest,
            "Compose definition changed: image-only rollback is not safe")
    images = previous["images"]
    require(isinstance(images, dict) and set(images) == set(payload["images"]),
            "rollback image set differs")
    for name, ref in images.items():
        require(isinstance(ref, str) and bool(IMAGE.fullmatch(ref))
                and ref.startswith("ghcr.io/" + payload["repository"].lower()
                                   + "-" + name + "@sha256:"),
                "rollback reference is mutable/foreign")
    return images


def compose_args(payload: dict, repo: Path, root: Path, override: Path) -> list[str]:
    return ["docker", "compose", "-p", payload["composeProject"],
            "--env-file", str(root / "runtime.env"),
            "-f", str(safe_child(repo, payload["composePath"])),
            "-f", str(override)]


def write_override(path: Path, payload: dict, images: dict) -> None:
    services = {
        payload["imageServices"][name]: {"image": images[name]}
        for name in sorted(images)
    }
    contents = json.dumps({"services": services}, sort_keys=True, indent=2) + "\n"
    temp = path.with_suffix(".tmp")
    temp.write_text(contents, encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def probe_health(url: str, attempts: int = 24, wait: int = 5) -> bool:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(attempts):
        try:
            with opener.open(url, timeout=4) as response:
                if 200 <= response.status < 300:
                    return True
        except (OSError, ValueError):
            pass
        if attempt + 1 < attempts:
            time.sleep(wait)
    return False


def execute_rollout(payload: dict, base: Path = ROOT) -> dict:
    """Return successful host state; fail closed on missing prerequisites.

    No untrusted shell input is interpolated. Only allowlisted application
    services are touched, never named volumes or stateful dependencies.
    """
    validate_input(payload)
    root = base / payload["projectId"] / payload["environment"]
    require(root.is_dir() and not root.is_symlink()
            and (base / payload["projectId"]).is_dir()
            and not (base / payload["projectId"]).is_symlink()
            and root.resolve() == base.resolve() / payload["projectId"] / payload["environment"],
            "dedicated host root not provisioned")
    repo = root / "repo"
    check_release_checkout(repo, payload["repository"], payload["sourceSha"])
    lock_path = root / ".rollout.lock"
    with lock_path.open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RolloutError("another rollout is already running") from error
        started = time.time()
        runtime_env = root / "runtime.env"
        require(runtime_env.is_file() and not runtime_env.is_symlink(),
                "host runtime environment is missing")
        require((runtime_env.stat().st_mode & 0o077) == 0,
                "host environment file permissions must be 0600")
        dest = safe_child(repo, payload["runtimeEnvTarget"])
        require(dest.parent.is_dir() and not dest.is_symlink(),
                "runtime environment destination must be inside checkout")
        shutil.copyfile(runtime_env, dest)
        os.chmod(dest, 0o600)
        compose = safe_child(repo, payload["composePath"])
        require(compose.is_file(), "Compose file missing")
        checksum = sha256(compose)
        state_path = root / "current-release.json"
        require(state_path.is_file() and not state_path.is_symlink(),
                "first-time deployment requires a separately reviewed bootstrap")
        previous = json_file(state_path)
        rollback_images = validate_previous(previous, payload, checksum)
        backup_path = root / "backups" / payload["sourceSha"] / str(time.time_ns())
        backup_path.mkdir(mode=0o700, parents=True, exist_ok=True)
        require(backup_path.resolve().is_relative_to((root/"backups").resolve()),
                "backup root symlink escape")
        proof_path = backup_path / "proof.json"
        require(not proof_path.exists(), "backup proof path must be fresh for each attempt")
        hook = safe_child(repo, payload["predeployHook"])
        require(hook.is_file(), "required quiescence and backup hook is missing")
        hook_env = {
            **os.environ,
            "APPFACTORY_PROJECT_ID": payload["projectId"],
            "APPFACTORY_ENVIRONMENT": payload["environment"],
            "APPFACTORY_SOURCE_SHA": payload["sourceSha"],
            "APPFACTORY_BACKUP_DIR": str(backup_path),
            "APPFACTORY_BACKUP_PROOF": str(proof_path),
        }
        run(["bash", str(hook)], cwd=repo, env=hook_env)
        require(proof_path.exists(), "predeploy hook did not create backup proof")
        verify_backup(json_file(proof_path), payload, root, started)
        override_dir = root / "overrides"
        override_dir.mkdir(mode=0o700, exist_ok=True)
        next_override = override_dir / ("next-" + payload["sourceSha"] + ".json")
        rollback_override = override_dir / ("rollback-" + payload["sourceSha"] + ".json")
        write_override(next_override, payload, payload["images"])
        write_override(rollback_override, payload, rollback_images)
        command = compose_args(payload, repo, root, next_override)
        old_command = compose_args(payload, repo, root, rollback_override)
        services = sorted(payload["imageServices"].values())
        run(command + ["config", "--quiet"], cwd=repo)
        run(old_command + ["config", "--quiet"], cwd=repo)
        # Preflight pulls and does not alter running containers.
        run(command + ["pull", *services], cwd=repo)
        modified = False
        try:
            modified = True
            run(command + ["up", "-d", "--no-deps", "--no-build", *services], cwd=repo)
            require(probe_health(payload["healthUrl"]), "new release did not pass health check")
        except BaseException as release_error:
            if modified:
                try:
                    run(old_command + ["up", "-d", "--no-deps", "--no-build", *services], cwd=repo)
                    require(probe_health(payload["healthUrl"]), "rollback also failed health check")
                except BaseException as rollback_error:
                    raise RolloutError(
                        "release failed; image rollback failed; manual recovery required; "
                        "database schema was not reverted") from rollback_error
            raise RolloutError(
                "release failed; old images restored; database schema was not reverted"
            ) from release_error
        next_state = {
            "schemaVersion": 1,
            "projectId": payload["projectId"], "environment": payload["environment"],
            "repository": payload["repository"], "sourceSha": payload["sourceSha"],
            "composeChecksum": checksum, "images": payload["images"],
        }
        temp = state_path.with_suffix(".tmp")
        temp.write_text(json.dumps(next_state, sort_keys=True, indent=2)+"\n", encoding="utf-8")
        os.chmod(temp, 0o600)
        os.replace(temp, state_path)
        return next_state


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        state = execute_rollout(payload)
        print(json.dumps({"status": "healthy", "sourceSha": state["sourceSha"]}))
        return 0
    except Exception as error:
        # Do not leak tokens, environment or database credentials in SSM logs.
        print("AppFactory rollout refused/failed: " + type(error).__name__, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
