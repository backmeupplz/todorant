#!/usr/bin/env python3
"""Sends an uploaded build to App Review, released automatically once approved (CI: .github/workflows/ios-release.yml).
A newer release replaces an older one still in review: its submission is cancelled and its version takes the new number.
   submit.py <version> <build number> <release notes file>
   env ASC_KEY_ID, ASC_ISSUER_ID; the key is read from ~/.appstoreconnect/private_keys/AuthKey_<id>.p8. Needs PyJWT[crypto]."""
import json, os, sys, time, urllib.error, urllib.request
from urllib.parse import urlencode

import jwt

APP = "1482078243"
# States where a version can still take a new build and number
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}
OPEN = ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"]
REVIEWING = {"WAITING_FOR_REVIEW", "IN_REVIEW"}

version, build_number, notes_file = sys.argv[1:4]
notes = open(notes_file).read().strip()[:4000]
KEY_ID, ISSUER = os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"]
P8 = open(os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")).read()


def api(method, path, query=None, body=None, ok=()):
    now = int(time.time())
    token = jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}, P8, "ES256", headers={"kid": KEY_ID})
    url = "https://api.appstoreconnect.apple.com" + path + ("?" + urlencode(query) if query else "")
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code in ok:
            return {}
        sys.exit(f"{method} {path}: {e.code} {e.read().decode()}")


def data(method, path, query=None, **kw):
    return api(method, path, query, **kw).get("data")


def resource(kind, id=None, attributes=None, **relationships):
    d = {"type": kind}
    if id: d["id"] = id
    if attributes: d["attributes"] = attributes
    if relationships: d["relationships"] = {k: {"data": v} for k, v in relationships.items()}
    return {"data": d}


# Processing takes a few minutes to half an hour after the upload
for attempt in range(120):
    builds = data("GET", "/v1/builds", {"filter[app]": APP, "filter[version]": build_number, "filter[preReleaseVersion.version]": version})
    state = builds[0]["attributes"]["processingState"] if builds else "NOT_FOUND"
    if state == "VALID": break
    if state in ("FAILED", "INVALID"): sys.exit(f"Build {version} ({build_number}) is {state}")
    print(f"Build {version} ({build_number}): {state}, waiting")
    time.sleep(30)
else:
    sys.exit("The build didn't finish processing within an hour")
build = {"type": "builds", "id": builds[0]["id"]}

# Older submissions still waiting or in review are replaced by this one: cancelling hands their version back for editing
for submission in data("GET", "/v1/reviewSubmissions", {"filter[app]": APP, "filter[platform]": "IOS", "filter[state]": ",".join(OPEN)}):
    print(f"Cancelling the {submission['attributes']['state']} submission {submission['id']}")
    data("PATCH", f"/v1/reviewSubmissions/{submission['id']}", body=resource("reviewSubmissions", submission["id"], {"canceled": True}))


def editable_version():
    versions = data("GET", f"/v1/apps/{APP}/appStoreVersions", {"filter[platform]": "IOS", "limit": 5})
    return next((v for v in versions if v["attributes"]["appStoreState"] in EDITABLE), None), versions


# Cancelling takes a moment to reach the version
for attempt in range(40):
    current, versions = editable_version()
    if current or not any(v["attributes"]["appStoreState"] in REVIEWING for v in versions): break
    time.sleep(15)

# App Store Connect has one editable version at a time: reuse it under the new number, or start one
if current:
    print(f"Version {current['attributes']['versionString']} ({current['attributes']['appStoreState']}) becomes {version}")
    attributes = {"versionString": version} if current["attributes"]["versionString"] != version else None
    data("PATCH", f"/v1/appStoreVersions/{current['id']}", body=resource("appStoreVersions", current["id"], attributes, build=build))
else:
    print(f"Creating version {version}")
    current = data("POST", "/v1/appStoreVersions", body=resource(
        "appStoreVersions", attributes={"platform": "IOS", "versionString": version, "releaseType": "AFTER_APPROVAL"},
        app={"type": "apps", "id": APP}, build=build))

# ponytail: the same (English) notes for every language; per-language notes need a notes file per locale
for localization in data("GET", f"/v1/appStoreVersions/{current['id']}/appStoreVersionLocalizations"):
    data("PATCH", f"/v1/appStoreVersionLocalizations/{localization['id']}",
         body=resource("appStoreVersionLocalizations", localization["id"], {"whatsNew": notes}))

# A draft submission (never sent) is reused; adding a version it already holds is a 409
drafts = data("GET", "/v1/reviewSubmissions", {"filter[app]": APP, "filter[platform]": "IOS", "filter[state]": "READY_FOR_REVIEW"})
submission = drafts[0] if drafts else data("POST", "/v1/reviewSubmissions", body=resource(
    "reviewSubmissions", attributes={"platform": "IOS"}, app={"type": "apps", "id": APP}))
data("POST", "/v1/reviewSubmissionItems", body=resource(
    "reviewSubmissionItems", reviewSubmission={"type": "reviewSubmissions", "id": submission["id"]},
    appStoreVersion={"type": "appStoreVersions", "id": current["id"]}), ok=(409,))
data("PATCH", f"/v1/reviewSubmissions/{submission['id']}", body=resource("reviewSubmissions", submission["id"], {"submitted": True}))
print(f"{version} ({build_number}) is waiting for review")
