#!/usr/bin/env bash
# Turn the operator's source media into the exact files upload-staging-media.mjs expects.
#
# WHY THIS EXISTS. The sources are 4K stills and UHD video — 307 MB in total, two of the clips
# alone over the 50 MiB `file_size_limit` on post-media / moments / story-segments. Uploading
# them raw would be rejected by the bucket, and the ones that squeezed under would make every
# scroll on a phone decode a 24-megapixel JPEG. So this is a precondition, not an optimisation.
#
# Sources are READ-ONLY: everything lands in derived/, which is throwaway. Both directories sit
# under docs/, which is gitignored, so no binary ever reaches the repo.
#
#   ./supabase/staging-seed/transcode-media.sh
#
# Idempotent: an output that already exists is skipped. Delete derived/ to force a rebuild.
#
# THE CONTENT MAP LIVES HERE, in the three tables below, and nowhere else. The upload script
# reads filenames; the seed computes storage keys. Neither of them knows which photograph is
# which — that judgement is recorded once, right here, in a form a human can check against the
# personas in seed-staging.sql.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/docs/test-stories"
OUT="$SRC/derived"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

mkdir -p "$OUT"

# Cover-crop rather than letterbox: a story is edge-to-edge, so bars would be visible chrome.
STORY_VF="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
# 1080x1350 matches the width/height the seed already writes for moments — changing one without
# the other would render a correctly-sized image inside a wrongly-shaped reserved box.
CARD_VF="scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350"
AVATAR_VF="scale=512:512:force_original_aspect_ratio=increase,crop=512:512"

img() { # img <src-relative> <out-name> <filter>
  local in="$SRC/$1" out="$OUT/$2"
  [ -f "$in" ] || { echo "MISSING SOURCE: $1" >&2; exit 1; }
  [ -f "$out" ] && { echo "  skip $2"; return; }
  ffmpeg -nostdin -loglevel error -y -i "$in" -vf "$3" -q:v 3 "$out"
  echo "  ok   $2 ($(du -h "$out" | cut -f1))"
}

vid() { # vid <src-relative> <out-name>
  local in="$SRC/$1" out="$OUT/$2"
  [ -f "$in" ] || { echo "MISSING SOURCE: $1" >&2; exit 1; }
  [ -f "$out" ] && { echo "  skip $2"; return; }
  # -map 0:a:0? — several of these clips are silent; a hard audio map would abort on those.
  # yuv420p + faststart because AVFoundation will not play 4:2:2, and the moov atom has to be
  # at the front or the player buffers the whole file before the first frame.
  ffmpeg -nostdin -loglevel error -y -i "$in" \
    -map 0:v:0 -map 0:a:0\? \
    -vf "$STORY_VF" \
    -c:v libx264 -profile:v high -crf 23 -preset slow -pix_fmt yuv420p \
    -c:a aac -b:a 128k -movflags +faststart "$out"
  echo "  ok   $2 ($(du -h "$out" | cut -f1))"
}

poster() { # poster <src-relative> <out-name> — first frame, moment-card shape
  local in="$SRC/$1" out="$OUT/$2"
  [ -f "$out" ] && { echo "  skip $2"; return; }
  ffmpeg -nostdin -loglevel error -y -ss 0 -i "$in" -frames:v 1 -vf "$CARD_VF" -q:v 3 "$out"
  echo "  ok   $2 ($(du -h "$out" | cut -f1))"
}

# ── Stories — 9 segments across 8 handles, 4 of them video ────────────────────────────────
# dario_legno is the multi-segment rail (photo then video), so the viewer's segment advance and
# the photo→video transition both get walked. marta_ceramica's is the pinned one, so it is the
# single segment that survives past expires_at — deliberately a video, because a pinned video is
# the longest-lived thing in the rail and therefore the one a QA pass will always find.
echo "stories"
img test-images/pexels-tima-miroshnichenko-6790751.jpg          story__dario_legno__1.jpg    "$STORY_VF"
img test-images/pexels-cole-yap-2149136300-32809021.jpg         story__tino_chef__1.jpg      "$STORY_VF"
img test-images/pexels-i-sra-nilgun-ozkan-1937384707-28885977.jpg story__bea_foto__1.jpg     "$STORY_VF"
img test-images/pexels-marian-sol-miranda-32246321-14224708.jpg  story__ele_yoga__1.jpg      "$STORY_VF"
img test-images/pexels-chris-tombrella-25433381-6749092.jpg      story__vera_erbe__1.jpg     "$STORY_VF"
vid test-videos/14966302_1080_1920_30fps.mp4                     story__marta_ceramica__1.mp4
vid test-videos/8538236-uhd_1440_2514_30fps.mp4                  story__dario_legno__2.mp4
vid test-videos/6813908-uhd_2160_3744_30fps.mp4                  story__gio_musica__1.mp4
vid test-videos/12909803-uhd_2160_3840_24fps.mp4                 story__sole_designer__1.mp4

# ── Moments — 5, one of them video (which is what exercises thumb_path) ───────────────────
# beyzaa is an elderly watch repairer at a market stall and rocco_film's bio is "documentari
# corti su mestieri che stanno sparendo" over the caption «Ottantasei anni.» — the closest match
# in the whole set. gio-spigo is someone planting a field by hand, which is what tino_chef means
# by "produttori che facciano le cose come si facevano".
echo "moments"
img test-images/pexels-beyzaa-yurtkuran-279977530-16216124.jpg   moment__rocco_film.jpg       "$CARD_VF"
img test-images/pexels-gio-spigo-276311867-28102054.jpg          moment__tino_chef.jpg        "$CARD_VF"
# Borrowed, not matched: the set contains no ceramics and no design-studio photograph, so
# sole_designer's «Le chiavi.» gets a landscape and dario_legno's «Tiene.» re-crops his own
# story source. Visible only if you view one person's story and moment back to back.
img test-images/pexels-jenny-uhling-2262740-4017166.jpg          moment__sole_designer.jpg    "$CARD_VF"
img test-images/pexels-tima-miroshnichenko-6790751.jpg          moment__dario_legno.jpg      "$CARD_VF"
vid test-videos/8513117-uhd_2160_3840_30fps.mp4                  moment__marta_ceramica.mp4
poster test-videos/8513117-uhd_2160_3840_30fps.mp4               moment__marta_ceramica__thumb.jpg

# ── Post media — 4 posts gain an image, so the feed is not twelve text cards ──────────────
# bea_foto's seeded post is «La merceria di via Sant'Agnese chiude a dicembre. Fotografata
# ieri.» and the i-sra photograph is an elderly tailor at a sewing machine: the best caption
# match in the set, worth reusing at a different crop. The other three re-crop a story source
# for the same reason — nine images cannot cover fourteen slots.
echo "post media"
img test-images/pexels-i-sra-nilgun-ozkan-1937384707-28885977.jpg post__bea_foto__0.jpg       "$CARD_VF"
img test-images/pexels-marian-sol-miranda-32246321-14224708.jpg   post__ele_yoga__0.jpg       "$CARD_VF"
img test-images/pexels-chris-tombrella-25433381-6749092.jpg       post__vera_erbe__0.jpg      "$CARD_VF"
img test-images/pexels-quang-nguyen-vinh-222549-2178175.jpg       post__nina_poeta__0.jpg     "$CARD_VF"

# ── Candidacy videos — the three seeded candidates, longest clips ─────────────────────────
echo "candidacy videos"
vid test-videos/7297870-hd_1080_1920_30fps.mp4                    candidacy__rocco_film.mp4
vid test-videos/7438229-uhd_2160_4096_25fps.mp4                   candidacy__marta_ceramica.mp4
vid test-videos/5385957-uhd_2160_4096_25fps.mp4                   candidacy__ele_yoga.mp4

# ── Avatars — 8 portraits onto the first 8 handles in seed order ──────────────────────────
# The portraits are generic stock, so the assignment is deterministic (sorted filename onto seed
# order) rather than inferred from the photographs. The four handles left without one —
# sara_startup, dario_legno, nina_poeta, bea_foto — keep their initials, which is the point:
# name and photo are optional (#75), so both render paths need to exist in the seeded world.
echo "avatars"
img test-profile/pexels-alejandro-larrondo-torres-2160576738-36826200.jpg avatar__sole_designer.jpg  "$AVATAR_VF"
img test-profile/pexels-alialsajad-15393590.jpg                          avatar__luna_dev.jpg       "$AVATAR_VF"
img test-profile/pexels-alwyn-dias-175407065-26692090.jpg                avatar__marta_ceramica.jpg "$AVATAR_VF"
img test-profile/pexels-helen-ray-319601696-15572175.jpg                 avatar__gio_musica.jpg     "$AVATAR_VF"
img test-profile/pexels-julia-iskova-2148948682-31132403.jpg             avatar__ele_yoga.jpg       "$AVATAR_VF"
img test-profile/pexels-marcos-felipe-177641462-13331367.jpg             avatar__tino_chef.jpg      "$AVATAR_VF"
img test-profile/pexels-pexels-user-25433892-6748783.jpg                 avatar__vera_erbe.jpg      "$AVATAR_VF"
img test-profile/pexels-rohanmuzafar-10837349.jpg                        avatar__rocco_film.jpg     "$AVATAR_VF"

# ── Bucket caps, asserted rather than assumed ─────────────────────────────────────────────
# 50 MiB on post-media / moments / story-segments; 5 MiB on avatars. Fail here, loudly, rather
# than let the operator discover it as a 413 partway through an upload run.
echo
fail=0
while IFS= read -r f; do
  bytes=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  case "$(basename "$f")" in
    avatar__*) cap=5242880 ;;
    *)         cap=52428800 ;;
  esac
  if [ "$bytes" -gt "$cap" ]; then
    echo "OVER BUCKET CAP: $(basename "$f") is $bytes B, cap $cap B" >&2
    fail=1
  fi
done < <(find "$OUT" -type f \( -name '*.jpg' -o -name '*.mp4' \))
[ "$fail" -eq 0 ] || exit 1

echo "derived: $(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1)"
