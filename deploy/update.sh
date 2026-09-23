#!/bin/sh
# Deploy or update an On-call release in an existing Podman deployment run by
# the user systemd unit (deploy/systemd). Guide: docs/wdrozenie/aktualizacja.md.
#
#   curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh | sh -s -- 1.2.3
#   sh deploy/update.sh [--dir DIR] [VERSION]
#   sh deploy/update.sh merge-env CURRENT EXAMPLE [VERSION]
#
# Without VERSION it takes the newest stable release. DIR defaults to
# $ONCALL_DIR, then ~/oncall. In order, it:
#   1. checks the directory, .env, podman and the installed oncall.service,
#   2. fetches that release's Compose files, .env.example and deploy/systemd
#      (git fetch + checkout of the tag when DIR is a git checkout); a release
#      older than deploy/systemd leaves the host's copy in place,
#   3. merges .env with the release's .env.example (see merge_env) and sets
#      ONCALL_VERSION, the only value it ever changes,
#   4. pulls both application images, so a missing release stops here with
#      nothing changed and the restart does not wait for a download,
#   5. backs up every file it is about to replace into DIR/.backup/<time>/,
#      installs the files and the new .env,
#   6. refreshes the installed unit file if the release changed it, then
#      restarts oncall.service.
# It never touches the drop-in (WorkingDirectory, ONCALL_COMPOSE_FILES), tls/
# or volumes. Run again with the same version, it rewrites no file and only
# restarts the unit.
#
# Plain POSIX sh so that `curl ... | sh` works on any host shell. Everything
# runs from main at the last line: a truncated download executes nothing.

set -eu

repo=lowicz/oncall
images="ghcr.io/lowicz/oncall-api ghcr.io/lowicz/oncall-web"
unit=oncall.service
# The files a deployment directory takes from a release when it is not a git
# checkout. .env and tls/ are the host's own and are never in this list.
# Releases before deploy/systemd existed lack unit_files; the host keeps its own.
release_files="docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml .env.example"
unit_files="deploy/systemd/oncall.service deploy/systemd/oncall-stack.sh deploy/systemd/install-user-unit.sh"
kept_header="# Kept from the previous .env: not in .env.example."
assignment_re='^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*='

stage=""
tmp_env=""

usage() {
  cat <<'EOF'
usage: update.sh [--dir DIR] [VERSION]
       update.sh merge-env CURRENT EXAMPLE [VERSION]

Deploys or updates On-call in DIR (default $ONCALL_DIR, then ~/oncall), the
directory the user unit oncall.service runs, and restarts that unit.
VERSION is a release such as 1.2.3 or 1.3.0-rc.1; without it, the newest
stable release. Piped: curl -fsSL .../deploy/update.sh | sh -s -- 1.2.3

merge-env prints CURRENT merged with EXAMPLE (and ONCALL_VERSION set to
VERSION, if given) and changes nothing.
EOF
}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$stage" ]; then
    rm -rf "$stage"
  fi
  if [ -n "$tmp_env" ]; then
    rm -f "$tmp_env"
  fi
}

need_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "$cmd not found; install it and run again"
  done
}

# Prints CURRENT (an existing .env) rebuilt on EXAMPLE (a release's
# .env.example): the example's lines and comments in the example's order, with
# every key CURRENT assigns carrying CURRENT's own line(s) verbatim. A key the
# example only shows commented out (`# KEY=...`) takes that line's place. Keys
# the example does not have follow at the end with the comment lines right
# above them, under kept_header. A key assigned twice keeps both lines. A
# quoted value spanning several lines is one assignment. With VERSION, the
# ONCALL_VERSION line becomes ONCALL_VERSION=VERSION.
merge_env() {
  awk -v set_version="${3:-}" -v kept_header="$kept_header" '
    function closes(s, q,    i, c) {
      if (q == "\047") return index(s, q) > 0
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "\\") i++
        else if (c == q) return 1
      }
      return 0
    }
    function parse(line,    s, v, q) {
      gkey = ""
      gopen = ""
      if (line !~ /^[ \t]*(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=/) return 0
      s = line
      sub(/^[ \t]*/, "", s)
      if (s ~ /^export[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*=/) sub(/^export[ \t]+/, "", s)
      gkey = s
      sub(/[ \t]*=.*$/, "", gkey)
      v = s
      sub(/^[^=]*=[ \t]*/, "", v)
      q = substr(v, 1, 1)
      if ((q == "\"" || q == "\047") && !closes(substr(v, 2), q)) gopen = q
      return 1
    }
    function placeholder(line,    s) {
      if (line !~ /^# ?(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=/) return ""
      s = line
      sub(/^# ?/, "", s)
      sub(/^export[ \t]+/, "", s)
      sub(/=.*$/, "", s)
      return s
    }
    {
      f = (FILENAME == ARGV[1]) ? "a" : "b"
      if (f != lastf) {
        open = ""
        lastf = f
      }
      if (open != "") {
        text[f, cnt[f]] = text[f, cnt[f]] "\n" $0
        if (closes($0, open)) open = ""
        next
      }
      n = ++cnt[f]
      text[f, n] = $0
      if (parse($0)) {
        type[f, n] = "A"
        key[f, n] = gkey
        open = gopen
      } else if ($0 ~ /^[ \t]*#/) type[f, n] = "C"
      else if ($0 ~ /^[ \t]*$/) type[f, n] = "B"
      else type[f, n] = "O"
    }
    END {
      for (i = 1; i <= cnt["a"]; i++) {
        if (type["a", i] != "A") continue
        k = key["a", i]
        if (k in cur) cur[k] = cur[k] "\n" text["a", i]
        else {
          cur[k] = text["a", i]
          first[k] = i
        }
      }
      if (set_version != "") cur["ONCALL_VERSION"] = "ONCALL_VERSION=" set_version
      for (i = 1; i <= cnt["b"]; i++)
        if (type["b", i] == "A") in_example[key["b", i]] = 1

      for (i = 1; i <= cnt["b"]; i++) {
        t = type["b", i]
        if (t == "A") {
          k = key["b", i]
          if (!(k in cur)) print text["b", i]
          else if (!(k in placed)) {
            print cur[k]
            placed[k] = 1
          }
          continue
        }
        if (t == "C") {
          k = placeholder(text["b", i])
          if (k != "" && !(k in in_example) && (k in cur) && !(k in placed)) {
            print cur[k]
            placed[k] = 1
            continue
          }
        }
        print text["b", i]
      }

      started = 0
      comments = ""
      for (i = 1; i <= cnt["a"]; i++) {
        t = type["a", i]
        if (t == "C") {
          if (text["a", i] != kept_header)
            comments = (comments == "") ? text["a", i] : comments "\n" text["a", i]
          continue
        }
        if (t == "B") {
          comments = ""
          continue
        }
        if (t == "A") {
          k = key["a", i]
          if ((k in placed) || first[k] != i) {
            comments = ""
            continue
          }
          out = cur[k]
          placed[k] = 1
        } else out = text["a", i]
        if (!started) {
          print ""
          print kept_header
          started = 1
        }
        if (comments != "") print comments
        print out
        comments = ""
      }
      if (set_version != "" && !("ONCALL_VERSION" in placed)) {
        if (!started) {
          print ""
          print kept_header
        }
        print cur["ONCALL_VERSION"]
      }
    }
  ' "$1" "$2"
}

# The assignment lines of a .env, sorted, without ONCALL_VERSION.
assignments() {
  grep -E "$assignment_re" "$1" | grep -Ev '^[[:space:]]*(export[[:space:]]+)?ONCALL_VERSION[[:space:]]*=' |
    LC_ALL=C sort || true
}

# The keys a .env assigns, sorted and unique.
env_keys() {
  grep -E "$assignment_re" "$1" |
    sed -e 's/^[[:space:]]*//' -e 's/^export[[:space:]][[:space:]]*//' -e 's/[[:space:]]*=.*$//' |
    LC_ALL=C sort -u || true
}

latest_version() {
  latest_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") ||
    die "cannot reach https://github.com/$repo/releases/latest; name the version: ... | sh -s -- 1.2.3"
  case $latest_url in
    */releases/tag/v*) say "${latest_url##*/releases/tag/v}" ;;
    *) die "no stable release is published yet; name the version, e.g. ... | sh -s -- 1.0.0-rc.1" ;;
  esac
}

# Copies SRC over DEST through a temporary file in DEST's directory, keeping
# DEST's mode when it exists (else MODE), so DEST is never half written.
replace_file() {
  replace_tmp="$3.new.$$"
  if [ -e "$3" ]; then
    cp -p "$3" "$replace_tmp"
    cat "$2" >"$replace_tmp"
  else
    mkdir -p "$(dirname "$3")"
    cp "$2" "$replace_tmp"
    chmod "$1" "$replace_tmp"
  fi
  mv -f "$replace_tmp" "$3"
}

backup() {
  mkdir -p "$(dirname "$backup_dir/$1")"
  cp -p "$dir/$1" "$backup_dir/$1"
}

main() {
  if [ "${1:-}" = merge-env ]; then
    if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
      usage >&2
      exit 2
    fi
    [ -f "$2" ] || die "no such file: $2"
    [ -f "$3" ] || die "no such file: $3"
    merge_env "$2" "$3" "${4:-}"
    return
  fi

  dir=${ONCALL_DIR:-${HOME:-}/oncall}
  version=""
  while [ "$#" -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        return
        ;;
      --dir)
        [ "$#" -ge 2 ] || die "--dir needs a directory"
        dir=$2
        shift
        ;;
      --dir=*) dir=${1#--dir=} ;;
      -*) die "unknown option $1 (see --help)" ;;
      *)
        [ -z "$version" ] || die "one version only (see --help)"
        version=$1
        ;;
    esac
    shift
  done

  [ "$(id -u)" -ne 0 ] || die "run as the deployment user whose systemd --user runs $unit, not root"
  need_cmd awk sed grep sort comm cmp cp mv mkdir rmdir mktemp date dirname tail tr curl podman systemctl
  [ -d "$dir" ] || die "$dir does not exist; pass the deployment directory with --dir"
  dir=$(cd "$dir" && pwd -P)
  for file in .env docker-compose.yml deploy/systemd/oncall-stack.sh; do
    [ -f "$dir/$file" ] || die "$dir/$file is missing; is $dir the deployment directory?"
  done

  if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
    XDG_RUNTIME_DIR=/run/user/$(id -u)
    export XDG_RUNTIME_DIR
  fi
  systemctl --user show-environment >/dev/null 2>&1 ||
    die "cannot reach the systemd user manager; log in as the deployment user (ssh or machinectl shell USER@), not with su or sudo"
  [ "$(systemctl --user show -p LoadState --value "$unit")" = loaded ] ||
    die "$unit is not installed for $(id -un); install it first: $dir/deploy/systemd/install-user-unit.sh $dir (docs/wdrozenie/systemd.md)"
  unit_dir=$(systemctl --user show -p WorkingDirectory --value "$unit")
  if [ -d "$unit_dir" ]; then
    unit_dir=$(cd "$unit_dir" && pwd -P)
  fi
  [ "$unit_dir" = "$dir" ] ||
    die "$unit runs ${unit_dir:-no directory}, not $dir; pass that directory with --dir"

  if [ -z "$version" ]; then
    version=$(latest_version)
  fi
  version=${version#v}
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ||
    die "not a release version: $version (expected e.g. 1.2.3 or 1.3.0-rc.1)"
  tag=v$version
  current=$(sed -n 's/^[[:space:]]*ONCALL_VERSION[[:space:]]*=[[:space:]]*//p' "$dir/.env" | tail -n 1)
  say "On-call in $dir: ${current:-no version} -> $version"

  trap cleanup EXIT
  trap 'exit 130' HUP INT TERM
  stage=$(mktemp -d)
  git_checkout=false
  if [ -e "$dir/.git" ]; then
    need_cmd git
    git_checkout=true
    say "Fetching $tag (git checkout)"
    git -C "$dir" fetch --quiet --force --tags origin || die "git fetch from origin failed in $dir"
    git -C "$dir" rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null ||
      die "release $version not found: no tag $tag in origin"
    git -C "$dir" cat-file -e "$tag:deploy/systemd/oncall-stack.sh" 2>/dev/null ||
      die "$tag has no deploy/systemd, which $unit runs; a git checkout cannot go back before it"
    git -C "$dir" show "$tag:.env.example" >"$stage/.env.example"
  else
    say "Downloading the files of $tag"
    fetched=""
    for file in $release_files $unit_files; do
      mkdir -p "$stage/$(dirname "$file")"
      case " $unit_files " in
        *" $file "*) curl_flags=-fsL ;;
        *) curl_flags=-fsSL ;;
      esac
      if curl "$curl_flags" -o "$stage/$file" "https://raw.githubusercontent.com/$repo/$tag/$file"; then
        fetched="$fetched $file"
        continue
      else
        curl_status=$?
      fi
      case " $unit_files " in
        *" $file "*)
          [ "$curl_status" -eq 22 ] || die "cannot download $file of $tag"
          say "$tag has no $file; keeping the local one"
          ;;
        *) die "cannot download $file of $tag; is $version a published release?" ;;
      esac
    done
  fi

  merge_env "$dir/.env" "$stage/.env.example" "$version" >"$stage/env"
  assignments "$dir/.env" >"$stage/before"
  assignments "$stage/env" >"$stage/after"
  lost=$(LC_ALL=C comm -23 "$stage/before" "$stage/after" | sed -e 's/[[:space:]]*=.*$//' -e 's/^[[:space:]]*//' | sort -u)
  [ -z "$lost" ] || die "refusing to write .env: the merge would change $(printf '%s' "$lost" | tr '\n' ' ')(nothing was changed)"

  for image in $images; do
    say "Pulling $image:$version"
    podman pull --quiet "$image:$version" >/dev/null ||
      die "cannot pull $image:$version; nothing was changed"
  done

  stamp=$(date +%Y%m%d-%H%M%S)
  backup_dir=$dir/.backup/$stamp
  mkdir -p "$dir/.backup"
  if ! mkdir -m 700 "$backup_dir" 2>/dev/null; then
    backup_dir=$backup_dir-$$
    mkdir -m 700 "$backup_dir"
  fi

  if [ "$git_checkout" = true ]; then
    git -C "$dir" checkout --quiet --detach "$tag" ||
      die "git checkout $tag failed in $dir (local changes to tracked files?); .env is unchanged"
  else
    for file in $fetched; do
      if [ -f "$dir/$file" ] && cmp -s "$stage/$file" "$dir/$file"; then
        continue
      fi
      if [ -f "$dir/$file" ]; then
        backup "$file"
      fi
      case $file in
        *.sh) mode=755 ;;
        *) mode=644 ;;
      esac
      replace_file "$mode" "$stage/$file" "$dir/$file"
      say "Updated $file"
    done
  fi

  if cmp -s "$stage/env" "$dir/.env"; then
    say ".env is up to date"
  else
    backup .env
    tmp_env=$dir/.env.new.$$
    cp -p "$dir/.env" "$tmp_env"
    cat "$stage/env" >"$tmp_env"
    env_keys "$dir/.env" >"$stage/keys-before"
    env_keys "$tmp_env" >"$stage/keys-after"
    env_keys "$stage/.env.example" >"$stage/keys-example"
    mv -f "$tmp_env" "$dir/.env"
    tmp_env=""
    say "Updated .env (previous copy: $backup_dir/.env)"
    for key in $(LC_ALL=C comm -13 "$stage/keys-before" "$stage/keys-after"); do
      say "  added $key with the release default"
    done
    for key in $(LC_ALL=C comm -23 "$stage/keys-before" "$stage/keys-example"); do
      say "  kept $key, which .env.example no longer has"
    done
  fi

  unit_file=$(systemctl --user show -p FragmentPath --value "$unit")
  if [ -n "$unit_file" ] && ! cmp -s "$dir/deploy/systemd/oncall.service" "$unit_file"; then
    mkdir -p "$backup_dir/unit"
    cp -p "$unit_file" "$backup_dir/unit/$unit"
    replace_file 644 "$dir/deploy/systemd/oncall.service" "$unit_file"
    systemctl --user daemon-reload
    say "Updated $unit_file"
  fi

  if rmdir "$backup_dir" 2>/dev/null; then
    say "Nothing to back up"
  else
    say "Backup: $backup_dir"
  fi

  say "Restarting $unit"
  systemctl --user restart "$unit" ||
    die "$unit did not start; see journalctl --user -u $unit. To roll back, run this script with the previous version ($current)"
  say "On-call $version is running:"
  podman ps --format 'table {{.Names}} {{.Image}} {{.Status}}'
}

main "$@" </dev/null
