#!/usr/bin/env bash
# Builds the playground image and shows that Docker reports it as `healthy`, as
# `unhealthy` when its PostgreSQL server is stopped, and as `healthy` again when
# the server is back. Needs Docker with the compose plugin.
set -euo pipefail

cd "$(dirname "$0")/../playground"
export COMPOSE_PROJECT_NAME="layerbase-health-$$"

cleanup() { docker compose down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true; }
trap cleanup EXIT

status() { docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)"; }

wait_for() {
	local wanted="$1" seconds="${2:-90}" current=""
	for ((i = 0; i < seconds; i++)); do
		current="$(status)"
		if [[ "$current" == "$wanted" ]]; then
			echo "ok: the app container is $wanted"
			return 0
		fi
		sleep 1
	done
	echo "FAILED: expected $wanted, but the app container is $current" >&2
	docker compose logs app >&2
	return 1
}

docker compose up --build --detach --quiet-pull
wait_for healthy

echo "Stopping PostgreSQL..."
docker compose stop postgres >/dev/null
wait_for unhealthy

echo "Starting PostgreSQL again..."
docker compose start postgres >/dev/null
wait_for healthy
