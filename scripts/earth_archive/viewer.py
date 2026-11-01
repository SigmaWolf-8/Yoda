"""Loopback-only archive distribution; never exposes config, credentials or .part files."""
import html
import json
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs,unquote,quote
from client import database,get,status

def serve(root):
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def reply(self,body,content_type="application/json"):
            self.send_response(200)
            self.send_header("Content-Type",content_type)
            self.send_header("Content-Length",str(len(body)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            request=urlsplit(self.path)
            db=database(root)
            try:
                if request.path=="/status":
                    self.reply(json.dumps(get(db,"status",status(db))).encode())
                elif request.path=="/manifest.json":
                    self.send_response(200)
                    self.send_header("Content-Type","application/json")
                    self.send_header("Content-Disposition",'attachment; filename="native-archive-manifest.json"')
                    self.end_headers()
                    self.wfile.write(b'{"schema":1,"coverage":"GLOBAL","survey_grade":false,"objects":[')
                    first=True
                    for row in db.execute("SELECT source,key,url,size,validator,state,sha256 FROM objects WHERE active=1 ORDER BY source,key"):
                        self.wfile.write((b"" if first else b",")+json.dumps(dict(row)).encode())
                        first=False
                    self.wfile.write(b"]}")
                elif request.path=="/":
                    page=max(0,min(int(parse_qs(request.query).get("page",["0"])[0]),1000000))
                    rows=db.execute("SELECT source,key,size,sha256 FROM objects WHERE active=1 AND state='verified' ORDER BY source,key LIMIT 100 OFFSET ?",(page*100,)).fetchall()
                    links="".join(f'<li><a href="/data/{quote(r["source"]+"/"+r["key"])}" download>{html.escape(r["source"]+"/"+r["key"])}</a> ({r["size"]} bytes)<br><code>{r["sha256"]}</code></li>' for r in rows)
                    text=f"""<!doctype html><meta charset="utf-8"><title>Yoda Windows native archive</title>
                    <style>body{{background:#12110f;color:#eee;font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}}a{{color:#e7bc72}}li{{margin:18px 0;overflow-wrap:anywhere}}pre{{white-space:pre-wrap}}</style>
                    <h1>Windows native-resolution archive</h1><p>GLOBAL · local bytes only · no survey certification.</p>
                    <p><a href="/engine/isopsephy_amd_v0_0_20.html">Open supplied Isopsephy & Earth instrument</a> ·
                    <a href="/manifest.json">Export full source/hash manifest</a></p>
                    <p>The instrument remains cartographic T1. Acquiring native files does not yet wire them into that renderer or complete T5.</p>
                    <pre>{html.escape(json.dumps(get(db,"status",status(db)),indent=2))}</pre>
                    <h2>Verified local files · page {page+1}</h2><ul>{links or "<li>No verified local files yet.</li>"}</ul>
                    <a href="/?page={max(0,page-1)}">Previous</a> · <a href="/?page={page+1}">Next</a>"""
                    self.reply(text.encode(),"text/html; charset=utf-8")
                elif request.path.startswith("/data/"):
                    relative=unquote(request.path[6:])
                    source,sep,key=relative.partition("/")
                    row=db.execute("SELECT size,mtime FROM objects WHERE source=? AND key=? AND state='verified'",(source,key)).fetchone()
                    file=root/"data"/relative
                    if not sep or not row or not file.resolve().is_relative_to((root/"data").resolve()) or not file.is_file() or file.stat().st_size!=row["size"] or file.stat().st_mtime_ns!=row["mtime"]:
                        self.send_error(404,"No verified local object")
                        return
                    self.send_file(file)
                elif request.path.startswith("/engine/"):
                    engine=get(db,"engine")
                    if not engine:
                        self.send_error(404,"Engine not downloaded")
                        return
                    directory=root/"engines"/engine["sha256"]/"isopsephy_package"
                    file=directory/unquote(request.path[8:])
                    if not file.resolve().is_relative_to(directory.resolve()) or not file.is_file():
                        self.send_error(404)
                        return
                    self.send_file(file)
                else:
                    self.send_error(404)
            except (ValueError,OSError):
                self.send_error(400)
            finally:
                db.close()
        def send_file(self,file):
            self.send_response(200)
            self.send_header("Content-Type",self.guess_type(str(file)))
            self.send_header("Content-Length",str(file.stat().st_size))
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'")
            self.end_headers()
            with file.open("rb") as stream:
                self.copyfile(stream,self.wfile)
    server=ThreadingHTTPServer(("127.0.0.1",18482),Handler)
    print("Windows archive viewer: http://127.0.0.1:18482 (loopback only)")
    server.serve_forever()
