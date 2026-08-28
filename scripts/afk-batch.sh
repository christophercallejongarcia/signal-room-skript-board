#!/usr/bin/env bash
#
# Run a list of tickets through /implement, one after another, unattended.
#
# Sequential on purpose. Most of these tickets edit components/signal-room.tsx,
# so running them in parallel would only produce merge conflicts. Each ticket
# gets its own claude process, which is how /implement wants it: fresh context
# per ticket, nothing carried over from the last one.
#
#   scripts/afk-batch.sh                 # the default batch: 18 19 21 22 06 20 23 13 14
#   scripts/afk-batch.sh 10 12           # only these
#   scripts/afk-batch.sh --dry-run       # print the plan, change nothing
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

ISSUES=".scratch/signal-room-instagram/issues"
STAMP="$(date +%Y%m%d-%H%M)"
BRANCH="afk/batch-$STAMP"
LOGDIR=".scratch/afk-logs/$STAMP"
# 18 unblocks 20, and 21+22 unblock 24 (which stays out: ready-for-human).
# The rest follows the README order, cheapest-first.
DEFAULT_BATCH=(18 19 21 22 06 20 23 13 14)
DRY_RUN=0

args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) args+=("$arg") ;;
  esac
done
if [ ${#args[@]} -gt 0 ]; then BATCH=("${args[@]}"); else BATCH=("${DEFAULT_BATCH[@]}"); fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!!  %s\033[0m\n' "$*" >&2; exit 1; }

# --- preflight -------------------------------------------------------------

command -v claude >/dev/null || die "claude CLI not found."
[ -d "$ISSUES" ] || die "No issue tracker at $ISSUES."

# Resolve and vet every ticket before touching the repo, so a typo or a blocked
# ticket fails here and not three tickets deep.
FILES=()
for n in "${BATCH[@]}"; do
  f=$(ls "$ISSUES"/"$n"-*.md 2>/dev/null | head -1)
  [ -n "$f" ] || die "No ticket file for $n in $ISSUES."

  status=$(grep -m1 '^\*\*Status:\*\*' "$f" | sed 's/\*\*Status:\*\* *//')
  case "$status" in
    ready-for-agent) ;;
    done) die "Ticket $n is already done. Drop it from the batch." ;;
    *) die "Ticket $n is '$status', not ready-for-agent. An agent should not pick it up." ;;
  esac

  blocked=$(grep -m1 '^\*\*Blocked by:\*\*' "$f" | sed 's/\*\*Blocked by:\*\* *//')
  case "$blocked" in
    None*) ;;
    *)
      # A blocker is fine when it is done, or when it runs earlier in this batch.
      for b in $(printf '%s' "$blocked" | grep -oE '[0-9]+' | head -4); do
        bf=$(ls "$ISSUES"/"$b"-*.md 2>/dev/null | head -1)
        bs=$(grep -m1 '^\*\*Status:\*\*' "$bf" 2>/dev/null | sed 's/\*\*Status:\*\* *//')
        if [ "$bs" != "done" ] && ! printf '%s\n' "${BATCH[@]}" | grep -qx "$b"; then
          die "Ticket $n is blocked by $b, which is '$bs' and not in this batch."
        fi
      done
      ;;
  esac

  FILES+=("$f")
done

[ -z "$(git status --porcelain -- . ':!next-env.d.ts' ':!docs/assets')" ] \
  || die "Working tree is dirty. Commit or stash first."

npm run check >/dev/null 2>&1 || die "npm run check already fails. Fix that before starting."

# 09, 11, 13, 21 and 23 talk to the Codex bridge. Without it they can only fail.
if printf '%s\n' "${BATCH[@]}" | grep -qE '^(09|9|11|13|21|23)$'; then
  curl -sf --max-time 3 http://127.0.0.1:3211/health >/dev/null \
    || die "Tickets 09/11/13/21/23 need the bridge. Run 'npm run bridge' in another terminal."
fi

say "Batch: ${BATCH[*]}"
echo "    branch: $BRANCH"
echo "    logs:   $LOGDIR"
for f in "${FILES[@]}"; do echo "    - $(head -1 "$f" | sed 's/^# //')"; done

if [ "$DRY_RUN" = 1 ]; then say "Dry run. Nothing changed."; exit 0; fi

printf '\nStart? Every ticket runs with permission checks off. [y/N] '
read -r reply
[ "$reply" = "y" ] || die "Cancelled."

mkdir -p "$LOGDIR"
git switch -c "$BRANCH" || die "Could not create $BRANCH."
START_REF=$(git rev-parse HEAD)

# --- run -------------------------------------------------------------------

DONE_TICKETS=()
FAILED=""

for i in "${!FILES[@]}"; do
  n="${BATCH[$i]}"
  f="${FILES[$i]}"
  log="$LOGDIR/$n.log"
  before=$(git rev-parse HEAD)

  say "[$((i + 1))/${#FILES[@]}] Ticket $n"
  echo "    $(head -1 "$f" | sed 's/^# //')"
  echo "    log: $log"

  # A fresh process per ticket is the /clear between tickets that /implement wants.
  claude -p "/implement $f" \
    --dangerously-skip-permissions \
    --append-system-prompt "You are running unattended in a batch. Never ask the user anything: decide, and record the assumption in the ticket comment. Do not run git push. Do not change git remotes. Do not edit any ticket other than this one." \
    > "$log" 2>&1
  rc=$?

  if [ $rc -ne 0 ]; then FAILED="$n (claude exited $rc)"; break; fi
  if [ "$(git rev-parse HEAD)" = "$before" ]; then FAILED="$n (no commit made)"; break; fi

  # Convex functions only reach the deployment when they are pushed.
  if ! git diff --quiet "$before" HEAD -- convex/; then
    say "convex/ changed, pushing"
    npx convex dev --once >> "$log" 2>&1 || { FAILED="$n (convex push failed)"; break; }
  fi

  if ! npm run check >> "$log" 2>&1; then FAILED="$n (npm run check failed after the commit)"; break; fi

  DONE_TICKETS+=("$n")
  say "Ticket $n done: $(git log --oneline -1)"
done

# --- report ----------------------------------------------------------------

say "Batch finished"
echo "    branch:  $BRANCH"
echo "    done:    ${DONE_TICKETS[*]:-none}"
echo "    commits: $(git rev-list --count "$START_REF"..HEAD)"
[ -n "$FAILED" ] && echo "    STOPPED: $FAILED"
echo
git log --oneline "$START_REF"..HEAD
echo
echo "Review:  git diff $START_REF..HEAD"
echo "Merge:   git switch main && git merge --no-ff $BRANCH"
echo "Discard: git switch main && git branch -D $BRANCH"
if [ -n "$FAILED" ]; then
  echo
  echo "Read $LOGDIR/${FAILED%% *}.log before rerunning."
  exit 1
fi
exit 0
