#!/usr/bin/env python3
"""Print the download URL of a GitHub release asset: gh_asset.py OWNER/REPO TAG REGEX  (TAG "latest" allowed)."""
import json, re, sys, urllib.request
repo, tag, pat = sys.argv[1:4]
api = "https://api.github.com/repos/%s/releases/%s" % (repo, "latest" if tag == "latest" else "tags/" + tag)
with urllib.request.urlopen(urllib.request.Request(api, headers={"Accept": "application/vnd.github+json"}), timeout=30) as r:
    rel = json.load(r)
hits = [a["browser_download_url"] for a in rel.get("assets", []) if re.search(pat, a["name"])]
if not hits:
    sys.exit("no asset matching %r in %s %s" % (pat, repo, tag))
print(hits[0])
