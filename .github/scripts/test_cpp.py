"""Checks for appstore/cpp.py sync (custom product pages): python3 -m unittest discover -s .github/scripts"""
import contextlib, io, os, sys, unittest
from unittest import mock

os.environ.setdefault("APP_STORE_APP_ID", "1")
os.environ.setdefault("ASC_KEY_ID", "KEY")
os.environ.setdefault("ASC_ISSUER_ID", "issuer")
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "appstore"))
import appstore, cpp

SPEC = {"id": "frog", "name": "Eat the frog", "promo": "Eat the frog first.", "shots": [("01-current", "One task")],
        "locales": ["en-US", "en-GB"], "keywords": ["eat the frog", "frog"]}


class FakeASC:
    """App Store Connect for cpp.sync: the live app version's locales and keywords, pages, their versions, localizations
    and keywords; records writes. `refuse` makes keyword assignments fail with that HTTP code (exiting as appstore.api
    does unless the caller allows it); `visible` is the existing pages' visibility, and new pages start hidden;
    `locks_review` moves submitted versions to WAITING_FOR_REVIEW and refuses keyword edits on versions in review (409)"""
    def __init__(self, live, keywords, pages=(), refuse=None, visible=None, locks_review=False):
        self.live, self.keywords, self.refuse, self.locks_review, self.queued = live, keywords, refuse, locks_review, []
        self.pages, self.versions, self.locs, self.writes, self.n = {}, {}, {}, [], 0
        for name, versions in pages:  # [(state, {locale: [keywords]})]
            page = self.page(name, visible)
            for state, locs in versions:
                v = self.version(page, state)
                for locale, kws in locs.items():
                    self.loc(v, locale, "Eat the frog first.", kws)

    def id(self, kind):
        self.n += 1
        return f"{kind}-{self.n}"

    def page(self, name, visible=False):
        p = self.id("page")
        self.pages[p] = {"id": p, "attributes": {"name": name, "url": f"https://apps/{p}"}}
        if visible is not None:
            self.pages[p]["attributes"]["visible"] = visible
        return p

    def version(self, page, state):
        v = self.id("ver")
        self.versions[v] = {"id": v, "page": page, "attributes": {"state": state, "version": str(sum(x["page"] == page for x in self.versions.values()) + 1)}}
        return v

    def loc(self, version, locale, promo, kws=()):
        i = self.id("loc")
        self.locs[i] = {"id": i, "version": version, "keywords": list(kws), "attributes": {"locale": locale, "promotionalText": promo}}
        return self.locs[i]

    def api(self, method, path, query=None, body=None, ok=()):
        query, parts = query or {}, path.strip("/").split("/")
        if method != "GET":
            self.writes.append((method, path, body))
        if path == "/v1/apps/1/appCustomProductPages":
            if method == "POST":
                p = self.page(body["data"]["attributes"]["name"])
                v = self.version(p, "PREPARE_FOR_SUBMISSION")
                self.loc(v, "en-US", body["included"][1]["attributes"]["promotionalText"])
                return {"data": self.pages[p]}
            return {"data": list(self.pages.values())}
        if parts[1] == "appCustomProductPages" and len(parts) == 3 and method == "PATCH":
            self.pages[parts[2]]["attributes"].update(body["data"]["attributes"])
            return {"data": self.pages[parts[2]]}
        if path == "/v1/appCustomProductPages" and method == "POST":
            return self.api("POST", "/v1/apps/1/appCustomProductPages", body=body)
        if path == "/v1/appStoreVersions/live/appStoreVersionLocalizations":
            return {"data": [{"attributes": {"locale": x}} for x in self.live]}
        if path == "/v1/apps/1/searchKeywords":
            return {"data": [{"id": k, "type": "appKeywords"} for k in self.keywords.get(query["filter[locale]"], [])]}
        if parts[1] == "appCustomProductPages" and parts[-1] == "appCustomProductPageVersions":
            return {"data": [v for v in self.versions.values() if v["page"] == parts[2]]}
        if path == "/v1/appCustomProductPageVersions" and method == "POST":
            v = self.version(body["data"]["relationships"]["appCustomProductPage"]["data"]["id"], "PREPARE_FOR_SUBMISSION")
            return {"data": self.versions[v]}
        if parts[1] == "appCustomProductPageVersions" and parts[-1] == "appCustomProductPageLocalizations":
            return {"data": [x for x in self.locs.values() if x["version"] == parts[2]]}
        if path == "/v1/appCustomProductPageLocalizations" and method == "POST":
            a, r = body["data"]["attributes"], body["data"]["relationships"]
            return {"data": self.loc(r["appCustomProductPageVersion"]["data"]["id"], a["locale"], a["promotionalText"])}
        if parts[-1] == "searchKeywords":
            loc = self.locs[parts[2]]
            refuse = self.refuse or (self.locks_review and self.versions[loc["version"]]["attributes"]["state"] in ("WAITING_FOR_REVIEW", "IN_REVIEW") and 409)
            if method == "POST" and refuse and refuse not in ok:
                raise SystemExit(f"POST {path}: {refuse}")
            if method == "POST" and not refuse:
                loc["keywords"] += [k["id"] for k in body["data"]]
            return {"data": [{"id": k, "type": "appKeywords"} for k in loc["keywords"]]} if method == "GET" else {}
        if parts[1] == "appCustomProductPageLocalizations" and method == "PATCH":
            self.locs[parts[2]]["attributes"].update(body["data"]["attributes"])
            return {"data": self.locs[parts[2]]}
        if path == "/v1/reviewSubmissions":
            return {"data": [] if method == "GET" else {"id": "sub"}}
        if path == "/v1/reviewSubmissionItems":
            self.queued.append(body["data"]["relationships"]["appCustomProductPageVersion"]["data"]["id"])
            return {"data": {"id": "ok"}}
        if path == "/v1/reviewSubmissions/sub":
            for v in self.queued if self.locks_review else []:
                self.versions[v]["attributes"]["state"] = "WAITING_FOR_REVIEW"
            return {"data": {"id": "ok"}}
        raise AssertionError(f"unexpected {method} {path}")

    def run(self, dry=False, spec=SPEC):
        out = io.StringIO()
        with mock.patch.object(appstore, "api", self.api), \
             mock.patch.object(appstore, "versions", lambda: [{"id": "live", "attributes": {"appStoreState": "READY_FOR_SALE"}}]), \
             mock.patch.object(cpp, "glob", mock.MagicMock(glob=lambda _: ["frog.md"])), \
             mock.patch.object(cpp, "spec", lambda _: spec), \
             mock.patch.object(cpp, "render", lambda s, tmp: {"APP_IPHONE_67": ["iphone-1.png"]}), \
             mock.patch.object(cpp, "upload", lambda a, loc, display, files: self.writes.append(("UPLOAD", loc, files)) or True), \
             contextlib.redirect_stdout(out):
            cpp.sync(dry)
        return out.getvalue()

    def keywords_of(self, locale):
        return {self.versions[x["version"]]["attributes"]["version"]: x["keywords"] for x in self.locs.values() if x["attributes"]["locale"] == locale}


class Sync(unittest.TestCase):
    def test_new_page_takes_the_keywords_the_live_version_has(self):
        # 2.2.11: only en-US, with "eat the frog" as one keyword and no "frog"
        asc = FakeASC(["en-US", "ru"], {"en-US": ["todo", "eat the frog"], "ru": ["задачи"]})
        out = asc.run()
        self.assertEqual(asc.keywords_of("en-US"), {"1": ["eat the frog"]})
        self.assertEqual(asc.keywords_of("en-GB"), {}, "en-GB isn't on the live version, so the page can't have it yet")
        self.assertIn('"locales waiting for an app release": [\n   "en-GB"', out)
        self.assertIn('"not in the app\'s keywords": [\n     "frog"\n', out)
        self.assertEqual([w[1] for w in asc.writes if w[0] == "UPLOAD"], ["loc-3"])
        self.assertIn(("PATCH", "/v1/reviewSubmissions/sub"), [w[:2] for w in asc.writes])

    def test_approved_page_gets_a_new_version_for_a_new_locale_and_the_new_keywords(self):
        # the next release: en-GB, and "eat" + "frog" instead of "eat the frog"
        asc = FakeASC(["en-US", "en-GB"], {"en-US": ["eat", "frog"], "en-GB": ["eat", "frog", "focus"]},
                      pages=[("Eat the frog", [("APPROVED", {"en-US": ["eat the frog"]})])])
        asc.run()
        self.assertIn("/v1/appCustomProductPageVersions", [w[1] for w in asc.writes if w[0] == "POST"])
        self.assertEqual(asc.keywords_of("en-US"), {"1": ["eat the frog", "frog"], "2": ["frog"]})
        self.assertEqual(asc.keywords_of("en-GB"), {"2": ["frog"]})
        self.assertEqual(sorted(asc.locs[w[1]]["attributes"]["locale"] for w in asc.writes if w[0] == "UPLOAD"), ["en-GB", "en-US"])

    def test_keywords_land_before_the_review_locks_the_version(self):
        for live, kws, pages, want in (
                (["en-US"], {"en-US": ["eat the frog"]}, [], {"en-US": {"1": ["eat the frog"]}}),
                (["en-US", "en-GB"], {"en-US": ["eat", "frog"], "en-GB": ["frog"]}, [("Eat the frog", [("APPROVED", {"en-US": ["eat the frog"]})])],
                 {"en-US": {"1": ["eat the frog", "frog"], "2": ["frog"]}, "en-GB": {"2": ["frog"]}})):
            asc = FakeASC(live, kws, pages=pages, locks_review=True)
            out = asc.run()
            self.assertEqual({x: asc.keywords_of(x) for x in want}, want)
            writes = [w[0] + " " + w[1] for w in asc.writes]
            submitted = writes.index("PATCH /v1/reviewSubmissions/sub")
            self.assertTrue(all(i < submitted for i, w in enumerate(writes) if w.endswith("searchKeywords") and "loc-" in w
                                and asc.versions[asc.locs[w.split("/")[3]]["version"]]["attributes"]["version"] == str(len(pages) + 1)))
            self.assertNotIn("refused", out)

    def test_a_refusal_on_an_older_approved_version_does_not_fail_the_run(self):
        asc = FakeASC(["en-US", "en-GB"], {"en-US": ["frog"], "en-GB": ["frog"]}, refuse=409,
                      pages=[("Eat the frog", [("APPROVED", {"en-US": []}), ("WAITING_FOR_REVIEW", {"en-US": [], "en-GB": []})])])
        out = asc.run()
        self.assertIn('"en-US v1": {\n    "assigned": [],\n    "refused on this older version (the newer one in progress replaces it)": [\n     "frog"', out)
        self.assertIn('"refused before approval (the next run retries)"', out)
        self.assertNotIn("Apple refused", out)

    def test_page_in_review_only_gets_keywords(self):
        asc = FakeASC(["en-US"], {"en-US": ["eat the frog"]}, pages=[("Eat the frog", [("WAITING_FOR_REVIEW", {"en-US": []})])])
        asc.run()
        self.assertEqual([w[0] + " " + w[1] for w in asc.writes], ["POST /v1/appCustomProductPageLocalizations/loc-3/relationships/searchKeywords"])
        self.assertEqual(asc.keywords_of("en-US"), {"1": ["eat the frog"]})

    def test_dry_run_writes_nothing(self):
        for pages in ([], [("Eat the frog", [("APPROVED", {"en-US": []})])]):
            asc = FakeASC(["en-US", "en-GB"], {"en-US": ["eat the frog"], "en-GB": ["frog"]}, pages=pages)
            out = asc.run(dry=True)
            self.assertEqual(asc.writes, [])
            self.assertIn("would create" if not pages else "would assign", out)

    def test_dry_run_reports_the_new_version(self):
        asc = FakeASC(["en-US", "en-GB"], {"en-US": ["frog"]}, pages=[("Eat the frog", [("APPROVED", {"en-US": []})])])
        out = asc.run(dry=True)
        self.assertEqual(asc.writes, [])
        self.assertIn('"would make a new version, sent to review, for": [\n   "en-GB"', out)

    def test_a_refused_keyword_fails_the_run_after_every_page(self):
        for code in (409, 422, 400, 403):
            asc = FakeASC(["en-US"], {"en-US": ["eat the frog"]}, pages=[("Eat the frog", [("APPROVED", {"en-US": []})])], refuse=code)
            with self.assertRaises(SystemExit) as e:
                asc.run()
            self.assertEqual(str(e.exception), "Apple refused some keywords (above)", code)

    def test_a_refusal_before_approval_waits_for_the_next_run(self):
        asc = FakeASC(["en-US"], {"en-US": ["eat the frog"]}, pages=[("Eat the frog", [("WAITING_FOR_REVIEW", {"en-US": []})])], refuse=422)
        out = asc.run()
        self.assertIn('"refused before approval (the next run retries)": [\n     "eat the frog"', out)

    def test_a_page_with_keywords_is_made_visible(self):
        asc = FakeASC(["en-US"], {"en-US": ["eat the frog"]})
        out = asc.run()
        self.assertTrue(asc.pages["page-1"]["attributes"]["visible"])
        self.assertIn('"visible": true', out)
        asc = FakeASC(["en-US"], {"en-US": ["eat the frog"]}, pages=[("Eat the frog", [("APPROVED", {"en-US": []})])], visible=False)
        self.assertIn('"visible": "no (would make it visible)"', asc.run(dry=True))
        self.assertEqual(asc.writes, [])

    def test_pages_without_keywords_or_locales_work_as_before(self):
        asc = FakeASC(["en-US"], {}, pages=[("Ads: one task at a time", [("PREPARE_FOR_SUBMISSION", {"en-US": []})])], visible=False)
        spec = dict(SPEC, name="Ads: one task at a time", locales=["en-US"], keywords=[], promo="New text.")
        out = asc.run(spec=spec)
        self.assertNotIn("keywords", out)
        self.assertEqual(asc.locs["loc-3"]["attributes"]["promotionalText"], "New text.")
        self.assertFalse([w for w in asc.writes if w[1].endswith("searchKeywords") or w[1].startswith("/v1/appCustomProductPages/")])


class Spec(unittest.TestCase):
    def test_frog_spec(self):
        s = cpp.spec(os.path.join(cpp.HERE, "cpp", "frog.md"))
        self.assertEqual((s["name"], s["locales"], s["keywords"]), ("Eat the frog", ["en-US", "en-GB"], ["eat the frog", "frog"]))
        self.assertEqual([x for x, _ in s["shots"]][:3], ["frog/02-planning", "frog/01-current", "frog/06-rules"])
        for shot, _ in s["shots"]:
            for folder, _ in cpp.DISPLAYS.values():
                self.assertTrue(os.path.exists(os.path.join(cpp.SHOTS, folder, shot + ".png")), f"{folder}/{shot}")

    def test_specs_without_the_new_sections(self):
        s = cpp.spec(os.path.join(cpp.HERE, "cpp", "one-task.md"))
        self.assertEqual((s["locales"], s["keywords"]), (["en-US"], []))


if __name__ == "__main__":
    unittest.main()
