#!/usr/bin/env python3
"""Run real HA lifecycle tests in a disposable official Core Docker container.

No production server, credentials, config directory or Docker socket is mounted.
Use --upgrade-from to test replacing an existing integration with this release.
Without that option this tests fresh install and re-installation of this package.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, capture=False):
    return subprocess.run(["docker", *map(str, args)], check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="2026.11.2", choices=("2026.11.0", "2026.11.2"))
    parser.add_argument("--upgrade-from", type=Path, help="Previous custom_components/ha_wartung folder; never its .storage")
    parser.add_argument("--port", type=int, default=18767)
    parser.add_argument("--keep", action="store_true", help="Keep disposable container/config for a local browser check")
    args = parser.parse_args()
    config = Path(tempfile.mkdtemp(prefix="wartungs-manager-ha-test-"))
    component = config / "custom_components" / "ha_wartung"
    initial = args.upgrade_from or ROOT / "custom_components" / "ha_wartung"
    if not (initial / "manifest.json").is_file():
        parser.error("--upgrade-from must name the previous custom_components/ha_wartung directory")
    shutil.copytree(initial, component, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (config / "configuration.yaml").write_text("""homeassistant:
  name: Release validation
  latitude: 0
  longitude: 0
  elevation: 0
  unit_system: metric
  time_zone: UTC
  country: GB
  currency: GBP
  language: en
http:
frontend:
config:
api:
websocket_api:
input_number:
logger:
  default: warning
""")
    name = "wartungs-manager-release-test-" + args.version.replace(".", "") + "-" + uuid.uuid4().hex[:6]
    image = "ghcr.io/home-assistant/home-assistant:" + args.version
    print("Testing real Home Assistant " + args.version + " in " + name, flush=True)
    started = False
    try:
        # Core runs as root on Linux. Keep bytecode out of the host-owned
        # component directory so replacing it also works on GitHub runners.
        docker("run", "--detach", "--name", name, "--env", "PYTHONDONTWRITEBYTECODE=1",
               "--publish", f"127.0.0.1:{args.port}:8123",
               "--volume", f"{config}:/config", "--volume", f"{ROOT / 'scripts'}:/qa:ro", image)
        started = True
        def probe(phase):
            docker("exec", name, "python", "/qa/ha_lifecycle_probe.py", phase)
        probe("bootstrap")
        probe("reload")
        docker("stop", "--timeout", "30", name)
        # Replacing the component directory mirrors a Marketplace update. Storage
        # lives outside the integration directory and is not copied or modified.
        shutil.rmtree(component)
        shutil.copytree(ROOT / "custom_components" / "ha_wartung", component,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        docker("start", name)
        probe("package-update" if args.upgrade_from else "restart")
        probe("preferences")
        probe("reload")
        probe("reinstall")
        print("PASS: complete HA lifecycle matrix member " + args.version, flush=True)
        if args.keep:
            print(f"Local-only browser check: http://127.0.0.1:{args.port}/wartung", flush=True)
            print("Disposable credentials are in " + str(config / "release-test-state.json"), flush=True)
            print("Stop and remove the container with: docker rm -f " + name, flush=True)
    except Exception:
        if started:
            print(docker("logs", "--tail", "100", name, capture=True), flush=True)
        raise
    finally:
        if not args.keep:
            if started:
                subprocess.run(["docker", "rm", "--force", name], check=False, stdout=subprocess.DEVNULL)
            shutil.rmtree(config, ignore_errors=True)


if __name__ == "__main__":
    main()
