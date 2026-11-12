#!/usr/bin/env bash
# Prints the section of CHANGELOG.md for one version, without its heading.
# Usage: scripts/changelog-section.sh 0.1.0
set -euo pipefail

version="${1:?Give a version, for example 0.1.0}"
cd "$(dirname "$0")/.."

section="$(awk -v version="$version" '
	/^## \[/ { printing = (index($0, "## [" version "]") == 1); next }
	/^\[[^]]+\]: / { next }
	printing { print }
' CHANGELOG.md)"

if [[ -z "${section//[[:space:]]/}" ]]; then
	echo "CHANGELOG.md has no section for version $version." >&2
	exit 1
fi

printf '%s\n' "$section"
