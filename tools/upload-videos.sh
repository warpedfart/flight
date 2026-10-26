#!/usr/bin/env bash
# tools/upload-videos.ps1 for Linux: uploads every video in a folder on this
# computer to the theatre's folder on the VPS (data/theatre-videos, see
# lib/theatrevideos.js), where staff can play them at once: no restart. it
# goes through ssh and rsync, to a host ssh can log in to with a key (a
# Host in ~/.ssh/config, or user@address).
#
#   bash tools/upload-videos.sh <folder> <ssh host> [--recurse] [--server /home/flight/flight]
#
# --recurse takes the videos in the folder's folders too, all into the one
# theatre folder. --server is where the server's repository is on the VPS.
#
# the videos go to ~/theatre-upload on the VPS, then
# tools/install-theatre-videos.sh (run there with sudo) moves them in,
# owned by the server's user. rsync keeps a file it is still sending under
# ~/theatre-upload/.partial and goes on from there next time, so only
# whole files are moved in, and after a dropped connection the same
# command picks up where it stopped. a video already there (the same name
# and size) is not sent again. only .mp4, .m4v and .webm files are taken;
# a video's name is its file's.
set -euo pipefail

usage() {
  echo "usage: bash tools/upload-videos.sh <folder> <ssh host> [--recurse] [--server /home/flight/flight]" >&2
  exit 1
}
folder="" host="" recurse=0 server=/home/flight/flight
while [ $# -gt 0 ]; do
  case "$1" in
    --recurse) recurse=1 ;;
    --server) server="${2:?}"; shift ;;
    -*) usage ;;
    *) if [ -z "$folder" ]; then folder="$1"; elif [ -z "$host" ]; then host="$1"; else usage; fi ;;
  esac
  shift
done
[ -n "$folder" ] && [ -n "$host" ] || usage
[ -d "$folder" ] || { echo "no such folder: $folder" >&2; exit 1; }
for tool in ssh rsync; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed (sudo pacman -S openssh rsync)" >&2; exit 1; }
done
folder="$(cd "$folder" && pwd)"

# the same as cleanName in lib/theatrevideos.js
clean() {
  printf '%s' "$1" | tr -d '\000-\037\177%/\\:*?"<>|' | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//' | cut -c1-60 | sed 's/ $//'
}

depth=(-maxdepth 1)
[ "$recurse" = 1 ] && depth=()
mapfile -d '' files < <(find "$folder" "${depth[@]}" -type f \( -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.webm' \) -print0 | sort -z)
if [ "${#files[@]}" -eq 0 ]; then
  echo "No .mp4, .m4v or .webm files in $folder"
  exit 1
fi

echo "Asking the VPS what it has already..."
listing="$(ssh "$host" "sudo bash '$server/tools/install-theatre-videos.sh' --list")" || {
  echo "ssh could not run the install script on the VPS. Is the server's repository at $server and up to date (git pull)?" >&2
  exit 1
}
declare -A installed=() chosen=()
while IFS=$'\t' read -r name size; do
  [ -n "$name" ] && installed["$name"]="$size"
done <<< "$listing"

send=() total=0
for file in "${files[@]}"; do
  base="$(basename "$file")"
  ext="$(printf '%s' "${base##*.}" | tr '[:upper:]' '[:lower:]')"
  name="$(clean "${base%.*}")"
  remote="$name.$ext"
  size="$(stat -c %s "$file")"
  if [ -z "$name" ]; then
    echo "skipped, no usable name: $file"
  elif [ -n "${chosen[$remote]:-}" ]; then
    echo "skipped, another file here is also called \"$name\": $file"
  elif [ "${installed[$remote]:-}" = "$size" ]; then
    echo "already on the VPS: $name"
  elif [ -n "${installed[$remote]:-}" ]; then
    echo "skipped, the VPS has another video called \"$name\" (rename one of them): $file"
  else
    chosen["$remote"]=1
    send+=("${file#"$folder"/}")
    total=$((total + size))
  fi
done

if [ "${#send[@]}" -eq 0 ]; then
  echo "Nothing to upload."
  exit 0
fi
echo "${#send[@]} to upload, $((total / 1048576)) MB in all"
# the names, not the folders they are in: all go to the one folder there
printf '%s\0' "${send[@]}" | rsync --from0 --files-from=- --no-relative --times --partial-dir=.partial \
  --human-readable --progress -e ssh "$folder/" "$host:theatre-upload/" || {
  echo "The upload stopped. Run the same command again: it goes on from where it was." >&2
  exit 1
}

echo "Moving them into the theatre's folder..."
ssh "$host" "sudo bash '$server/tools/install-theatre-videos.sh' ~/theatre-upload"
echo "Done. Staff can play them now: type a video's name in the theatre's box, or use the staff panel's Theatre page."
