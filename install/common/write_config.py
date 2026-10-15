#!/usr/bin/env python3
"""Write/refresh bridge.json for a local install: write_config.py HOME APP_PORT WRITER_PORT WRITER_MODEL [IMAGE_PORT]"""
import json, os, secrets, sys
home, app, wport, wmodel = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
iport = int(sys.argv[5]) if len(sys.argv) > 5 else 11439
p = os.path.join(home, "bridge.json")
cfg = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {}
cfg.setdefault("token", secrets.token_urlsafe(32))
cfg.update(server="http://127.0.0.1:%d" % app, engine_dir=os.path.join(home, "engine", "acestep.cpp"),
           engine_conf=os.path.join(home, "engine.conf"), writer_url="http://127.0.0.1:%s" % wport, image_port=iport)
cfg.setdefault("writer_model", wmodel)
tmp = p + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
os.replace(tmp, p)
print("bridge.json ready")
