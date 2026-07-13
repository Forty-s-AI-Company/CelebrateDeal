#!/usr/bin/env bash
# Run the standard local checks from WSL with the same Node.js major as CI.
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

# Prefer the user's native WSL NVM installation when it is available. This
# prevents a Windows Node.js executable later in PATH from being selected.
nvm_dir="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$nvm_dir/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$nvm_dir/nvm.sh"
  nvm use --silent
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 與 npm 必須先在 WSL 安裝；請依 .nvmrc 使用 Node.js 22。" >&2
  exit 1
fi

node_path="$(readlink -f "$(command -v node)")"
case "$node_path" in
  /mnt/*)
    echo "目前選到 Windows Node.js：$node_path。請使用 WSL 原生 Node.js 22。" >&2
    exit 1
    ;;
esac

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "本機驗證需要 Node.js 22（目前為 $(node --version)），以符合 CI。" >&2
  exit 1
fi

# tsx must not create its IPC socket under a Windows-mounted temporary path.
# WSL may inherit either /mnt/c/... or a literal C:\\... / C:/... value.
if [[ -z "${TMPDIR:-}" || "$TMPDIR" == /mnt/* || "$TMPDIR" =~ ^[A-Za-z]:[\\/].* ]]; then
  export TMPDIR=/tmp
fi

if [[ ! -x node_modules/.bin/eslint ]]; then
  echo "找不到本機相依套件；請先執行 npm ci。" >&2
  exit 1
fi

# Unit tests require encryption keys, but local validation must not depend on
# a real secret. These are non-production defaults and are not persisted.
export JOB_SECRET="${JOB_SECRET:-ci-job-secret-123456}"
export CSRF_SECRET="${CSRF_SECRET:-ci-csrf-secret-123456}"

npm run lint
npm run typecheck
npm run test
npm run build
