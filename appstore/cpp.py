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

  cpp.py render <spec.md> <out dir>     renders iphone-*.png (1320x2868) and ipad-*.png (2064x2752)
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
import glob, hashlib, json, os, re, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(HERE, "cpp", "shots")  # the raw English screenshots from ios/tour.sh, kept here since the store set is framed
FONT = os.path.join(HERE, "cpp", "Inter-ExtraBold.ttf")
# display type -> (folder in appstore/cpp/shots, canvas size)
DISPLAYS = {"APP_IPHONE_67": ("iphone-6.9", (1320, 2868)), "APP_IPAD_PRO_3GEN_129": ("ipad-13", (2064, 2752))}
ORANGE = ((255, 95, 19), (255, 138, 83))  # todorant.com's gradient, top to bottom
REVIEWED = {"WAITING_FOR_REVIEW", "IN_REVIEW", "ACCEPTED", "APPROVED", "REPLACED_WITH_NEW_VERSION"}


def spec(path):
    out, name = {}, None
    for line in open(path, encoding="utf-8").read().split("\n"):
        m = re.match(r"^## (.+?)(?: \(max \d+\))?$", line)
        if m:
            name, out[m[1]] = m[1], []
        elif name and line.strip():
            out[name].append(line.strip())
    s = {"id": os.path.basename(path)[:-3], "name": " ".join(out["Name"]), "promo": " ".join(out["Promotional text"]),
         "shots": [tuple(x.strip() for x in line.split(":", 1)) for line in out["Screenshots"]],
         "locales": ["en-US"] + [x for line in out.get("Locales", []) for x in re.split(r"[,\s]+", line) if x and x != "en-US"],
         "keywords": [x.strip() for line in out.get("Keywords", []) for x in line.split(",") if x.strip()]}
    assert len(s["promo"]) <= 170 and len(s["name"]) <= 70 and s["shots"], f"{path}: name, promotional text or screenshots"
    assert all(x.startswith("en-") for x in s["locales"]), f"{path}: its screenshots and texts are English, so are its locales"
    return s


def render(s, out):
    """One PNG per screenshot and display: the caption as large as fits in at most 3 lines, the screenshot whole below it."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    os.makedirs(out, exist_ok=True)
    files = {}
    for display, (folder, (w, h)) in DISPLAYS.items():
        files[display] = []
        side, top = round(w * 0.08), round(h * 0.07)
        size = min(fit(caption, w - 2 * side, round(min(w * 0.1, h * 0.046))) for _, caption in s["shots"])  # one size per set
        font = ImageFont.truetype(FONT, size)
        for i, (shot, caption) in enumerate(s["shots"], 1):
            img = Image.new("RGB", (w, h))
            px = ImageDraw.Draw(img)
            for y in range(h):  # vertical gradient
                t = y / (h - 1)
                px.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(*ORANGE)))
            lines = wrap(caption, font, w - 2 * side)
            step = round(size * 1.18)
            for n, line in enumerate(lines):
                lw = font.getlength(line)
                px.text(((w - lw) / 2, top + n * step), line, font=font, fill="white")
            text_bottom = top + len(lines) * step
            src = Image.open(os.path.join(SHOTS, folder, shot + ".png")).convert("RGB")
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


def fit(caption, width, start):
    """The largest font size, from `start` down, that sets the caption in at most 3 lines."""
    from PIL import ImageFont
    for size in range(start, 40, -2):
        if len(wrap(caption, ImageFont.truetype(FONT, size), width)) <= 3:
            return size
    sys.exit(f"caption too long: {caption}")


def wrap(text, font, width):
    lines = [""]
    for word in text.split():
        cand = (lines[-1] + " " + word).strip()
        if font.getlength(cand) <= width or not lines[-1]:
            lines[-1] = cand
        else:
            lines.append(word)
    return lines if all(font.getlength(line) <= width for line in lines) else lines * 4  # a word wider than the line: too big


def upload(a, localization, display, files):
    """Makes the page's set for this display exactly these files (same steps as listings.py upload_screenshots).
    Returns whether Apple has processed them all; one still processing is left for the next run."""
    sets = {x["attributes"]["screenshotDisplayType"]: x for x in a.data("GET", f"/v1/appCustomProductPageLocalizations/{localization}/appScreenshotSets")}
    if display in sets:
        old = a.data("GET", f"/v1/appScreenshotSets/{sets[display]['id']}/appScreenshots")
        if [x["attributes"].get("sourceFileChecksum") for x in old] == [hashlib.md5(open(f, "rb").read()).hexdigest() for f in files]:
            states = [(x["attributes"].get("assetDeliveryState") or {}).get("state") for x in old]
            if "FAILED" not in states:
                return all(x == "COMPLETE" for x in states)
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
    for _ in range(90):
        states = [(x["attributes"].get("assetDeliveryState") or {}).get("state") for x in a.data("GET", f"/v1/appScreenshotSets/{shot_set}/appScreenshots")]
        if "FAILED" in states:
            sys.exit(f"Apple couldn't process a screenshot: {states}")
        if all(x == "COMPLETE" for x in states):
            return True
        time.sleep(10)
    print(f"  {display}: Apple is still processing the screenshots ({states}); the next run submits the page")
    return False


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
    """The spec's keywords that the app's latest approved version has in this locale (Apple's ids), and the others"""
    if locale not in offered:
        offered[locale] = {k["id"].lower(): k["id"] for k in a.data("GET", f"/v1/apps/{a.APP}/searchKeywords",
                           {"filter[locale]": locale, "filter[platform]": "IOS", "limit": 200}) or []}
    out = {"assignable": [offered[locale][k.lower()] for k in s["keywords"] if k.lower() in offered[locale]]}
    if len(out["assignable"]) < len(s["keywords"]):
        out["not in the app's keywords"] = [k for k in s["keywords"] if k.lower() not in offered[locale]]
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
                entry["keywords"] = {x: available(a, s, x, offered) for x in locales}
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
                files = render(s, tmp)
                ready, locs = True, []
                for locale in locales:
                    loc = have.get(locale) or a.data("POST", "/v1/appCustomProductPageLocalizations", body=a.resource(
                        "appCustomProductPageLocalizations", attributes={"locale": locale, "promotionalText": s["promo"]},
                        appCustomProductPageVersion={"type": "appCustomProductPageVersions", "id": version["id"]}))
                    if loc["attributes"].get("promotionalText") != s["promo"]:
                        a.data("PATCH", f"/v1/appCustomProductPageLocalizations/{loc['id']}", body=a.resource("appCustomProductPageLocalizations", loc["id"], {"promotionalText": s["promo"]}))
                    ready = all([upload(a, loc["id"], display, shots) for display, shots in files.items()]) and ready
                    locs.append(loc)
            for loc in locs if s["keywords"] else []:
                # before the review: a version in review most likely doesn't take keyword edits (assign_all reports them)
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
        print("\n".join(f for fs in render(spec(args[1]), args[2]).values() for f in fs))
    elif args[:1] == ["sync"]:
        sync("--dry-run" in args)
    else:
        sys.exit(__doc__)
