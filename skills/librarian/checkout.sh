#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: checkout.sh <repo> [options]

Ensure a cached checkout exists at:
  ~/.cache/checkouts/<host>/<org>/<repo>

Examples:
  checkout.sh mitsuhiko/minijinja
  checkout.sh github.com/mitsuhiko/minijinja
  checkout.sh https://github.com/mitsuhiko/minijinja
  checkout.sh git@github.com:mitsuhiko/minijinja.git

Options:
  --path-only                 Print only the checkout path.
  --force-update              Always fetch from origin and attempt fast-forward.
  --update-interval <secs>    Minimum seconds between updates (default: 300).

Environment:
  LIBRARIAN_CACHE_ROOT        Override cache root (default: ~/.cache/checkouts)
  LIBRARIAN_DEFAULT_HOST      Host for owner/repo shorthand (default: github.com)
  LIBRARIAN_UPDATE_INTERVAL   Default update interval in seconds
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

repo_input=""
path_only=0
force_update=0
update_interval="${LIBRARIAN_UPDATE_INTERVAL:-300}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path-only)
      path_only=1
      shift
      ;;
    --force-update)
      force_update=1
      shift
      ;;
    --update-interval)
      if [[ $# -lt 2 ]]; then
        echo "error: --update-interval expects a value" >&2
        exit 2
      fi
      update_interval="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$repo_input" ]]; then
        repo_input="$1"
      else
        echo "error: unexpected argument: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$repo_input" ]]; then
  echo "error: repository is required" >&2
  exit 2
fi

if ! [[ "$update_interval" =~ ^[0-9]+$ ]]; then
  echo "error: update interval must be a non-negative integer" >&2
  exit 2
fi

trim_repo_input() {
  local s="$1"
  # Trim leading/trailing whitespace.
  s="${s#${s%%[![:space:]]*}}"
  s="${s%${s##*[![:space:]]}}"
  printf '%s' "$s"
}

parse_repo() {
  local input host path first rest origin_url
  input="$(trim_repo_input "$1")"

  # Strip query/fragment for URL-like inputs.
  input="${input%%\?*}"
  input="${input%%#*}"

  case "$input" in
    git@*:* )
      host="${input#git@}"
      host="${host%%:*}"
      path="${input#*:}"
      origin_url="$input"
      ;;
    ssh://* )
      rest="${input#ssh://}"
      host="${rest%%/*}"
      host="${host#*@}"
      path="${rest#*/}"
      origin_url="$input"
      ;;
    http://*|https://* )
      rest="${input#*://}"
      host="${rest%%/*}"
      path="${rest#*/}"
      ;;
    */* )
      first="${input%%/*}"
      if [[ "$first" == *.* || "$first" == localhost ]]; then
        host="$first"
        path="${input#*/}"
      else
        host="${LIBRARIAN_DEFAULT_HOST:-github.com}"
        path="$input"
      fi
      ;;
    * )
      echo "error: unsupported repository format: $input" >&2
      return 1
      ;;
  esac

  host="${host#*@}"
  path="${path#/}"
  path="${path%/}"

  # For GitHub-like deep links, use owner/repo only.
  IFS='/' read -r -a parts <<< "$path"
  if [[ ${#parts[@]} -ge 3 ]]; then
    case "${parts[2]}" in
      tree|blob|pull|issues|commit|actions|releases|compare|wiki)
        path="${parts[0]}/${parts[1]}"
        ;;
    esac
  fi

  # Strip optional .git suffix.
  path="${path%.git}"

  IFS='/' read -r -a parts <<< "$path"
  if [[ ${#parts[@]} -lt 2 ]]; then
    echo "error: repository path must contain at least org/repo: $path" >&2
    return 1
  fi

  local last_index=$(( ${#parts[@]} - 1 ))
  local repo="${parts[$last_index]}"
  local org_parts=("${parts[@]:0:$last_index}")
  local org
  org="$(IFS='/'; echo "${org_parts[*]}")"

  if [[ -z "$host" || -z "$org" || -z "$repo" ]]; then
    echo "error: failed to parse repository: $input" >&2
    return 1
  fi

  if [[ ! "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$ ]]; then
    echo "error: unsafe repository authority: ${host:-<empty>}" >&2
    return 1
  fi
  if [[ "$host" == *:* ]]; then
    local port="${host##*:}"
    if (( port < 1 || port > 65535 )); then
      echo "error: unsafe repository authority: $host" >&2
      return 1
    fi
  fi

  local component
  for component in "${parts[@]}"; do
    if [[ "$component" == "." || "$component" == ".." || ! "$component" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
      echo "error: unsafe repository component: ${component:-<empty>}" >&2
      return 1
    fi
  done

  if [[ -n "${origin_url:-}" ]]; then
    origin_url="${origin_url%/}"
    origin_url="${origin_url%.git}.git"
  else
    origin_url="https://$host/$org/$repo.git"
  fi

  printf '%s\n%s\n%s\n%s\n' "$host" "$org" "$repo" "$origin_url"
}

parsed="$(parse_repo "$repo_input")" || exit 2
old_ifs="$IFS"
IFS=$'\n'
set -f
set -- $parsed
set +f
IFS="$old_ifs"
if [[ $# -ne 4 ]]; then
  exit 2
fi
parsed_host="$1"
parsed_org="$2"
parsed_repo="$3"
origin_url="$4"

host="$parsed_host"
org="$parsed_org"
repo="$parsed_repo"

cache_root="${LIBRARIAN_CACHE_ROOT:-$HOME/.cache/checkouts}"
checkout_path="$cache_root/$host/$org/$repo"

IFS='/' read -r -a checkout_org_parts <<< "$org"
candidate="$cache_root"
if [[ -L "$candidate" ]]; then
  echo "error: symlink is not allowed in checkout path: $candidate" >&2
  exit 2
fi
for component in "$host" "${checkout_org_parts[@]}" "$repo"; do
  candidate="$candidate/$component"
  if [[ -L "$candidate" ]]; then
    echo "error: symlink is not allowed in checkout path: $candidate" >&2
    exit 2
  fi
done

mkdir -p "$(dirname "$checkout_path")"

if [[ ! -d "$checkout_path/.git" ]]; then
  git clone --filter=blob:none "$origin_url" "$checkout_path" >/dev/null
  clone_state="cloned"
else
  clone_state="existing"
fi

if [[ ! -d "$checkout_path/.git" ]]; then
  echo "error: checkout path is not a git repository: $checkout_path" >&2
  exit 3
fi

if ! git -C "$checkout_path" remote get-url origin >/dev/null 2>&1; then
  git -C "$checkout_path" remote add origin "$origin_url"
fi

# If remote URL changed (e.g. host shorthand), normalize to canonical HTTPS URL.
current_origin="$(git -C "$checkout_path" remote get-url origin 2>/dev/null || true)"
if [[ "$current_origin" != "$origin_url" ]]; then
  git -C "$checkout_path" remote set-url origin "$origin_url"
fi

last_fetch_file="$checkout_path/.git/librarian-last-fetch"
now_epoch="$(date +%s)"
needs_update=1

if [[ -f "$last_fetch_file" && "$force_update" -eq 0 ]]; then
  last_epoch="$(cat "$last_fetch_file" 2>/dev/null || echo 0)"
  if [[ "$last_epoch" =~ ^[0-9]+$ ]]; then
    age=$(( now_epoch - last_epoch ))
    if (( age < update_interval )); then
      needs_update=0
    fi
  fi
fi

update_state="skipped"
ff_state="not-attempted"

if (( needs_update == 1 )); then
  git -C "$checkout_path" fetch --prune --tags origin >/dev/null
  echo "$now_epoch" > "$last_fetch_file"
  update_state="fetched"

  branch="$(git -C "$checkout_path" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  upstream="$(git -C "$checkout_path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  dirty="$(git -C "$checkout_path" status --porcelain --untracked-files=no)"

  if [[ -n "$branch" && -n "$upstream" && -z "$dirty" ]]; then
    if git -C "$checkout_path" merge --ff-only "$upstream" >/dev/null 2>&1; then
      ff_state="fast-forwarded"
    else
      ff_state="skipped-non-ff"
    fi
  elif [[ -n "$dirty" ]]; then
    ff_state="skipped-dirty"
  else
    ff_state="skipped-no-upstream"
  fi
fi

if (( path_only == 1 )); then
  printf '%s\n' "$checkout_path"
  exit 0
fi

cat <<EOF
repo: $host/$org/$repo
path: $checkout_path
state: $clone_state
update: $update_state
fast_forward: $ff_state
EOF
