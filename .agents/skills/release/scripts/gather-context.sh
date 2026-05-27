#!/usr/bin/env bash
set -euo pipefail

echo "=== RELEASE CONTEXT ==="
echo "branch: $(git branch --show-current)"
echo "latest_tags:"
git --no-pager tag --sort=-v:refname | head -3
echo "commits_since_last_tag:"
git --no-pager log "$(git describe --tags --abbrev=0 2>/dev/null || 'HEAD')..HEAD" --oneline --no-decorate
echo "=== END ==="
