#!/usr/bin/env bash
# setup.sh: 新しいコンテナ（Dev Container / Codespaces / Codex cloud / Claude Code on the web）の初期化
#
# 使い方: bash system/scripts/setup.sh [--quiet]
#   --quiet  進捗ログを .cache/setup.log に回し、問題点と診断結果だけを表示する（SessionStart フック用）
#   OS パッケージ（poppler-utils）は root かパスワードなし sudo のときだけ apt-get で入れる
#
# 何度実行しても安全（冪等）。途中の手順が失敗しても警告して続行し、
# 最後に npm run doctor の結果（致命的な問題があれば 1）を終了コードとして返す。
set -euo pipefail

usage() {
  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

QUIET=0
for arg in "$@"; do
  case "$arg" in
    -q | --quiet) QUIET=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "[setup] 不明な引数です: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd -- "$ROOT"

LOG_FILE="$ROOT/.cache/setup.log"
if [ "$QUIET" -eq 1 ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  : >"$LOG_FILE"
fi
# 非対話で実行するため、git の認証プロンプトで止まらないようにする
export GIT_TERMINAL_PROMPT=0

log() {
  if [ "$QUIET" -eq 0 ]; then echo "[setup] $*"; fi
}

warn() {
  echo "[setup] 警告: $*"
}

# timeout コマンドがあれば制限時間付きで実行する（run 経由で呼ぶ）
# shellcheck disable=SC2329
with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

# run <説明> <コマンド...>: 失敗しても止めず、終了コードを返す
# --quiet のときは出力をログファイルへ回し、失敗時だけ末尾を表示する
run() {
  local desc="$1"
  shift
  log "$desc"
  local status=0
  if [ "$QUIET" -eq 1 ]; then
    {
      echo "=== $(date '+%Y-%m-%d %H:%M:%S') $desc"
      echo "\$ $*"
    } >>"$LOG_FILE"
    "$@" >>"$LOG_FILE" 2>&1 || status=$?
    if [ "$status" -ne 0 ]; then
      echo "[setup] 失敗: $desc（終了コード $status）。ログ末尾（$LOG_FILE）:"
      tail -n 15 "$LOG_FILE" | sed 's/^/    /'
    fi
  else
    "$@" || status=$?
  fi
  return "$status"
}

# ---------- 0. 前提 ----------

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[setup] エラー: node / npm が見つかりません。Node.js 22 をインストールしてください（.nvmrc 参照）"
  exit 1
fi
log "リポジトリ: $ROOT（Node.js $(node -v)）"

# ---------- 1. Git LFS ----------

# git が使えるリポジトリか確認する（Dev Container の所有者不一致は safe.directory で解消）
git_repo_ready() {
  command -v git >/dev/null 2>&1 || return 1
  local err
  if err="$(git -C "$ROOT" rev-parse --is-inside-work-tree 2>&1 >/dev/null)"; then
    return 0
  fi
  if grep -q 'dubious ownership' <<<"$err"; then
    log "git の safe.directory に $ROOT を追加します"
    git config --global --add safe.directory "$ROOT" || true
    git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 && return 0
  fi
  return 1
}

if ! git_repo_ready; then
  warn "git が使えないか Git リポジトリではないため、Git LFS の設定をスキップします"
elif ! git lfs version >/dev/null 2>&1; then
  warn "git-lfs が見つかりません。参考資料の PNG/PDF がポインタのままになります（例: sudo apt-get install -y git-lfs）"
else
  run "Git LFS を有効化（git lfs install --local）" git -C "$ROOT" lfs install --local ||
    warn "git lfs install --local に失敗しました（既存の Git フックと競合している可能性があります）"

  # 実体が未取得（ポインタのまま）のファイルがあるときだけ取得する
  lfs_list="$(git -C "$ROOT" lfs ls-files 2>/dev/null || echo '? - (ls-files failed)')"
  if grep -q ' - ' <<<"$lfs_list"; then
    run "LFS ファイルを取得（git lfs pull）" with_timeout 600 git -C "$ROOT" lfs pull ||
      warn "git lfs pull に失敗しました。ネットワークや権限を確認し、後で git lfs pull を再実行してください"
  else
    log "LFS: 未取得のファイルはありません"
  fi
fi

# ---------- 2. npm 依存パッケージ ----------

install_reason=""
if [ ! -d node_modules ]; then
  install_reason="node_modules がありません"
elif [ ! -f node_modules/.package-lock.json ]; then
  install_reason="node_modules が不完全です"
elif [ package-lock.json -nt node_modules/.package-lock.json ]; then
  install_reason="package-lock.json が更新されています"
elif ! node -e "require('playwright'); require('sharp')" >/dev/null 2>&1; then
  install_reason="依存パッケージを読み込めません（別 OS 向けの node_modules の可能性）"
fi

if [ -n "$install_reason" ]; then
  run "依存パッケージをインストール（npm ci: $install_reason）" npm ci --no-audit --no-fund --no-update-notifier ||
    warn "npm ci に失敗しました。ネットワークを確認して bash system/scripts/setup.sh を再実行してください"
else
  log "依存パッケージ: 最新です（npm ci をスキップ）"
fi

# ---------- 3. Playwright Chromium ----------

# Chromium を実際に起動して確認する（失敗理由は chromium_error に入る）
chromium_error=""
chromium_launches() {
  chromium_error="$(node -e "
    require('playwright').chromium.launch({ timeout: 60000 })
      .then((b) => b.close())
      .then(() => process.exit(0), (e) => { console.error(String((e && e.message) || e).split('\n')[0]); process.exit(1); });
  " 2>&1 >/dev/null)"
}

if chromium_launches; then
  log "Playwright Chromium: 起動できます"
elif [ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" = "1" ]; then
  warn "Chromium を起動できませんが、PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 のためインストールをスキップします（$chromium_error）"
else
  log "Chromium を起動できません: $chromium_error"
  run "Playwright Chromium をインストール（npx playwright install chromium）" npx --no playwright install chromium ||
    warn "npx playwright install chromium に失敗しました"

  # 共有ライブラリ不足の場合: root かパスワードなし sudo が使えるときだけ OS 依存を入れる
  if ! chromium_launches && command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      run "Chromium の OS 依存をインストール（playwright install-deps）" npx --no playwright install-deps chromium ||
        warn "playwright install-deps に失敗しました"
    elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      run "Chromium の OS 依存をインストール（sudo playwright install-deps）" \
        sudo -n env "PATH=$PATH" npx --no playwright install-deps chromium ||
        warn "playwright install-deps に失敗しました"
    fi
  fi
fi

# ---------- 4. OS パッケージ（poppler-utils） ----------

# pdfinfo / pdftoppm は ref:ingest の PDF 取り込みと npm run check（テスト）に必要。
# Dev Container のイメージには入っているが、Codex cloud などのコンテナにはないことがある。
# root かパスワードなし sudo が使えるときだけ apt-get で入れる（失敗しても続行し、doctor が NG として報告する）
if command -v pdfinfo >/dev/null 2>&1 && command -v pdftoppm >/dev/null 2>&1; then
  log "poppler-utils: インストール済み"
elif ! command -v apt-get >/dev/null 2>&1; then
  warn "pdfinfo / pdftoppm が見つかりません。poppler（poppler-utils）をインストールしてください"
elif [ "$(id -u)" -eq 0 ] || { command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; }; then
  # root ならそのまま、そうでなければパスワードなし sudo で、制限時間付きで実行する（外部コマンドのみ）
  # shellcheck disable=SC2329
  as_root() {
    local cmd=("$@")
    if command -v timeout >/dev/null 2>&1; then cmd=(timeout 300 "${cmd[@]}"); fi
    if [ "$(id -u)" -eq 0 ]; then "${cmd[@]}"; else sudo -n "${cmd[@]}"; fi
  }
  run "poppler-utils をインストール（apt-get update）" as_root env DEBIAN_FRONTEND=noninteractive apt-get update -q ||
    warn "apt-get update に失敗しました"
  run "poppler-utils をインストール（apt-get install）" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends poppler-utils ||
    warn "poppler-utils のインストールに失敗しました（sudo apt-get install -y poppler-utils を手動で実行してください）"
else
  warn "pdfinfo / pdftoppm が見つかりません。root 権限がないため自動で入れられません（sudo apt-get install -y poppler-utils）"
fi

# ---------- 5. 環境診断 ----------

log "環境診断（npm run doctor）"
doctor_status=0
if [ "$QUIET" -eq 1 ]; then
  npm run --silent doctor -- --quiet || doctor_status=$?
else
  echo
  npm run --silent doctor || doctor_status=$?
  echo
fi

if [ "$doctor_status" -ne 0 ]; then
  echo "[setup] 致命的な問題があります。上の「対処」を実行してから bash system/scripts/setup.sh を再実行してください"
else
  log "完了（${SECONDS} 秒）。プレビュー: npm run dev ／ 検証: npm run check"
fi
exit "$doctor_status"
