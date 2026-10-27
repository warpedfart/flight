#!/usr/bin/env bash
# moves the videos in a folder into the theatre's (data/theatre-videos, see
# lib/theatrevideos.js), owned by the user the server runs as, where staff
# can play them at once: no restart. tools/upload-videos.ps1 uploads a
# folder of them to ~/theatre-incoming and runs this; it can be run by hand
# just as well, on videos put anywhere on the machine:
#
#   sudo bash tools/install-theatre-videos.sh <folder> [data folder]
#   sudo bash tools/install-theatre-videos.sh --list [data folder]
#
# --list prints the videos there now, "<file name><tab><bytes>" a line.
#
# to let the user you log in as (ubuntu, say) see, add and delete the
# videos in a file viewer, and nothing else of the data folder, once:
#
#   d=/home/flight/flight/data/theatre-videos
#   sudo setfacl -m u:ubuntu:x /home/flight /home/flight/flight /home/flight/flight/data
#   sudo setfacl -R -m u:ubuntu:rwX,m::rwX "$d"
#   sudo setfacl -d -m u:ubuntu:rwX,u:flight:rwX "$d"
#
# the data folder is AJ_DATA_DIR from /etc/flight.env, else data/ beside
# this script's folder. only MP4 (.mp4, .m4v) and WebM files are taken, and
# only ones that are what their name says. a video's name is its file's,
# made something staff can type in the game (no "%", "/", ":" and so on).
# one already there with the same name and size is not moved again; one
# there with the same name and another size is left where it was, to be
# renamed.
set -euo pipefail

from="${1:?usage: sudo bash tools/install-theatre-videos.sh <folder> [data folder]}"
data="${2:-}"
if [ -z "$data" ] && [ -r /etc/flight.env ]; then
  data="$(sed -n 's/^AJ_DATA_DIR=//p' /etc/flight.env | tail -n 1)"
fi
data="${data:-$(cd "$(dirname "$0")/.." && pwd)/data}"
[ -d "$data" ] || { echo "no data folder at $data (give it as the second argument)" >&2; exit 1; }
dest="$data/theatre-videos"
if [ "$from" = --list ]; then
  [ -d "$dest" ] && find "$dest" -maxdepth 1 -type f ! -name 'new-*' -printf '%f\t%s\n'
  exit 0
fi
[ -d "$from" ] || { echo "no such folder: $from" >&2; exit 1; }

owner="$(stat -c %U "$data")"
# made once; never changed after, which would undo an ACL put on it (below)
[ -d "$dest" ] || install -d -o "$owner" -g "$owner" -m 700 "$dest"

# the same as cleanName in lib/theatrevideos.js
clean() {
  printf '%s' "$1" | tr -d '\000-\037\177%/\\:*?"<>|' | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//' | cut -c1-60 | sed 's/ $//'
}

moved=0 kept=0 skipped=0
shopt -s nullglob nocaseglob
for file in "$from"/*.mp4 "$from"/*.m4v "$from"/*.webm; do
  [ -f "$file" ] || continue
  base="$(basename "$file")"
  ext="$(printf '%s' "${base##*.}" | tr '[:upper:]' '[:lower:]')"
  name="$(clean "${base%.*}")"
  # what the first bytes say it is: "ftyp" at 4 for MP4, the EBML mark for WebM
  head="$(head -c 12 "$file" | od -An -tx1 | tr -d ' \n')"
  if { [ "$ext" = webm ] && [ "${head:0:8}" != 1a45dfa3 ]; } || { [ "$ext" != webm ] && [ "${head:8:8}" != 66747970 ]; }; then
    echo "not a video the game can play, left where it is: $base"
    skipped=$((skipped + 1))
    continue
  fi
  if [ -z "$name" ]; then
    echo "no usable name, left where it is: $base"
    skipped=$((skipped + 1))
    continue
  fi
  target="$dest/$name.$ext"
  if [ -e "$target" ]; then
    if [ "$(stat -c %s "$target")" = "$(stat -c %s "$file")" ]; then
      echo "already there: $name"
      rm -f -- "$file"
      kept=$((kept + 1))
    else
      echo "another video is called \"$name\" already; rename this one and run again: $base"
      skipped=$((skipped + 1))
    fi
    continue
  fi
  # in under a name the server passes over ("new-"), then its own: no one
  # plays half a file that is still being moved from another disk
  waiting="$dest/new-$$-$moved.$ext"
  mv -- "$file" "$waiting"
  chown "$owner:$owner" "$waiting"
  chmod 640 "$waiting"
  mv -- "$waiting" "$target"
  echo "added: $name"
  moved=$((moved + 1))
done

echo "$moved added, $kept already there, $skipped left out (in $dest)"
