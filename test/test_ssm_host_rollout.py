import importlib.util
from pathlib import Path
import hashlib
import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1] / "scripts" / "deployment" / "ssm-host-rollout.py"
spec=importlib.util.spec_from_file_location("appfactory_host_rollout",SCRIPT)
host=importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

SHA="a"*40
OLD_SHA="b"*40
DIGEST="sha256:"+"1"*64
OLD_DIGEST="sha256:"+"2"*64
REPOSITORY="EagleFox31/Pr-cis-Translation"
IMAGE="ghcr.io/eaglefox31/pr-cis-translation-api"

def payload():
    return {
        "schemaVersion":1,"projectId":"precis-translation",
        "environment":"staging","repository":REPOSITORY,"sourceSha":SHA,
        "composeProject":"precis-translation-staging",
        "composePath":"docker-compose.yml",
        "runtimeEnvTarget":"backend/.env",
        "predeployHook":"scripts/backup.sh",
        "healthUrl":"http://127.0.0.1/health",
        "images":{"api":IMAGE+"@"+DIGEST},
        "imageServices":{"api":"backend"},
        "backupKinds":["database","documents"]
    }

class HostRolloutTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="appfactory-host-test-")
        self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        self.root=self.base/"precis-translation"/"staging"
        self.repo=self.root/"repo"
        self.repo.mkdir(parents=True)
        (self.repo/".git").mkdir()
        (self.repo/"backend").mkdir()
        (self.repo/"scripts").mkdir()
        (self.repo/"scripts"/"backup.sh").write_text("#!/bin/bash\n")
        (self.repo/"docker-compose.yml").write_text("services:\n  backend:\n    image: demo\n")
        self.digest=host.sha256(self.repo/"docker-compose.yml")
        (self.root/"runtime.env").write_text("DUMMY=ok\n")
        (self.root/"runtime.env").chmod(0o600)
        previous={
            "schemaVersion":1,"projectId":"precis-translation","environment":"staging",
            "repository":REPOSITORY,"sourceSha":OLD_SHA,
            "composeChecksum":self.digest,"images":{"api":IMAGE+"@"+OLD_DIGEST}
        }
        (self.root/"current-release.json").write_text(json.dumps(previous))
        self.previous=previous
        self.calls=[]
        self.fail_health=False
        self.corrupt_backup=False
        self.fail_new_up=False

    def fake_capture(self,args,cwd=None):
        if args[1:4] == ["remote","get-url","origin"]:
            return "https://github.com/"+REPOSITORY+".git"
        if args[1:4] == ["rev-parse","HEAD"]:
            return SHA
        raise AssertionError(args)

    def fake_run(self,args,cwd=None,env=None):
        self.calls.append(args)
        if args[0]=="bash":
            folder=Path(env["APPFACTORY_BACKUP_DIR"])
            folder.mkdir(parents=True,exist_ok=True)
            files=[]
            for kind in ("database","documents"):
                name=folder/(kind+".backup")
                name.write_bytes(("mocked-"+kind).encode())
                files.append({"kind":kind,"path":str(name),"sha256":host.sha256(name),
                              "bytes":name.stat().st_size})
            if self.corrupt_backup: files[0]["sha256"]="sha256:"+"f"*64
            proof={k:payload()[k] for k in ("projectId","environment","sourceSha")}
            proof.update({"createdAt":time.time(),"quiescent":True,
                          "imageRollbackCompatible":True,"artifacts":files})
            Path(env["APPFACTORY_BACKUP_PROOF"]).write_text(json.dumps(proof))
        if self.fail_new_up and args[0:2]==["docker","compose"] and "up" in args:
            if any("next-" in part for part in args):
                raise host.RolloutError("new release failed")

    def launch(self):
        with patch.object(host,"run",side_effect=self.fake_run), \
             patch.object(host,"capture",side_effect=self.fake_capture), \
             patch.object(host,"probe_health",return_value=not self.fail_health):
            return host.execute_rollout(payload(),base=self.base)

    def test_success_replaces_only_app_backend_and_saves_previous_baseline(self):
        state=self.launch()
        self.assertEqual(state["sourceSha"],SHA)
        self.assertEqual(json.loads((self.root/"current-release.json").read_text())["images"],
                         {"api":IMAGE+"@"+DIGEST})
        commands=[cmd for cmd in self.calls if cmd[0:2]==["docker","compose"]]
        for cmd in commands:
            self.assertNotIn("db",cmd)
            self.assertNotIn("down",cmd)
            self.assertNotIn("-v",cmd)
        self.assertTrue(any("pull" in cmd for cmd in commands))
        self.assertTrue(any("up" in cmd and "--no-deps" in cmd and
                            "--no-build" in cmd for cmd in commands))

    def test_failed_release_rolls_back_unchanged_compose_image(self):
        self.fail_new_up=True
        with self.assertRaisesRegex(host.RolloutError,"old images restored"):
            self.launch()
        self.assertEqual(json.loads((self.root/"current-release.json").read_text()),
                         self.previous)
        self.assertTrue(any("rollback-" in " ".join(cmd) and "up" in cmd for cmd in self.calls))

    def test_bad_backup_hash_aborts_before_any_docker_compose_mutation(self):
        self.corrupt_backup=True
        with self.assertRaisesRegex(host.RolloutError,"checksum mismatch"):
            self.launch()
        self.assertFalse(any(cmd[0:2]==["docker","compose"] for cmd in self.calls))

    def test_missing_rollback_baseline_aborts_before_hook(self):
        (self.root/"current-release.json").unlink()
        with self.assertRaisesRegex(host.RolloutError,"separately reviewed bootstrap"):
            self.launch()
        self.assertFalse(any(cmd[0]=="bash" for cmd in self.calls))

    def test_prior_compose_hash_change_fails_before_any_new_images(self):
        (self.repo/"docker-compose.yml").write_text("services:\n  different:\n    image: demo\n")
        with self.assertRaisesRegex(host.RolloutError,"Compose definition changed"):
            self.launch()
        self.assertFalse(any(cmd[0]=="bash" for cmd in self.calls))

    def test_rejects_foreign_and_mutable_refs_and_shell_attack(self):
        for change in (
            lambda p: p["images"].update(api=IMAGE+":latest"),
            lambda p: p["images"].update(api="ghcr.io/eaglefox31/atelier2026-api@"+DIGEST),
            lambda p: p["imageServices"].update(api="db"),
            lambda p: p.update(healthUrl="http://malicious.example/health"),
            lambda p: p.update(composePath="../../secret"),
            lambda p: p.update(runtimeEnvTarget="backend/../../secret"),
            lambda p: p.update(repository="EagleFox31/atelier2026")
        ):
            item=payload()
            change(item)
            with self.assertRaises(host.RolloutError):
                host.validate_input(item)

if __name__=="__main__":
    unittest.main()
