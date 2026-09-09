#!/usr/bin/env bash
# Rewrites the deployed commit sha across every job spec in this directory.
#
# The cluster's Nomad does not support HCL2 variables, so each spec carries the
# image tag literally. Editing fourteen sites by hand is how a deployment ends
# up half on one build and half on another, so this does all of them at once
# and shows what changed.
#
#   ./operations/stamp-sha.sh                      # tip of origin/master
#   ./operations/stamp-sha.sh <full-40-char-sha>   # a specific build
#
# CI publishes an image per commit as `sha-<full sha>`, so the sha you stamp
# must be one whose workflow ran and passed. Nothing here checks that; the
# check is in operations/MANUAL-DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."

sha="${1:-$(git rev-parse origin/master)}"

if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "not a full 40-character sha: $sha" >&2
  echo "CI tags images by full sha, so an abbreviated one selects no image." >&2
  exit 1
fi

# Both forms: the image tag, and the bare sha the frontend reports on the page.
sed -i -E \
  -e "s|(ghcr\.io/memetic-block/[a-z-]+:sha-)[0-9a-f]{40}|\1${sha}|g" \
  -e "s|(COMMIT_SHA    = \")[0-9a-f]{40}(\")|\1${sha}\2|g" \
  operations/*.hcl

echo "stamped ${sha}"
git --no-pager diff --stat -- operations/
