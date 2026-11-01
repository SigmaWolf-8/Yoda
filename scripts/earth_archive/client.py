"""Windows global archive runner. No resampling, fabricated terrain or certification."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.request
import uuid
import zipfile
from acquire import copernicus, gebco, egm2008, download, hashes, open_url, safe_key, RESERVE

def utc():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

def database(root):
    private=root/".yoda-earth"
    private.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(private/"inventory.sqlite")
    db.row_factory=sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS objects(
        source TEXT, key TEXT, url TEXT, size INTEGER, validator TEXT, md5 TEXT,
        epoch TEXT, active INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'pending',
        sha256 TEXT, mtime INTEGER, error TEXT, PRIMARY KEY(source,key));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
    """)
    return db

def put(db,key,value):
    db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)",(key,json.dumps(value)))
    db.commit()

def get(db,key,default=None):
    row=db.execute("SELECT value FROM meta WHERE key=?",(key,)).fetchone()
    return json.loads(row[0]) if row else default

@contextlib.contextmanager
def lock(root):
    path=root/".yoda-earth"/"worker.lock"
    stream=path.open("a+b")
    try:
        if os.name=="nt":
            import msvcrt
            stream.seek(0)
            stream.write(b"\0")
            stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:
        stream.close()

def inventory(db,notify):
    source_status={}
    for name,loader in (("copernicus",copernicus),("gebco",gebco),("egm2008",egm2008)):
        epoch=str(uuid.uuid4())
        count=0
        try:
            for item in loader():
                db.execute("""INSERT INTO objects(source,key,url,size,validator,md5,epoch)
                    VALUES(:source,:key,:url,:size,:validator,:md5,:epoch)
                    ON CONFLICT(source,key) DO UPDATE SET
                    state=CASE WHEN objects.validator=excluded.validator AND objects.size=excluded.size THEN objects.state ELSE 'pending' END,
                    url=excluded.url,size=excluded.size,validator=excluded.validator,md5=excluded.md5,
                    epoch=excluded.epoch,active=1""",{**item,"epoch":epoch})
                count+=1
                if count%100==0:
                    db.commit()
                    notify("inventory",f"Reading {name} catalogue")
            if count==0:
                raise ValueError("Source catalogue is empty")
            db.execute("UPDATE objects SET active=0 WHERE source=? AND epoch<>?",(name,epoch))
            db.commit()
            source_status[name]={"complete":True,"objects":count,"at":utc()}
        except Exception as error:
            db.commit()
            source_status[name]={"complete":False,"objects":count,"error_type":type(error).__name__,"at":utc()}
            print(f"{name} inventory failed: {error}",file=sys.stderr)
        put(db,"sources",source_status)
        notify("inventory",f"{name} catalogue attempt finished")
    put(db,"inventory_at",time.time())

def status(db,phase=None,message=None):
    row=db.execute("""SELECT count(*) AS objects,coalesce(sum(size),0) AS bytes,
        coalesce(sum(CASE WHEN state='verified' THEN 1 ELSE 0 END),0) AS verified,
        coalesce(sum(CASE WHEN state='verified' THEN size ELSE 0 END),0) AS verified_bytes,
        coalesce(sum(CASE WHEN state='error' THEN 1 ELSE 0 END),0) AS failures
        FROM objects WHERE active=1""").fetchone()
    sources=get(db,"sources",{})
    complete=set(sources)=={"copernicus","gebco","egm2008"} and all(s["complete"] for s in sources.values())
    previous=get(db,"status",{})
    return {"phase":phase or previous.get("phase","not_started"),"message":message if message is not None else previous.get("message",""),
        "catalog_complete":complete,"catalog_objects":row["objects"],"catalog_bytes":row["bytes"],
        "verified_objects":row["verified"],"verified_bytes":row["verified_bytes"],"failures":row["failures"],
        "archive_complete":complete and row["objects"]>0 and row["objects"]==row["verified"],
        "engine_ready":bool(get(db,"engine")),"reported_at":utc(),"sources":sources,
        "survey_grade":False,"native_data_renderer_integrated":False,
        "integrity_scope":"SHA-256 at acquisition; cached files checked by size/mtime unless --verify is requested"}

def sync_engine(root,db,base):
    with open_url(base+"/capomastro/engines/arc182/provenance.json") as response:
        manifest=json.loads(response.read(1_000_000))
    digest=manifest["archiveSha256"]
    if len(digest)!=64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Invalid engine package hash")
    engines=root/"engines"
    engines.mkdir(exist_ok=True)
    archive_path=engines/(digest+".zip")
    folder=engines/digest
    if not archive_path.exists() or hashes(archive_path)[0]!=digest or not folder.exists():
        with open_url(base+"/capomastro/engines/arc182/complete-package.zip") as response:
            data=response.read(20_000_001)
        if len(data)>20_000_000 or hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError("Engine package hash/size check failed")
        archive_path.write_bytes(data)
        with tempfile.TemporaryDirectory(dir=engines) as temporary:
            temporary=Path(temporary)
            with zipfile.ZipFile(archive_path) as archive:
                if sum(i.file_size for i in archive.infolist())>50_000_000:
                    raise ValueError("Expanded engine package exceeds limit")
                for info in archive.infolist():
                    name=safe_key(info.filename.rstrip("/"))
                    if not name.startswith("isopsephy_package/") and name!="isopsephy_package":
                        raise ValueError("Unexpected engine package root")
                    if (info.external_attr>>16)&0o170000==0o120000:
                        raise ValueError("Package symlinks are not allowed")
                archive.extractall(temporary)
            for item in manifest["files"]:
                source=temporary/"isopsephy_package"/safe_key(item["path"])
                if hashes(source)[0]!=item["sha256"]:
                    raise ValueError("Engine member hash mismatch")
            if folder.exists():
                shutil.rmtree(folder)  # Only this content-addressed, managed engine directory.
            temporary.rename(folder)
    put(db,"engine",{"sha256":digest,"at":utc()})

def run(args):
    root=Path(args.target).resolve()
    root.mkdir(parents=True,exist_ok=True)
    db=database(root)
    config=json.loads((root/".yoda-earth"/"config.json").read_text(encoding="utf-8-sig"))
    token=os.environ.get("YODA_ARCHIVE_REPORT_TOKEN")
    last=[0.0]
    def notify(phase,message,force=False):
        if not force and time.monotonic()-last[0]<30:
            return
        last[0]=time.monotonic()
        payload=status(db,phase,message)
        put(db,"status",payload)
        if token:
            try:
                request=urllib.request.Request(config["base"]+"/api/earth-archive/report",
                    data=json.dumps(payload).encode(),
                    headers={"Content-Type":"application/json","Authorization":"Bearer "+token},method="POST")
                with urllib.request.urlopen(request,timeout=15) as response:
                    if response.status!=200:
                        raise ValueError("Report rejected")
            except Exception as error:
                print("Status delivery failed: "+type(error).__name__,file=sys.stderr)
    with lock(root):
        try:
            notify("starting","Archive runner started",True)
            try:
                sync_engine(root,db,config["base"])
            except Exception as error:
                print("Engine update failed: "+str(error),file=sys.stderr)
            if args.refresh or not get(db,"inventory_at") or time.time()-get(db,"inventory_at")>86400:
                inventory(db,notify)
            totals=status(db)
            required=totals["catalog_bytes"]-totals["verified_bytes"]
            if shutil.disk_usage(root).free<required+RESERVE:
                raise OSError("Insufficient free space for the outstanding native archive")
            # Cursor pagination avoids holding a global inventory in memory.
            cursor=db.execute("SELECT source,key FROM objects WHERE active=1 ORDER BY source,key")
            for identity in cursor:
                item=dict(db.execute("SELECT * FROM objects WHERE source=? AND key=?",tuple(identity)).fetchone())
                target=root/"data"/item["source"]/safe_key(item["key"])
                if item["state"]=="verified" and target.exists() and target.stat().st_size==item["size"]:
                    if not args.verify and target.stat().st_mtime_ns==item["mtime"]:
                        continue
                    if hashes(target)[0]==item["sha256"]:
                        db.execute("UPDATE objects SET mtime=? WHERE source=? AND key=?",
                                   (target.stat().st_mtime_ns,item["source"],item["key"]))
                        db.commit()
                        continue
                for attempt in range(3):
                    try:
                        notify("downloading",f"Acquiring {item['source']} native objects")
                        sha,mtime=download(item,root,lambda:notify("downloading","Transfer active"))
                        db.execute("UPDATE objects SET state='verified',sha256=?,mtime=?,error=NULL WHERE source=? AND key=?",
                                   (sha,mtime,item["source"],item["key"]))
                        db.commit()
                        break
                    except Exception as error:
                        db.execute("UPDATE objects SET state='error',error=? WHERE source=? AND key=?",
                                   (type(error).__name__,item["source"],item["key"]))
                        db.commit()
                        print(f"{item['source']}/{item['key']}: {type(error).__name__}",file=sys.stderr)
                        if isinstance(error,OSError) and "free space" in str(error).lower():
                            raise
                        if attempt<2:
                            time.sleep(2**attempt)
                notify("downloading","Native acquisition checkpoint")
            totals=status(db)
            notify("complete" if totals["archive_complete"] else "partial",
                   "Acquisition pass finished; see source and byte-verification coverage",True)
            return 0 if totals["archive_complete"] and totals["engine_ready"] else 2
        except KeyboardInterrupt:
            notify("interrupted","Partial files retained; rerun to resume",True)
            return 130
        except Exception as error:
            message="Insufficient free space for the outstanding native archive; choose a larger drive." if "free space" in str(error).lower() else "Runner stopped: "+type(error).__name__+". See the Windows log."
            notify("error",message,True)
            print(str(error),file=sys.stderr)
            return 1
        finally:
            db.close()

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--target",required=True)
    parser.add_argument("--refresh",action="store_true")
    parser.add_argument("--verify",action="store_true")
    parser.add_argument("--serve",action="store_true")
    arguments=parser.parse_args()
    if arguments.serve:
        from viewer import serve
        serve(Path(arguments.target).resolve())
    else:
        sys.exit(run(arguments))
