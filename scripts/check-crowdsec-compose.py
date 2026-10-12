"""Check merged deployment config and the built port manager's real Compose argv.

Run after building ingressi-l4-port-manager-crowdsec:local. The test container
has no network or Docker socket; a shell function replaces Docker calls. Only
the host's `docker compose config` is used, never `up` or volume deletion.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
MANAGER_IMAGE = "ingressi-l4-port-manager-crowdsec:local"
BASE = "docker-compose.yml"
ARGUS = "docker-compose.argus.yml"
CROWDSEC = "docker-compose.crowdsec.yml"
ENV = dict(os.environ)
for key in list(ENV):
    if key.startswith(("COMPOSE_", "CROWDSEC_", "ARGUS_")):
        del ENV[key]
ENV.update(
    ADMIN_USERNAME="ci-admin",
    ADMIN_PASSWORD="ci-only-password",
    SESSION_SECRET="ci-only-session-secret-not-for-deployment",
    CLICKHOUSE_PASSWORD="ci-only-clickhouse",
    CROWDSEC_API_KEY="ci-only-bouncer-key",
    CROWDSEC_POSTGRES_PASSWORD="ci-only-database-password",
    HOSTNAME="crowdsec-check",
)


def run(args, env=ENV):
    return subprocess.check_output(args, cwd=ROOT, env=env, text=True)


def compose(files, env_file, extra_env):
    args = ["docker", "compose", "--env-file", str(env_file), "-p", "crowdsec-check"]
    for file in files:
        args.extend(["-f", file])
    return json.loads(run(args + ["config", "--format", "json"], ENV | extra_env))


def recreated_files(manager_env, fixture_dir):
    # Source the functions from the entrypoint baked into the built image,
    # stopping before its startup/poll loop. Exercise do_apply, with Docker
    # intercepted so it only records argv and simulates a failed recreation.
    shell = r'''
set -e
mkdir -p /tmp/crowdsec-check
sed '/^# Startup: always apply/,$d' /entrypoint.sh > /tmp/functions.sh
. /tmp/functions.sh
detect_project_name() { printf '%s\n' crowdsec-check; }
docker() { printf '%s\n' "$@" > /tmp/crowdsec-check/args; return 1; }
do_apply > /dev/null
cat /tmp/crowdsec-check/args
'''
    args = [
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "sh",
        "--mount", f"type=bind,source={fixture_dir},target=/compose,readonly",
        "-e", "COMPOSE_DIR=/compose", "-e", "DATA_DIR=/tmp/crowdsec-check",
    ]
    for key in ("COMPOSE_EXTRA_FILE", "COMPOSE_EXTRA_FILES"):
        if manager_env.get(key):
            args.extend(["-e", f"{key}={manager_env[key]}"])
    argv = run(args + [MANAGER_IMAGE, "-c", shell]).splitlines()
    return [Path(argv[i + 1]).name for i, arg in enumerate(argv) if arg == "-f"]


def main():
    with tempfile.TemporaryDirectory(prefix="crowdsec-compose-check-") as temp:
        fixture_dir = Path(temp)
        env_file = fixture_dir / "empty.env"
        env_file.write_text("", encoding="utf-8")
        # Argus exists even in the CrowdSec-only test, just as in a real checkout.
        for name in (BASE, ARGUS, CROWDSEC):
            (fixture_dir / name).write_text("services: {}\n", encoding="utf-8")
        cases = [
            ("CrowdSec only", [BASE, CROWDSEC], {}),
            ("Argus + CrowdSec", [BASE, ARGUS, CROWDSEC], {}),
            ("explicit overlay list", [BASE, ARGUS, CROWDSEC], {
                "COMPOSE_EXTRA_FILES": f"/compose/{ARGUS}:/compose/{CROWDSEC}",
            }),
        ]
        for label, files, extra_env in cases:
            config = compose(files, env_file, extra_env)
            services = config["services"]
            engine = services["crowdsec"]
            database = services["crowdsec-postgres"]
            assert engine["environment"]["CROWDSEC_POSTGRES_PASSWORD"] == database["environment"]["POSTGRES_PASSWORD"] == ENV["CROWDSEC_POSTGRES_PASSWORD"]
            assert not engine.get("ports") and not database.get("ports")
            assert engine["environment"]["BOUNCER_KEY_ingressi"] == services["caddy"]["environment"]["CROWDSEC_API_KEY"] == ENV["CROWDSEC_API_KEY"]
            manager = services["l4-port-manager"]
            assert manager["image"] == MANAGER_IMAGE
            assert manager["build"]["dockerfile"] == "docker/l4-port-manager/Dockerfile"
            recreated = recreated_files(manager["environment"], fixture_dir)
            assert recreated == files, (label, recreated, files)
            after = compose(recreated, env_file, extra_env)
            assert after["services"]["caddy"] == services["caddy"], label
            assert any(v["target"] == "/run/argus" for v in services["caddy"]["volumes"]) == (ARGUS in files)
            print(f"PASS: {label} (credentials, image, real recreate order and Caddy config)")


if __name__ == "__main__":
    main()
