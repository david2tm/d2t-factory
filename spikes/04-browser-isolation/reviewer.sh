#!/bin/bash
# One running-app reviewer's browser sequence (AD-22): pinned agent-browser via npx,
# --session <run-id>-<role>, against the run's single dev server.
# Usage: reviewer.sh <role> <port> <barrier-epoch-seconds> <outdir>
ROLE="$1"; PORT="$2"; BARRIER="$3"; OUT="$4"
mkdir -p "$OUT"
AB=(npx -y agent-browser@0.39.2 --session "spike-run-0000-$ROLE")
# Epoch seconds with ms (macOS date has no %N).
log() { printf '%s %s\n' "$(perl -MTime::HiRes=time -e 'printf "%.3f", time')" "$*" >> "$OUT/$ROLE.log"; }
run() { log "\$ agent-browser $*"; "${AB[@]}" "$@" >> "$OUT/$ROLE.log" 2>&1; local rc=$?; log "rc=$rc"; return $rc; }

run open "http://127.0.0.1:$PORT/r/$ROLE"
run eval "localStorage.setItem('ls_$ROLE','$ROLE'); document.cookie='ck_$ROLE=$ROLE; path=/'; 'set:' + '$ROLE'"
# Barrier: every reviewer snapshots and reads at the same wall-clock second.
while [ "$(date +%s)" -lt "$BARRIER" ]; do sleep 0.2; done
log "barrier reached"
log "\$ agent-browser snapshot -i"
"${AB[@]}" snapshot -i > "$OUT/$ROLE.snapshot.txt" 2>&1; log "rc=$?"
run eval "JSON.stringify({ls: Object.keys(localStorage).sort(), ck: document.cookie.split('; ').filter(Boolean).sort(), title: document.title})"
"${AB[@]}" eval "JSON.stringify({ls: Object.keys(localStorage).sort(), ck: document.cookie.split('; ').filter(Boolean).sort(), title: document.title})" > "$OUT/$ROLE.storage.json" 2>&1
# Click this reviewer's LAST button using the ref from its OWN snapshot.
N=$(grep -c "btn-$ROLE-" "$OUT/$ROLE.snapshot.txt")
REF=$(grep "btn-$ROLE-$N" "$OUT/$ROLE.snapshot.txt" | grep -oE 'ref=e[0-9]+|@e[0-9]+' | head -1 | sed 's/^ref=/@/')
log "own button count=$N ref=$REF"
# Second barrier: click only after every reviewer has taken its snapshot.
while [ "$(date +%s)" -lt "$((BARRIER + 8))" ]; do sleep 0.2; done
log "click barrier reached"
run click "$REF"
sleep 1
run close
log "done"
