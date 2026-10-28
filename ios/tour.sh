#!/bin/sh
# Store screenshots: seeds a demo account per language on a LOCAL backend and runs UITests/Tour on a release build (with
# the QA condition, so it takes the tour's launch arguments) on the iPhone 6.9" and iPad 13" simulators. Saves the raw
# frames to ../shots/<device>/<lang>/NN-name.png, which ../scripts/shots/compose.py puts under the captions.
#   API=http://localhost:1337 [SIMS="todorant-ipad"] ./tour.sh [langs...]      (default: every app language, both devices)
# SIMS takes any simulators, by name or UDID, each with an optional =<device> folder name, e.g. the iPhone Duo's cover display:
#   SIMS="<duo udid>=duo-outer" ./tour.sh en
# and its inner display (landscape there), unfolded by duo-hinge (github.com/tosbaha/duo-fold-control, tools/duo-hinge.m):
#   UNFOLD=<path to duo-hinge> SIMS="<duo udid>=duo-inner" ./tour.sh en
# BUILD=0 reuses the last build; DERIVED (default build) is its folder, so a second build can run beside a running tour.
set -e
cd "$(dirname "$0")"
API="${API:-http://localhost:1337}"
IPHONE="${IPHONE:-todorant-iphone}"
IPAD="${IPAD:-todorant-ipad}"
LANGS="${*:-$(ls ../android/app/src/main/assets/translations | sed 's/\.json$//')}"
SIMS="${SIMS:-$IPHONE $IPAD}"
DERIVED="${DERIVED:-build}"
# a translation, with English for a missing key
t() {
  python3 -c "
import json, sys
p = '../android/app/src/main/assets/translations/%s.json'
d, en = json.load(open(p % sys.argv[1])), json.load(open(p % 'en'))
get = lambda j, k: (j.get(k[0]) if len(k) == 1 else get(j.get(k[0], {}), k[1:]))
print(','.join(get(d, k.split('.')) or get(en, k.split('.')) for k in sys.argv[2:]))" "$@"
}
if [ "${BUILD:-1}" = 1 ]; then
  mkdir -p "$DERIVED"
  xcodebuild build-for-testing -scheme Todorant -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS=QA ENABLE_TESTABILITY=YES > "$DERIVED/tour-build.log" 2>&1 ||
    { grep -E 'error:' "$DERIVED/tour-build.log" || true; echo "the build failed (ios/$DERIVED/tour-build.log): not touring an older one"; exit 1; }
fi
# a seeded text (seed.py --texts), e.g. seeded en "['to_me']"
seeded() {
  ./seed.py "$API" "$1" --texts | python3 -c "import json, sys; print(json.load(sys.stdin)$2)"
}
# boots a simulator (again, if SpringBoard or an unfold took it down) with a clean status bar
boot() {
  xcrun simctl boot "$1" 2>/dev/null || true
  xcrun simctl bootstatus "$1" > /dev/null
  xcrun simctl status_bar "$1" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
}
for lang in $LANGS; do
  for entry in $SIMS; do
    sim=${entry%%=*}
    device=${entry#*=}
    [ "$device" = "$entry" ] && device=$([ "$sim" = "$IPAD" ] && echo ipad-13 || echo iphone-6.9)
    destination=$(echo "$sim" | grep -qE '^[0-9A-F-]{36}$' && echo "id=$sim" || echo "name=$sim")
    out="../shots/$device/$lang"
    tmp="/tmp/todorant-tour-$sim"  # one per simulator, so several can run at once
    # a busy Mac now and then loses a step (SpringBoard restarts, an accessibility timeout), so a language gets a second run
    for attempt in 1 2; do
      rm -rf "$tmp" "$out" && mkdir -p "$out" "$tmp"
      boot "$sim"
      xcrun simctl uninstall "$sim" com.todorant.app 2>/dev/null || true
      token=$(./seed.py "$API" "$lang")
      # the test runner won't start on an unfolded Duo: fold it, and unfold it when the test asks (Tour.unfold)
      [ -z "$UNFOLD" ] || "$UNFOLD" -d "$sim" closed > /dev/null
      TEST_RUNNER_API="$API" TEST_RUNNER_TOKEN="$token" TEST_RUNNER_LANG="$lang" TEST_RUNNER_TABS="$(t "$lang" current planning delegate.title settings)" \
      TEST_RUNNER_FROG="$(./seed.py "$API" "$lang" --frog)" TEST_RUNNER_FROG_LABEL="$(t "$lang" todo.create.frog)" \
      TEST_RUNNER_ADD_TEXT="$(./seed.py "$API" "$lang" --add)" TEST_RUNNER_PLANNED="$(seeded "$lang" "['tomorrow'][0]")" TEST_RUNNER_TO_ME="$(seeded "$lang" "['to_me']")" \
      TEST_RUNNER_SHOTS="$tmp" TEST_RUNNER_DUO_INNER="${UNFOLD:+1}" \
        xcodebuild test-without-building -scheme Todorant -configuration Release -destination "platform=iOS Simulator,$destination" -derivedDataPath "$DERIVED" \
        -collect-test-diagnostics never -only-testing:UITests/Tour > "$tmp.log" 2>&1 &
      # xcodebuild now and then hangs after the test is done: five shots or 15 minutes end it
      pid=$! waited=0
      while kill -0 $pid 2>/dev/null && [ $waited -lt 900 ]; do
        [ "$(ls "$tmp" 2>/dev/null | grep -c '^0[1-5]-')" = 5 ] && { sleep 10; break; }
        [ -e "$tmp/unfold" ] && "$UNFOLD" -d "$sim" flat > /dev/null && rm "$tmp/unfold"
        sleep 3; waited=$((waited + 3))
      done
      kill $pid 2>/dev/null || true
      grep -E 'error:|TEST EXECUTE SUCC|TEST EXECUTE FAIL|TEST SUCC|TEST FAIL' "$tmp.log" || true
      cp "$tmp"/0*.png "$out/" 2>/dev/null || true
      [ "$(ls "$out" | grep -c '^0[1-5]-')" = 5 ] && break
      echo "$lang $device attempt $attempt FAILED"
    done
    echo "$lang $device: $(ls "$out" | tr '\n' ' ')"
  done
done
