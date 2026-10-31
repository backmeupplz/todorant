#!/usr/bin/env python3
"""Custom product pages (CPPs) for ad variants: Apple Search Ads shows a CPP's first screenshots instead of the default
page's, so each angle Radiant tests (prime-radiant experiments/2026-10-28-todorant-search-ads.md) is one CPP here.

One spec per page: appstore/cpp/<id>.md, with sections "## Name" (the page's name in App Store Connect),
"## Promotional text" and "## Screenshots", one "<screenshot>: <caption>" line per screenshot in order, where
<screenshot> is a raw screenshot in appstore/cpp/shots/iphone-6.9 (and ipad-13), taken by ios/tour.sh. The screenshots
are rendered here, on the fly: the caption on Todorant's orange, above the whole, unclipped screenshot.
Optional: "## Locales", English locales besides en-US that get the same texts and screenshots (each one once the live
app version has it), and "## Keywords", comma-separated search keywords that make App Store search show this page
instead of the default one (prime-radiant experiments/2026-10-28-todorant-keyword-cpp.md). Apple takes them only from
the keywords of the latest approved app version, so each localization gets those of them its locale has there; the
daily run assigns the rest once a release adds them.
Localized versions: appstore/cpp/<id>/<locale>.md (an App Store locale of appstore/<locale>/listing.md), with the same
"## Promotional text" and "## Screenshots" sections in that language, its screenshots from ios/tour.sh in that language
(e.g. <id>/<locale>/02-planning), and optionally its own "## Keywords" (the spec's keywords are English, so they stay on
the English locales). Captions in other scripts use the fonts in FONTS, downloaded and checked on first use.

  cpp.py render <spec.md> <out dir>     renders iphone-*.png (1320x2868) and ipad-*.png (2064x2752), each localized
                                        version's in <out dir>/<locale>
  cpp.py sync [--dry-run]               for every spec: creates the page in App Store Connect if it's missing (en-US
                                        promotional text and both screenshot sets), then sends it to App Review; prints
                                        each page's state. Safe to run again: done steps are skipped, and a page whose
                                        review couldn't start (another submission is open) is sent on the next run.
                                        A locale that the approved page lacks gets a new page version, sent to review;
                                        keywords are assigned to a version's localizations before it goes to review,
                                        and again to every current version's (refusals fail the run only on the newest
                                        approved version); a page with keywords is made visible (search shows only
                                        visible ones).
  env (sync): as for .github/scripts/appstore.py (APP_STORE_APP_ID, ASC_KEY_ID, ASC_ISSUER_ID, API_PRIVATE_KEYS_DIR)
"""
import glob, hashlib, http.client, json, os, re, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(HERE, "cpp", "shots")  # the raw English screenshots from ios/tour.sh, kept here since the store set is framed
FONT = os.path.join(HERE, "cpp", "Inter-ExtraBold.ttf")
# display type -> (folder in appstore/cpp/shots, canvas size)
DISPLAYS = {"APP_IPHONE_67": ("iphone-6.9", (1320, 2868)), "APP_IPAD_PRO_3GEN_129": ("ipad-13", (2064, 2752))}
ORANGE = ((255, 95, 19), (255, 138, 83))  # todorant.com's gradient, top to bottom
REVIEWED = {"WAITING_FOR_REVIEW", "IN_REVIEW", "ACCEPTED", "APPROVED", "REPLACED_WITH_NEW_VERSION"}
# the App Store locales the listing has (appstore/<locale>/listing.md), so the ones a localized version can have
LISTING = {os.path.basename(os.path.dirname(x)) for x in glob.glob(os.path.join(HERE, "*", "listing.md"))}
# caption fonts of localized versions (FONT is an English-only subset): file -> (pinned source, sha256), and per locale
FONTS_DIR = os.environ.get("CPP_FONTS") or os.path.join(HERE, "cpp", "fonts")  # not in git
_CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/"
_NOTO = "https://raw.githubusercontent.com/notofonts/notofonts.github.io/412a7edb2c8c535d1066157e5b17e661fd5591fe/fonts/"
_GOOGLE = "https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/"
FONTS = {
    "Inter.ttf": (_GOOGLE + "inter/Inter%5Bopsz,wght%5D.ttf", "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031"),
    "NotoSansSC-Bold.otf": (_CJK + "SC/NotoSansSC-Bold.otf", "c6cb5a93abaa9edc8ee7463b7ebb7f42d618d40e6ed2f7a5371c97b0b64767c0"),
    "NotoSansTC-Bold.otf": (_CJK + "TC/NotoSansTC-Bold.otf", "55420b259eb119bf5f2a0aadba10cf9d736c12d64ab93e78546d69ef5f43558b"),
    "NotoSansJP-Bold.otf": (_CJK + "JP/NotoSansJP-Bold.otf", "1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f"),
    "NotoSansKR-Bold.otf": (_CJK + "KR/NotoSansKR-Bold.otf", "5a6ceb287ed2fc6cfc6213144ebea68cbd94b20fc9eb873d8486493bf02d9bda"),
    "NotoSansArabic-Bold.ttf": (_NOTO + "NotoSansArabic/hinted/ttf/NotoSansArabic-Bold.ttf", "4e5462d2e8be880317b9f49b5b2da109ddb6a3563d91cc604b67f3535832a555"),
    "NotoSansDevanagari-Bold.ttf": (_NOTO + "NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf", "6a09c8d797cfc803d32cdc731e809424d74cbaff59f503de34ade421a08e5bc2"),
    "Kanit-ExtraBold.ttf": (_GOOGLE + "kanit/Kanit-ExtraBold.ttf", "70082870d1f5bb6ae9faa708572b2c36de3c076caae187edae753f709d0de984"),  # Thai with Latin digits
}
LOCALE_FONTS = {"zh-Hans": "NotoSansSC-Bold.otf", "zh-Hant": "NotoSansTC-Bold.otf", "ja": "NotoSansJP-Bold.otf", "ko": "NotoSansKR-Bold.otf",
                "ar-SA": "NotoSansArabic-Bold.ttf", "hi": "NotoSansDevanagari-Bold.ttf", "th": "Kanit-ExtraBold.ttf"}  # others: Inter.ttf
SHAPED = {"ar-SA", "hi", "th"}  # scripts that need text shaping (Pillow's raqm layout, which needs libfribidi)
UNSPACED = {"zh-Hans", "zh-Hant", "ja"}  # captions without spaces: lines break between characters
CLOSING = set("、。，．・：；！？）」』】〕〉》ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〜…")  # never start a line
OPENING = set("（「『【〔〈《")  # never end a line


def sections(path):
    out, name = {}, None
    for line in open(path, encoding="utf-8").read().split("\n"):
        m = re.match(r"^## (.+?)(?: \(max \d+\))?$", line)
        if m:
            name, out[m[1]] = m[1], []
        elif name and line.strip():
            out[name].append(line.strip())
    return out


def texts_of(out, path):
    """The promotional text, screenshots and keywords of a spec or a localized version"""
    t = {"promo": " ".join(out["Promotional text"]), "shots": [tuple(x.strip() for x in line.split(":", 1)) for line in out["Screenshots"]],
         "keywords": [x.strip() for line in out.get("Keywords", []) for x in line.split(",") if x.strip()]}
    assert len(t["promo"]) <= 170 and t["shots"] and all(len(x) == 2 and all(x) for x in t["shots"]), f"{path}: promotional text or screenshots"
    return t


def spec(path):
    out = sections(path)
    s = {"id": os.path.basename(path)[:-3], "name": " ".join(out["Name"]), **texts_of(out, path),
         "locales": ["en-US"] + [x for line in out.get("Locales", []) for x in re.split(r"[,\s]+", line) if x and x != "en-US"]}
    assert len(s["name"]) <= 70, f"{path}: name"
    assert all(x.startswith("en-") for x in s["locales"]), f"{path}: its screenshots and texts are English, so are its locales"
    s["localized"] = {}
    for f in sorted(glob.glob(os.path.join(os.path.dirname(path), s["id"], "*.md"))):
        locale = os.path.basename(f)[:-3]
        assert locale in LISTING and not locale.startswith("en-"), f"{f}: not a localized App Store locale of the listing"
        s["localized"][locale] = texts_of(sections(f), f)
    s["locales"] += list(s["localized"])
    return s


def texts(s, locale):
    """The promotional text, screenshots and keywords of the page's localization in this locale"""
    return s.get("localized", {}).get(locale) or s


def typeface(locale):
    """size -> the caption font of this locale's own texts (None: the English ones), its file fetched once and checked"""
    from PIL import ImageFont, features
    if locale is None:  # Pillow's basic layout, whether raqm is there or not, so the English renders keep their bytes
        return lambda size: ImageFont.truetype(FONT, size, layout_engine=ImageFont.Layout.BASIC)
    name = LOCALE_FONTS.get(locale, "Inter.ttf")
    path, (url, sha) = os.path.join(FONTS_DIR, name), FONTS[name]
    if not os.path.exists(path) or hashlib.sha256(open(path, "rb").read()).hexdigest() != sha:
        os.makedirs(FONTS_DIR, exist_ok=True)
        for attempt in range(3):
            try:
                raw = urllib.request.urlopen(url, timeout=300).read()
                break
            except (OSError, http.client.HTTPException) as e:  # urllib's errors, timeouts and cut-off downloads
                if attempt == 2:
                    sys.exit(f"{url}: {e!r}")
                time.sleep(10)
        assert hashlib.sha256(raw).hexdigest() == sha, f"{url}: not the pinned font"
        with tempfile.NamedTemporaryFile(dir=FONTS_DIR, delete=False) as f:
            f.write(raw)
        os.replace(f.name, path)
    if locale in SHAPED and not features.check("raqm"):
        sys.exit(f"{locale} captions need Pillow's raqm layout: install libfribidi (apt-get install libfribidi0)")

    def load(size):
        font = ImageFont.truetype(path, size)
        if name == "Inter.ttf":  # a variable font, as heavy as FONT
            font.set_variation_by_name("ExtraBold")
        return font
    return load


def covered(load, caption):
    """Fails unless the font has every character of the caption (a missing one draws as the .notdef box)"""
    from PIL import Image, ImageDraw
    font = load(60)

    def ink(c):
        img = Image.new("L", (240, 240))
        ImageDraw.Draw(img).text((60, 60), c, font=font, fill=255)
        return img.tobytes()
    notdef = ink("͸")  # unassigned in Unicode
    missing = sorted({c for c in caption if not c.isspace() and c != "\u200b" and ink(c) == notdef})
    if missing:
        sys.exit(f"the caption font has no {''.join(missing)!r}: {caption}")


def render(s, out, locale=None):
    """One PNG per screenshot and display, for the texts of the page's localization in this locale (None: the English
    ones): the caption as large as fits in at most 3 lines, the screenshot whole below it."""
    from PIL import Image, ImageDraw, ImageFilter
    own = locale if locale in s.get("localized", {}) else None
    shots, load, unspaced = texts(s, own)["shots"], typeface(own), own in UNSPACED
    for _, caption in shots:
        covered(load, caption)
    os.makedirs(out, exist_ok=True)
    files = {}
    for display, (folder, (w, h)) in DISPLAYS.items():
        files[display] = []
        side, top = round(w * 0.08), round(h * 0.07)
        size = min(fit(caption, w - 2 * side, round(min(w * 0.1, h * 0.046)), load, unspaced) for _, caption in shots)  # one size per set
        font = load(size)
        for i, (shot, caption) in enumerate(shots, 1):
            img = Image.new("RGB", (w, h))
            px = ImageDraw.Draw(img)
            for y in range(h):  # vertical gradient
                t = y / (h - 1)
                px.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(*ORANGE)))
            lines = wrap(caption, font, w - 2 * side, unspaced)
            step = round(size * 1.18)
            for n, line in enumerate(lines):
                lw = font.getlength(line)
                px.text(((w - lw) / 2, top + n * step), line, font=font, fill="white")
            text_bottom = top + len(lines) * step
            src = Image.open(raw(folder, shot)).convert("RGB")
            gap, bottom = round(h * 0.045), round(h * 0.05)
            scale = min((w - 2 * side) / src.width, (h - text_bottom - gap - bottom) / src.height)
            sw, sh = round(src.width * scale), round(src.height * scale)
            src = src.resize((sw, sh), Image.LANCZOS)
            x, y = (w - sw) // 2, text_bottom + gap
            r = round(min(sw, sh) * 0.07)
            shadow = Image.new("L", (w, h), 0)
            ImageDraw.Draw(shadow).rounded_rectangle([x, y + 24, x + sw, y + sh + 24], r, fill=110)
            img.paste((120, 35, 0), mask=shadow.filter(ImageFilter.GaussianBlur(40)))
            mask = Image.new("L", (sw, sh), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], r, fill=255)
            img.paste(src, (x, y), mask)
            ImageDraw.Draw(img).rounded_rectangle([x - 6, y - 6, x + sw + 5, y + sh + 5], r + 6, outline=(255, 255, 255), width=6)
            assert y + sh + bottom <= h and text_bottom < y, "the screenshot must fit whole"
            path = os.path.join(out, f"{folder.split('-')[0]}-{i}.png")
            img.save(path, optimize=True)
            files[display].append(path)
    return files


def raw(folder, shot):
    """A raw screenshot's file: PNG, or JPEG for the localized ones (smaller, and scaled down anyway)"""
    path = os.path.join(SHOTS, folder, shot)
    return path + ".jpg" if os.path.exists(path + ".jpg") else path + ".png"


def fit(caption, width, start, load, unspaced=False):
    """The largest font size, from `start` down, that sets the caption in at most 3 lines."""
    for size in range(start, 40, -2):
        if len(wrap(caption, load(size), width, unspaced)) <= 3:
            return size
    sys.exit(f"caption too long: {caption}")


def words(text, unspaced):
    """The pieces a line can break between: words, or, in scripts without spaces, characters (punctuation, small kana
    and Latin words stay with their neighbours), each with the space that follows it. A zero-width space (U+200B) marks
    a break between words written without a space: in Thai, and in Chinese or Japanese, where it makes the only breaks"""
    if not unspaced or "\u200b" in text:
        return [re.sub(" +", " ", w).replace("\u200b", "") for w in re.findall("[^ \u200b]+[ \u200b]*", text)]  # not at no-break spaces
    out = []
    for c in text:
        latin = c.isascii() and c.isalnum() and out and out[-1][-1:].isascii() and out[-1][-1:].isalnum()
        if out and (c == " " or c in CLOSING or latin or out[-1][-1] in OPENING):
            out[-1] += c
        elif c != " ":
            out.append(c)
    return out


def wrap(text, font, width, unspaced=False):
    lines = [""]
    for word in words(text, unspaced):
        cand = lines[-1] + word
        if font.getlength(cand.strip()) <= width or not lines[-1]:
            lines[-1] = cand
        else:
            lines.append(word)
    lines = [line.strip() for line in lines]
    return lines if all(font.getlength(line) <= width for line in lines) else lines * 4  # a word wider than the line: too big


def upload(a, localization, display, files):
    """Makes the page's set for this display exactly these files (same steps as listings.py upload_screenshots), without
    waiting for Apple to process them (see processed): the set's id, or None if Apple has processed them all."""
    sets = {x["attributes"]["screenshotDisplayType"]: x for x in a.data("GET", f"/v1/appCustomProductPageLocalizations/{localization}/appScreenshotSets")}
    if display in sets:
        old = a.data("GET", f"/v1/appScreenshotSets/{sets[display]['id']}/appScreenshots")
        if [x["attributes"].get("sourceFileChecksum") for x in old] == [hashlib.md5(open(f, "rb").read()).hexdigest() for f in files]:
            states = [(x["attributes"].get("assetDeliveryState") or {}).get("state") for x in old]
            if "FAILED" not in states:
                return None if all(x == "COMPLETE" for x in states) else sets[display]["id"]
        for x in old:
            a.api("DELETE", f"/v1/appScreenshots/{x['id']}")
        shot_set = sets[display]["id"]
    else:
        shot_set = a.data("POST", "/v1/appScreenshotSets", body=a.resource("appScreenshotSets", attributes={"screenshotDisplayType": display},
                          appCustomProductPageLocalization={"type": "appCustomProductPageLocalizations", "id": localization}))["id"]
    for f in files:
        raw = open(f, "rb").read()
        shot = a.data("POST", "/v1/appScreenshots", body=a.resource("appScreenshots", attributes={"fileName": os.path.basename(f), "fileSize": len(raw)},
                      appScreenshotSet={"type": "appScreenshotSets", "id": shot_set}))
        for op in shot["attributes"]["uploadOperations"]:
            urllib.request.urlopen(urllib.request.Request(op["url"], raw[op["offset"]:op["offset"] + op["length"]], method=op["method"],
                                   headers={x["name"]: x["value"] for x in op.get("requestHeaders", [])}), timeout=300).read()
        a.data("PATCH", f"/v1/appScreenshots/{shot['id']}", body=a.resource("appScreenshots", shot["id"], {"uploaded": True, "sourceFileChecksum": hashlib.md5(raw).hexdigest()}))
    return shot_set


def processed(a, sets, minutes=30):
    """Waits up to `minutes` until Apple has processed the screenshots of these sets, sent before (Apple processes them
    side by side): whether it has; a set still processing is left for the next run. Like listings.py
    wait_for_processing, it checks one set at a time, so a long wait stays inside the key's 3600 requests an hour, and a
    rate limit or a server error only means asking again."""
    sets, deadline = list(sets), time.time() + minutes * 60
    while sets:
        try:
            shots = a.data("GET", f"/v1/appScreenshotSets/{sets[0]}/appScreenshots", ok=(429, 500, 502, 503, 504))
        except (OSError, http.client.HTTPException) as e:  # a dropped connection, over a wait this long
            print(f"  {e!r}, asking again")
            shots = None
        states = [(x["attributes"].get("assetDeliveryState") or {}).get("state") for x in shots or []]
        if "FAILED" in states:
            sys.exit(f"Apple couldn't process a screenshot in set {sets[0]}: {states}")
        if shots is not None and all(x == "COMPLETE" for x in states):
            sets.pop(0)
            continue
        if time.time() + 15 > deadline:
            print(f"  Apple is still processing {len(sets)} screenshot sets; the next run submits the page")
            return False
        time.sleep(15)
    return True


def submit(a, version):
    """Adds the page's version to the open review submission (or a new one) and submits it. False if Apple refuses now."""
    open_ = a.data("GET", "/v1/reviewSubmissions", {"filter[app]": a.APP, "filter[platform]": "IOS", "filter[state]": "READY_FOR_REVIEW"}) or []
    sub = open_[0]["id"] if open_ else (a.data("POST", "/v1/reviewSubmissions", body=a.resource(
        "reviewSubmissions", attributes={"platform": "IOS"}, app={"type": "apps", "id": a.APP}), ok=(409,)) or {}).get("id")
    if not sub:
        return False
    a.api("POST", "/v1/reviewSubmissionItems", body=a.resource("reviewSubmissionItems", reviewSubmission={"type": "reviewSubmissions", "id": sub},
          appCustomProductPageVersion={"type": "appCustomProductPageVersions", "id": version}), ok=(409,))
    return bool(a.api("PATCH", f"/v1/reviewSubmissions/{sub}", body=a.resource("reviewSubmissions", sub, {"submitted": True}), ok=(409,)))


def latest(a, page):
    """The page's newest version (they're numbered "1", "2", …)"""
    versions = a.data("GET", f"/v1/appCustomProductPages/{page}/appCustomProductPageVersions") or [{}]
    return max(versions, key=lambda v: int(v.get("attributes", {}).get("version") or 0))


def localizations(a, version):
    """locale -> the version's localization"""
    if not version.get("id"):
        return {}
    return {x["attributes"]["locale"]: x for x in a.data("GET", f"/v1/appCustomProductPageVersions/{version['id']}/appCustomProductPageLocalizations") or []}


def available(a, s, locale, offered):
    """The locale's keywords in the spec that the app's latest approved version has in this locale (Apple's ids), and the
    others"""
    keywords = texts(s, locale)["keywords"]
    if locale not in offered:
        offered[locale] = {k["id"].lower(): k["id"] for k in a.data("GET", f"/v1/apps/{a.APP}/searchKeywords",
                           {"filter[locale]": locale, "filter[platform]": "IOS", "limit": 200}) or []}
    out = {"assignable": [offered[locale][k.lower()] for k in keywords if k.lower() in offered[locale]]}
    if len(out["assignable"]) < len(keywords):
        out["not in the app's keywords"] = [k for k in keywords if k.lower() not in offered[locale]]
    return out


def assign(a, s, loc, dry, offered):
    """Assigns the spec's keywords to a page localization, as far as its locale offers them: (what the locale offers,
    those of them it still lacks; dry, those it would get)"""
    want = available(a, s, loc["attributes"]["locale"], offered)
    path = f"/v1/appCustomProductPageLocalizations/{loc['id']}/relationships/searchKeywords"
    have = lambda: {k["id"] for k in a.data("GET", path, {"limit": 200}) or []}
    new = [k for k in want["assignable"] if k not in have()]
    if new and not dry:
        # Apple documents 400/403/409/422 refusals: carry on to the other pages, the read-back reports them
        a.api("POST", path, body={"data": [{"type": "appKeywords", "id": k} for k in new]}, ok=(400, 403, 409, 422))
        new = [k for k in want["assignable"] if k not in have()]  # read back: Apple can refuse or answer 204
    return want, new


def assign_all(a, s, page, dry, offered):
    """Assigns the spec's keywords to the localizations of each of the page's current versions (the live one and any
    newer one in review): "<locale> v<version>" -> assigned (or, dry, would be), and those its locale doesn't offer yet.
    Only refusals on the newest version, once approved, count as "Apple refused": an older approved version is
    replaced by the newer one, which has its own keywords"""
    versions = [v for v in a.data("GET", f"/v1/appCustomProductPages/{page}/appCustomProductPageVersions") or []
                if v["attributes"].get("state") not in ("REPLACED_WITH_NEW_VERSION", "REJECTED")]
    newest = max(versions, key=lambda v: int(v["attributes"].get("version") or 0), default=None)
    out = {}
    for version in versions:
        approved = version["attributes"].get("state") in ("ACCEPTED", "APPROVED")
        for locale, loc in localizations(a, version).items():
            if not texts(s, locale)["keywords"]:  # a localized version without keywords of its own
                continue
            want, new = assign(a, s, loc, dry, offered)
            entry = {"assigned": [k for k in want["assignable"] if k not in new]}
            if new and dry:
                entry["would assign"] = new
            elif new and approved and version is newest:
                entry["Apple refused"] = new
            elif new and approved:
                entry["refused on this older version (the newer one in progress replaces it)"] = new
            elif new:  # a version that isn't approved yet may not take them: the next run tries again
                entry["refused before approval (the next run retries)"] = new
            if "not in the app's keywords" in want:
                entry["not in the app's keywords"] = want["not in the app's keywords"]
            out[f"{locale} v{version['attributes'].get('version')}"] = entry
    return out


def sync(dry):
    sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))
    import appstore as a
    pages = {p["attributes"]["name"]: p for p in a.data("GET", f"/v1/apps/{a.APP}/appCustomProductPages", {"limit": 200}) or []}
    live = [v for v in a.versions() if v["attributes"]["appStoreState"] == "READY_FOR_SALE"]
    live = {x["attributes"]["locale"] for x in a.data("GET", f"/v1/appStoreVersions/{live[0]['id']}/appStoreVersionLocalizations", {"limit": 50})} if live else set()
    offered = {}  # locale -> {lowercase keyword: Apple's id} from the latest approved app version
    report = []
    for path in sorted(glob.glob(os.path.join(HERE, "cpp", "*.md"))):
        s = spec(path)
        page = pages.get(s["name"])
        locales = [x for x in s["locales"] if x == "en-US" or x in live]  # a page can only have the app's own locales
        waiting = [x for x in s["locales"] if x not in locales]
        if not page and dry:
            entry = {"id": s["id"], "name": s["name"], "state": "would create", "locales": locales}
            if waiting:
                entry["locales waiting for an app release"] = waiting
            if s["keywords"]:
                entry["keywords"] = {x: available(a, s, x, offered) for x in locales if texts(s, x)["keywords"]}
            report.append(entry)
            continue
        if not page:
            page = a.data("POST", "/v1/appCustomProductPages", body={
                "data": {"type": "appCustomProductPages", "attributes": {"name": s["name"]}, "relationships": {
                    "app": {"data": {"type": "apps", "id": a.APP}},
                    "appCustomProductPageVersions": {"data": [{"type": "appCustomProductPageVersions", "id": "${v}"}]}}},
                "included": [
                    {"type": "appCustomProductPageVersions", "id": "${v}", "relationships": {
                        "appCustomProductPageLocalizations": {"data": [{"type": "appCustomProductPageLocalizations", "id": "${l}"}]}}},
                    {"type": "appCustomProductPageLocalizations", "id": "${l}", "attributes": {"locale": "en-US", "promotionalText": s["promo"]}}]})
            print(f"{s['id']}: created page {page['id']}")
        version = latest(a, page["id"])
        state = version.get("attributes", {}).get("state")
        missing = [x for x in locales if x not in localizations(a, version)]
        new_version = state in ("ACCEPTED", "APPROVED") and missing
        if new_version and not dry:
            # an approved page doesn't take a new localization: its next version does, and goes to review
            version = a.data("POST", "/v1/appCustomProductPageVersions", body=a.resource("appCustomProductPageVersions",
                             appCustomProductPage={"type": "appCustomProductPages", "id": page["id"]}))
            state = version["attributes"].get("state")
            print(f"{s['id']}: new version {version['id']} for {', '.join(missing)}")
        if state not in REVIEWED and not dry:
            have = localizations(a, version)
            with tempfile.TemporaryDirectory() as tmp:
                rendered, sets, locs = {}, [], []
                for locale in locales:
                    t, own = texts(s, locale), locale if locale in s.get("localized", {}) else "en"
                    if own not in rendered:  # the English locales share one set
                        rendered[own] = render(s, os.path.join(tmp, own), locale)
                    loc = have.get(locale) or a.data("POST", "/v1/appCustomProductPageLocalizations", body=a.resource(
                        "appCustomProductPageLocalizations", attributes={"locale": locale, "promotionalText": t["promo"]},
                        appCustomProductPageVersion={"type": "appCustomProductPageVersions", "id": version["id"]}))
                    if loc["attributes"].get("promotionalText") != t["promo"]:
                        a.data("PATCH", f"/v1/appCustomProductPageLocalizations/{loc['id']}", body=a.resource("appCustomProductPageLocalizations", loc["id"], {"promotionalText": t["promo"]}))
                    sets += [x for display, shots in rendered[own].items() if (x := upload(a, loc["id"], display, shots))]
                    locs.append(loc)
            ready = processed(a, sets)
            for loc in locs:
                # before the review: a version in review most likely doesn't take keyword edits (assign_all reports them)
                if texts(s, loc["attributes"]["locale"])["keywords"]:
                    assign(a, s, loc, False, offered)
            if not ready:
                state = f"{state} (screenshots still processing; the next run sends it to review)"
            elif submit(a, version["id"]):
                state = "WAITING_FOR_REVIEW"
            else:
                state = f"{state} (review not started: another submission is open; the next run sends it)"
        entry = {"id": s["id"], "name": s["name"], "page": page["id"], "url": page["attributes"].get("url"), "state": state}
        if new_version and dry:
            entry["would make a new version, sent to review, for"] = missing
        if waiting:
            entry["locales waiting for an app release"] = waiting
        visible = page["attributes"].get("visible")
        if s["keywords"] and visible is False:
            # App Store search shows a page for its keywords only once it's approved and visible
            if dry:
                visible = "no (would make it visible)"
            else:
                done = a.api("PATCH", f"/v1/appCustomProductPages/{page['id']}", ok=(400, 403, 409, 422),
                             body=a.resource("appCustomProductPages", page["id"], {"visible": True}))
                visible = (done.get("data") or {}).get("attributes", {}).get("visible") or "no (Apple refused; the next run retries)"
        if visible is not None:
            entry["visible"] = visible
        if s["keywords"]:
            entry["keywords"] = assign_all(a, s, page["id"], dry, offered)
        report.append(entry)
    print(json.dumps(report, indent=1, ensure_ascii=False))
    if any("Apple refused" in x for entry in report for x in entry.get("keywords", {}).values()):
        sys.exit("Apple refused some keywords (above)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["render"] and len(args) == 3:
        s = spec(args[1])
        sets = [render(s, args[2])] + [render(s, os.path.join(args[2], x), x) for x in s["localized"]]
        print("\n".join(f for files in sets for fs in files.values() for f in fs))
    elif args[:1] == ["sync"]:
        sync("--dry-run" in args)
    else:
        sys.exit(__doc__)
