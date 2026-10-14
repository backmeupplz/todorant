#!/bin/sh
# App Store screenshots: seeds a demo account per language on a LOCAL backend and runs UITests/Tour on the
# iPhone 6.9" and iPad 13" simulators. Saves screenshots/<lang>/<device>/NN-name.png.
#   API=http://localhost:3310 [SIMS="todorant-ipad"] ./tour.sh [langs...]      (default: all six, both devices)
set -e
cd "$(dirname "$0")"
API="${API:-http://localhost:3310}"
IPHONE="${IPHONE:-todorant-iphone}"
IPAD="${IPAD:-todorant-ipad}"
LANGS="${*:-en ru uk it es pt-br}"
SIMS="${SIMS:-$IPHONE $IPAD}"
add_text() {
  case $1 in
    en) echo "Call Mom about the weekend #";; ru) echo "Позвонить маме насчёт выходных #";; uk) echo "Подзвонити мамі щодо вихідних #";;
    it) echo "Chiamare la mamma per il weekend #";; es) echo "Llamar a mamá por el fin de semana #";; pt-br) echo "Ligar para a mãe sobre o fim de semana #";;
  esac
}
for sim in $SIMS; do
  xcrun simctl boot "$sim" 2>/dev/null || true
  xcrun simctl status_bar "$sim" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
done
for lang in $LANGS; do
  for sim in $SIMS; do
    device=$([ "$sim" = "$IPAD" ] && echo ipad-13 || echo iphone-6.9)
    out="screenshots/$lang/$device"
    rm -rf /tmp/todorant-tour && mkdir -p "$out"
    xcrun simctl uninstall "$sim" com.todorant.app 2>/dev/null || true
    token=$(./seed.py "$API" "$lang")
    tabs=$(python3 -c "
import json
t = '../android/app/src/main/assets/translations/%s.json'
d, en = json.load(open(t % '$lang')), json.load(open(t % 'en'))
get = lambda j, k: (j.get(k[0]) if len(k) == 1 else get(j.get(k[0], {}), k[1:]))
print(','.join(get(d, k.split('.')) or get(en, k.split('.')) for k in ['current', 'planning', 'delegate.title', 'settings']))")
    TEST_RUNNER_API="$API" TEST_RUNNER_TOKEN="$token" TEST_RUNNER_LANG="$lang" TEST_RUNNER_TABS="$tabs" TEST_RUNNER_FROG="$(./seed.py "$API" "$lang" --frog)" \
    TEST_RUNNER_ADD_TEXT="$(add_text "$lang")" TEST_RUNNER_SHOTS=/tmp/todorant-tour \
      xcodebuild -scheme Todorant -destination "platform=iOS Simulator,name=$sim" -derivedDataPath build \
      -collect-test-diagnostics never test -only-testing:UITests/Tour 2>&1 | grep -E 'error:|TEST SUCC|TEST FAIL' || true
    cp /tmp/todorant-tour/0*.png "$out/" || echo "$lang $device FAILED"
    echo "$lang $device: $(ls "$out" | tr '\n' ' ')"
  done
done
