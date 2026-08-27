#!/bin/sh
# POSIX installer. Copies this tree outside node_modules and puts `steward` on PATH.
# Does not use npm.
set -eu

REPO="joshuaboys/steward"
REF="${STEWARD_REF:-main}"
PREFIX="${PREFIX:-${HOME}/.local}"

usage() {
  cat <<'EOF'
Install steward onto PREFIX/bin (default: ~/.local/bin). Requires Node 22.12+.
Does not use npm.

  ./install.sh
  ./install.sh --prefix ~/.local
  ./install.sh --uninstall

  curl -fsSL https://raw.githubusercontent.com/joshuaboys/steward/main/install.sh | sh
  Windows: irm https://raw.githubusercontent.com/joshuaboys/steward/main/install.ps1 | iex
EOF
}

is_tree() {
  [ -f "$1/bin/steward.mjs" ] && [ -f "$1/src/steward/cli/main.ts" ] && [ -f "$1/wrangler.jsonc" ]
}

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "steward needs Node 22.12 or later (node not found on PATH)." >&2
    exit 1
  fi
  ver=$(node -v 2>/dev/null || true)
  ver=${ver#v}
  major=${ver%%.*}
  rest=${ver#*.}
  minor=${rest%%.*}
  case $major in
    ''|*[!0-9]*) echo "steward needs Node 22.12 or later (found ${ver:-unknown})." >&2; exit 1 ;;
  esac
  case $minor in
    ''|*[!0-9]*) minor=0 ;;
  esac
  if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; }; then
    echo "steward needs Node 22.12 or later (found ${ver})." >&2
    exit 1
  fi
}

FETCH_TMP=

fetch_tree() {
  tmp=${TMPDIR:-/tmp}/steward-src-$$
  FETCH_TMP=$tmp
  mkdir -p "$tmp"
  url="https://github.com/${REPO}/archive/${REF}.tar.gz"
  archive="$tmp/src.tgz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$archive" "$url"
  else
    echo "install.sh needs curl or wget to download steward." >&2
    exit 1
  fi
  mkdir -p "$tmp/src"
  tar -xzf "$archive" -C "$tmp/src"
  src=
  for d in "$tmp/src"/*; do
    [ -d "$d" ] || continue
    src=$d
    break
  done
  if [ -z "$src" ] || ! is_tree "$src"; then
    echo "downloaded archive from $url was not a steward tree." >&2
    exit 1
  fi
  SRC=$src
}

resolve_src() {
  if [ -n "${STEWARD_SRC:-}" ]; then
    if is_tree "$STEWARD_SRC"; then
      SRC=$STEWARD_SRC
      return
    fi
    echo "STEWARD_SRC is not a steward tree: $STEWARD_SRC" >&2
    exit 1
  fi
  script=$0
  case $script in
    /*) ;;
    *) script=$(pwd)/$script ;;
  esac
  dir=$(dirname "$script")
  if [ -f "$script" ] && is_tree "$dir"; then
    SRC=$(CDPATH= cd "$dir" && pwd)
    return
  fi
  fetch_tree
}

UNINSTALL=0
PREFIX_FLAG=
while [ $# -gt 0 ]; do
  case $1 in
    -h|--help)
      usage
      exit 0
      ;;
    --uninstall)
      UNINSTALL=1
      ;;
    --prefix)
      [ $# -ge 2 ] || { echo "--prefix needs a directory" >&2; exit 1; }
      PREFIX_FLAG=$2
      shift
      ;;
    --prefix=*)
      PREFIX_FLAG=${1#--prefix=}
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ -n "$PREFIX_FLAG" ]; then
  PREFIX=$PREFIX_FLAG
fi

LIB=${STEWARD_LIB:-${PREFIX}/lib/steward}
BIN_DIR=${PREFIX}/bin
BIN=${BIN_DIR}/steward

if [ "$UNINSTALL" -eq 1 ]; then
  rm -rf "$LIB"
  rm -f "$BIN" "$BIN_DIR/steward.cmd"
  echo "removed $LIB and wrappers in $BIN_DIR"
  exit 0
fi

need_node
resolve_src
set +e
node "$SRC/scripts/install.mjs" --prefix "$PREFIX"
code=$?
set -e
if [ -n "$FETCH_TMP" ]; then
  rm -rf "$FETCH_TMP"
fi
exit $code
