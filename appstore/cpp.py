#!/usr/bin/env python3
"""Custom product pages (CPPs) for ad variants: Apple Search Ads shows a CPP's first screenshots instead of the default
page's, so each angle Radiant tests (prime-radiant experiments/2026-10-28-todorant-search-ads.md) is one CPP here.

One spec per page: appstore/cpp/<id>.md, with sections "## Name" (the page's name in App Store Connect),
"## Promotional text" and "## Screenshots", one "<screenshot>: <caption>" line per screenshot in order, where
<screenshot> is a file in ios/screenshots/en/iphone-6.9 (and ipad-13). The screenshots are rendered here, on the fly:
the caption on Todorant's orange, above the whole, unclipped screenshot.

  cpp.py render <spec.md> <out dir>     renders iphone-*.png (1320x2868) and ipad-*.png (2064x2752)
  cpp.py sync [--dry-run]               for every spec: creates the page in App Store Connect if it's missing (en-US
                                        promotional text and both screenshot sets), then sends it to App Review; prints
                                        each page's state. Safe to run again: done steps are skipped, and a page whose
                                        review couldn't start (another submission is open) is sent on the next run.
  env (sync): as for .github/scripts/appstore.py (APP_STORE_APP_ID, ASC_KEY_ID, ASC_ISSUER_ID, API_PRIVATE_KEYS_DIR)
"""
import glob, hashlib, json, os, re, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "ios", "screenshots", "en")
FONT = os.path.join(HERE, "cpp", "Inter-ExtraBold.ttf")
# display type -> (folder in ios/screenshots/en, canvas size)
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
         "shots": [tuple(x.strip() for x in line.split(":", 1)) for line in out["Screenshots"]]}
    assert len(s["promo"]) <= 170 and len(s["name"]) <= 70 and s["shots"], f"{path}: name, promotional text or screenshots"
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
    """Makes the page's set for this display exactly these files (same steps as listings.py upload_screenshots)."""
    sets = {x["attributes"]["screenshotDisplayType"]: x for x in a.data("GET", f"/v1/appCustomProductPageLocalizations/{localization}/appScreenshotSets")}
    if display in sets:
        old = a.data("GET", f"/v1/appScreenshotSets/{sets[display]['id']}/appScreenshots")
        if [x["attributes"].get("sourceFileChecksum") for x in old] == [hashlib.md5(open(f, "rb").read()).hexdigest() for f in files]:
            return
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
    for _ in range(60):
        states = [(x["attributes"].get("assetDeliveryState") or {}).get("state") for x in a.data("GET", f"/v1/appScreenshotSets/{shot_set}/appScreenshots")]
        if "FAILED" in states:
            sys.exit(f"Apple couldn't process a screenshot: {states}")
        if all(x == "COMPLETE" for x in states):
            return
        time.sleep(10)
    sys.exit("The screenshots weren't processed within 10 minutes")


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


def sync(dry):
    sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))
    import appstore as a
    pages = {p["attributes"]["name"]: p for p in a.data("GET", f"/v1/apps/{a.APP}/appCustomProductPages", {"limit": 200}) or []}
    report = []
    for path in sorted(glob.glob(os.path.join(HERE, "cpp", "*.md"))):
        s = spec(path)
        page = pages.get(s["name"])
        if not page and dry:
            report.append({"id": s["id"], "name": s["name"], "state": "would create"})
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
        version = (a.data("GET", f"/v1/appCustomProductPages/{page['id']}/appCustomProductPageVersions") or [{}])[-1]
        state = version.get("attributes", {}).get("state")
        if state not in REVIEWED and not dry:
            loc = a.data("GET", f"/v1/appCustomProductPageVersions/{version['id']}/appCustomProductPageLocalizations")[0]
            if loc["attributes"].get("promotionalText") != s["promo"]:
                a.data("PATCH", f"/v1/appCustomProductPageLocalizations/{loc['id']}", body=a.resource("appCustomProductPageLocalizations", loc["id"], {"promotionalText": s["promo"]}))
            with tempfile.TemporaryDirectory() as tmp:
                for display, files in render(s, tmp).items():
                    upload(a, loc["id"], display, files)
            state = "WAITING_FOR_REVIEW" if submit(a, version["id"]) else f"{state} (review not started: another submission is open; the next run sends it)"
        report.append({"id": s["id"], "name": s["name"], "page": page["id"], "url": page["attributes"].get("url"), "state": state})
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["render"] and len(args) == 3:
        print("\n".join(f for fs in render(spec(args[1]), args[2]).values() for f in fs))
    elif args[:1] == ["sync"]:
        sync("--dry-run" in args)
    else:
        sys.exit(__doc__)
