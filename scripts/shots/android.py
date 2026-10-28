# python3 scripts/shots/android.py <apk> <out dir> [language ...]   (run from the repo root)
# The Play store shots, like iOS's UITests/Tour: the Current screen with the frog, Planning, a new todo marked as a frog,
# Delegation and Planning in dark mode, from a seeded account per language, to <out dir>/<language>/<n>-<name>.png. Drives
# the emulator or device in ANDROID_SERIAL with adb and uiautomator, finding controls by the app's own translations.
# <apk> is a release build pointed at a LOCAL backend, with -Pqa so it signs in from an intent extra and run-as works:
#   ./gradlew -Papi=http://10.0.2.2:1337 -Pqa :app:assemblePlayRelease   (10.0.2.2 is the host, from the emulator)
# API (default http://localhost:1337) is the same backend from here, for ios/seed.py. Languages default to every app
# language. Run it once per device size (phone, 7" and 10" tablet) into <raw dir>/{phone,tab7,tab10} for compose.py.
import base64, json, os, re, shutil, subprocess, sys, time, urllib.parse
import xml.etree.ElementTree as ET

APP = 'com.todorant'
API = os.environ.get('API', 'http://localhost:1337')
TRANSLATIONS = 'android/app/src/main/assets/translations'
apk, out = sys.argv[1], os.path.abspath(sys.argv[2])
languages = sys.argv[3:] or sorted(f[:-len('.json')] for f in os.listdir(TRANSLATIONS))
os.makedirs(out, exist_ok=True)


def translations(language):
    en, d = (json.load(open(os.path.join(TRANSLATIONS, f'{l}.json'), encoding='utf8')) for l in ('en', language))
    get = lambda j, k: j.get(k[0]) if len(k) == 1 else get(j.get(k[0], {}), k[1:])
    return lambda key: get(d, key.split('.')) or get(en, key.split('.'))


def seed(language, *flags):
    return subprocess.run([sys.executable, 'ios/seed.py', API, language, *flags], check=True, capture_output=True, text=True).stdout.strip()


def adb(*args, check=True, timeout=None):
    return subprocess.run(['adb', *args], check=check, capture_output=True, timeout=timeout).stdout


def nodes():
    for _ in range(5):
        xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty', check=False).decode('utf8', 'replace')
        xml = xml[xml.find('<?xml'):xml.rfind('>') + 1]
        try:
            return list(ET.fromstring(xml).iter('node'))
        except ET.ParseError:
            time.sleep(1)
    return []


def find(match, timeout=60, last=False, quiet=False):
    """The first (or with last, the lowest) on-screen node whose text or content description passes match; with quiet,
    None after the timeout"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = nodes()
        # a slow emulator's "isn't responding" (wait) or a crashed system app's "keeps stopping" (close)
        crash = [n for n in found if n.get('resource-id') in ('android:id/aerr_wait', 'android:id/aerr_close')]
        if crash:
            tap(crash[0])
            continue
        hits = [n for n in found if any(match(n.get(a) or '') for a in ('text', 'content-desc')) and n.get('bounds') != '[0,0][0,0]']
        if hits:
            return hits[-1] if last else hits[0]
        time.sleep(1)
    if quiet:
        return None
    open(os.path.join(out, 'zz-fail.png'), 'wb').write(adb('exec-out', 'screencap', '-p'))
    print('\n'.join(f"{n.get('text')!r} {n.get('content-desc')!r} {n.get('bounds')}" for n in nodes() if n.get('text') or n.get('content-desc')))
    raise SystemExit(f'nothing on screen matches {match.__doc__}')


def tap(n):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def exactly(s):
    m = lambda v: v == s
    m.__doc__ = repr(s)
    return m


def containing(s):
    m = lambda v: s in v
    m.__doc__ = f'... {s!r} ...'
    return m


def shot(folder, name):
    time.sleep(2)
    demo_clock()
    open(os.path.join(folder, name + '.png'), 'wb').write(adb('exec-out', 'screencap', '-p'))


def demo_status_bar():
    adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1')
    for extra in (['clock', '-e', 'hhmm', '0941'], ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
                  ['network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'fully', 'true'],
                  ['network', '-e', 'mobile', 'show', '-e', 'level', '4', '-e', 'datatype', 'none', '-e', 'fully', 'true'],
                  ['notifications', '-e', 'visible', 'false']):
        adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'enter', check=False)
        adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', *extra, check=False)


def demo_clock():
    # a busy emulator's System UI can miss the demo broadcasts for minutes after booting, and the shot then shows the
    # real time and notification icons: check the status bar's clock (its own window) and send them again until it's 9:41
    for _ in range(10):
        xml = adb('exec-out', 'uiautomator', 'dump', '--windows', '/dev/tty', check=False).decode('utf8', 'replace')
        clocks = re.findall(r'text="([^"]*)" resource-id="com\.android\.systemui:id/clock"', xml)
        if clocks and all(c.strip() == '9:41' for c in clocks):
            return
        demo_status_bar()
        time.sleep(3)
    raise SystemExit(f'the status bar shows {clocks}, not the 9:41 demo clock')


def start(*extras):
    # -W waits for the first frame, and a busy emulator now and then leaves the app on its splash screen for good
    adb('shell', 'am', 'start', '-W', '-n', APP + '/.MainActivity', *extras, timeout=90)


def walk(language):
    folder = os.path.join(out, language)
    shutil.rmtree(folder, ignore_errors=True)  # a walk that fails partway leaves no older shots beside its new ones
    os.makedirs(folder)
    t, texts, token = translations(language), json.loads(seed(language, '--texts')), seed(language)
    plain = lambda s: s.split(' #')[0]  # the text before its tag, which the app colors as its own span
    adb('shell', 'cmd', 'uimode', 'night', 'no')
    # a fresh app per language, signed in to that language's account, past the tutorial
    adb('shell', 'pm', 'clear', APP)
    adb('shell', 'pm', 'grant', APP, 'android.permission.POST_NOTIFICATIONS', check=False)  # no permission prompt over a shot
    # and in its language: the app follows the system language unless one is picked, and on its first start it would
    # sync the emulator's English to the account
    prefs = base64.b64encode(("<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name=\"tutorialIsShown\">true</string>"
                              f"<string name=\"languageSelect\">{language}</string></map>").encode()).decode()
    for attempt in range(5):  # run-as can fail for a moment right after pm clear
        if not subprocess.run(['adb', 'shell', f"echo {prefs} | base64 -d | run-as {APP} sh -c 'mkdir -p shared_prefs && cat > shared_prefs/todorant.xml'"]).returncode:
            break
        time.sleep(3)
    else:
        raise SystemExit('could not write the app preferences')
    demo_status_bar()  # again, in case a busy emulator restarted the system UI
    start('--es', 'login', token)

    # signing in ends on Settings, and the synced language comes a moment later: go to Current until the frog shows
    deadline = time.time() + 120
    # (an Element without children is falsy, so compare with None)
    while find(containing(plain(texts['frog'])), timeout=5, quiet=True) is None:
        if time.time() > deadline:
            find(containing(plain(texts['frog'])), timeout=0)
        tab = find(exactly(t('current')), timeout=5, quiet=True)
        if tab is not None:
            tap(tab)
    find(exactly(t('planning')))
    shot(folder, '1-current')

    tap(find(exactly(t('planning'))))
    find(containing(plain(texts['tomorrow'][0])))
    shot(folder, '2-planning')

    # the add screen with the text already typed (any script, which adb input can't type), then the frog switch
    start('--es', 'route', 'add?text=' + urllib.parse.quote(texts['add'], safe=''))
    find(containing(texts['add'].rstrip(' #')))
    # Back hides the keyboard (the screen stays), so the shot shows the whole form, as on iOS
    time.sleep(2)
    if any('inputmethod' in (n.get('package') or '') for n in nodes()) or b'mInputShown=true' in adb('shell', 'dumpsys', 'input_method'):
        adb('shell', 'input', 'keyevent', '4')
        find(containing(texts['add'].rstrip(' #')))
    # the label isn't clickable: tap the switch on its row
    label = find(exactly(t('todo.create.frog')))
    y = lambda n: sum(map(int, re.findall(r'\d+', n.get('bounds'))[1::2])) // 2
    switch = min((n for n in nodes() if n.get('checkable') == 'true'), key=lambda n: abs(y(n) - y(label)))
    tap(switch)
    time.sleep(1)
    if not any(n.get('bounds') == switch.get('bounds') and n.get('checked') == 'true' for n in nodes()):
        raise SystemExit('the frog switch is off')
    shot(folder, '3-add')

    adb('shell', 'am', 'force-stop', APP)
    start()
    tap(find(exactly(t('delegate.title'))))
    find(containing(plain(texts['to_me'])))
    shot(folder, '4-delegation')

    adb('shell', 'am', 'force-stop', APP)
    adb('shell', 'cmd', 'uimode', 'night', 'yes')
    start()
    tap(find(exactly(t('planning'))))
    find(containing(plain(texts['tomorrow'][0])))
    shot(folder, '5-dark')
    adb('shell', 'cmd', 'uimode', 'night', 'no')


# a freshly started emulator: wait for the system to finish booting
adb('wait-for-device')
while adb('shell', 'getprop', 'sys.boot_completed', check=False).strip() != b'1':
    time.sleep(5)
time.sleep(20)  # System UI and the package manager settle a little after
for scale in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):  # less work, steadier dumps
    adb('shell', 'settings', 'put', 'global', scale, '0')
adb('shell', 'settings', 'put', 'global', 'heads_up_notifications_enabled', '0')
demo_status_bar()
# A tablet's launcher keeps its taskbar (app icons) over the bottom of every app, so turn the launcher off for the walk
home = None
if int(adb('shell', 'wm', 'size').split(b'x')[0].split()[-1]) * 160 // int(adb('shell', 'wm', 'density').split()[-1]) >= 600:
    for package in adb('shell', 'pm', 'list', 'packages', '-d').decode().split():  # one a killed walk left off
        if 'launcher' in package:
            adb('shell', 'pm', 'enable', package.split(':')[-1])
    home = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.HOME',
               '-a', 'android.intent.action.MAIN').decode().split()[-1].split('/')[0]
    if home == 'com.android.settings':  # its fallback home: there's no launcher to turn off
        home = None
    else:
        adb('shell', 'pm', 'disable-user', '--user', '0', home)
failed = []
try:
    adb('uninstall', APP, check=False)
    adb('install', '-r', apk)
    for language in languages:
        for attempt in range(2):  # a busy emulator now and then misses a step, so a language gets a second walk
            try:
                walk(language)
                break
            except (SystemExit, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                print(language, 'attempt', attempt + 1, e, flush=True)
        else:
            failed.append(language)
            continue
        print(language, ' '.join(sorted(os.listdir(os.path.join(out, language)))), flush=True)
finally:
    adb('shell', 'cmd', 'uimode', 'night', 'no')
    if home:
        adb('shell', 'pm', 'enable', home)
if failed:
    raise SystemExit('failed: ' + ' '.join(failed))
