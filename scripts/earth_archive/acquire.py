"""Public-source inventory and bounded-memory, resumable acquisition. Stdlib only."""
import hashlib
import json
import re
import shutil
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath

COPERNICUS = "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
CEDA = "https://data.ceda.ac.uk/bodc/gebco/global/"
NGA = "https://earth-info.nga.mil/php/download.php?file=egm-08interpolation"
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
RESERVE = 512 * 1024 * 1024

def safe_key(key):
    parts = PurePosixPath(key).parts
    if not parts or key.startswith("/") or any(x in ("..", ".") for x in parts) or any(x in key for x in "\\:\x00"):
        raise ValueError("Unsafe source object name")
    return "/".join(parts)

def open_url(url, headers=None, method=None):
    if not url.startswith("https://"):
        raise ValueError("Only HTTPS sources are allowed")
    request = urllib.request.Request(url, headers={"User-Agent":"Yoda-Earth-Archive/1", **(headers or {})}, method=method)
    response = urllib.request.urlopen(request, timeout=45)
    if not response.url.startswith("https://"):
        response.close()
        raise ValueError("Source redirected away from HTTPS")
    return response

def read_json(url):
    with open_url(url) as response:
        raw = response.read(8_000_001)
    if len(raw)>8_000_000:
        raise ValueError("Oversized catalogue response")
    return json.loads(raw)

def copernicus():
    token = None
    seen_tokens = set()
    while True:
        query = {"list-type":"2","max-keys":"1000"}
        if token:
            query["continuation-token"] = token
        with open_url(COPERNICUS+"?"+urllib.parse.urlencode(query)) as response:
            raw = response.read(4_000_001)
        if len(raw)>4_000_000:
            raise ValueError("Oversized S3 listing")
        root = ET.fromstring(raw)
        if root.findtext("s:Name",namespaces=NS)!="copernicus-dem-30m":
            raise ValueError("Unexpected S3 bucket")
        for entry in root.findall("s:Contents",NS):
            key = entry.findtext("s:Key",namespaces=NS)
            if key.endswith("/"):
                continue
            key = safe_key(key)
            size = int(entry.findtext("s:Size",namespaces=NS))
            etag = entry.findtext("s:ETag",namespaces=NS)
            if size<0 or not etag:
                raise ValueError("Missing size or source validator")
            yield {"source":"copernicus","key":key,"url":COPERNICUS+urllib.parse.quote(key),
                   "size":size,"validator":"etag:"+etag,"md5":None}
        if root.findtext("s:IsTruncated",namespaces=NS)=="false":
            break
        token = root.findtext("s:NextContinuationToken",namespaces=NS)
        if not token or token in seen_tokens:
            raise ValueError("Missing or repeated S3 continuation token")
        seen_tokens.add(token)

def gebco():
    listing = read_json(CEDA+"?json")
    releases = [x["name"] for x in listing["items"] if x["type"]=="dir" and re.fullmatch(r"gebco_\d{4}",x["name"])]
    if not releases:
        raise ValueError("GEBCO release catalogue is empty")
    release = max(releases)
    queue = [f"/bodc/gebco/global/{release}"]
    visited = set()
    while queue:
        directory = queue.pop()
        if directory in visited or not directory.startswith(f"/bodc/gebco/global/{release}"):
            raise ValueError("Invalid GEBCO catalogue traversal")
        visited.add(directory)
        for item in read_json("https://data.ceda.ac.uk"+directory+"/?json")["items"]:
            path = item["path"]
            if not path.startswith(directory+"/"):
                raise ValueError("GEBCO path left its declared directory")
            if item["type"]=="dir":
                queue.append(path)
                continue
            if item["type"]!="file":
                raise ValueError("Unsupported GEBCO catalogue entry")
            url = item["download"]
            if urllib.parse.urlparse(url).hostname!="dap.ceda.ac.uk":
                raise ValueError("Unexpected GEBCO download host")
            md5 = item.get("md5")
            if not isinstance(md5,str) or not re.fullmatch("[a-fA-F0-9]{32}",md5):
                raise ValueError("GEBCO object has no published MD5 checksum")
            yield {"source":"gebco","key":safe_key(path.removeprefix("/bodc/gebco/global/")),
                   "url":url,"size":int(item["size"]),"validator":"md5:"+md5,"md5":md5.lower()}

def egm2008():
    import urllib.error
    try:
        with open_url(NGA,method="HEAD") as response:
            headers=response.headers
    except urllib.error.HTTPError as error:
        if error.code not in (405,501):
            raise
        headers={}
    size=int(headers.get("Content-Length","0"))
    if size<=0:
        # Some official download endpoints reject HEAD. Close after headers,
        # even when they ignore Range; do not read a multi-gigabyte response.
        with open_url(NGA,headers={"Range":"bytes=0-0"}) as response:
            headers=response.headers
            content_range=headers.get("Content-Range","")
            size=int(content_range.rsplit("/",1)[1]) if content_range.startswith("bytes ") else int(headers.get("Content-Length","0"))
    etag=headers.get("ETag")
    modified=headers.get("Last-Modified")
    if size<=0 or not (etag or modified):
        raise ValueError("NGA archive lacks a usable size/version validator")
    yield {"source":"egm2008","key":"EGM2008_Interpolation_Grid.zip","url":NGA,"size":size,
           "validator":("etag:"+etag) if etag else ("modified:"+modified),"md5":None}

def hashes(path):
    sha, md5 = hashlib.sha256(),hashlib.md5()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):
            sha.update(chunk)
            md5.update(chunk)
    return sha.hexdigest(),md5.hexdigest()

def download(item, root, progress=lambda:None, opener=open_url):
    key = safe_key(item["key"])
    if item["source"] not in ("copernicus","gebco","egm2008"):
        raise ValueError("Unknown source")
    target = root/"data"/item["source"]/key
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.resolve().is_relative_to((root/"data").resolve()):
        raise ValueError("Archive path escapes the data directory")
    part = target.with_name(target.name+".part")
    metadata = part.with_name(part.name+".json")
    identity = {key:item[key] for key in ("url","size","validator")}
    try:
        previous=json.loads(metadata.read_text(encoding="utf-8"))
    except (FileNotFoundError,ValueError,UnicodeError):
        previous=None
    if previous!=identity or (part.exists() and part.stat().st_size>item["size"]):
        part.unlink(missing_ok=True)
        staged_metadata=metadata.with_name(metadata.name+".tmp")
        staged_metadata.write_text(json.dumps(identity),encoding="utf-8")
        staged_metadata.replace(metadata)
    offset = part.stat().st_size if part.exists() else 0
    if shutil.disk_usage(root).free < item["size"]-offset+RESERVE:
        raise OSError("Insufficient free space; partial file retained")
    if offset<item["size"]:
        headers = {}
        validator = item["validator"]
        if validator.startswith("etag:"):
            headers["If-Match"]=validator[5:]
        elif validator.startswith("modified:"):
            headers["If-Unmodified-Since"]=validator[9:]
        if offset:
            headers["Range"]=f"bytes={offset}-"
        with opener(item["url"],headers=headers) as response:
            if response.status==206:
                expected = f"bytes {offset}-"
                if not response.headers.get("Content-Range","").startswith(expected) or not response.headers["Content-Range"].endswith("/"+str(item["size"])):
                    raise ValueError("Server returned a mismatched byte range")
            elif response.status==200:
                offset=0  # Server ignored Range: restart, never append duplicate bytes.
            else:
                raise ValueError("Unexpected download status")
            with part.open("ab" if offset else "wb") as out:
                for chunk in iter(lambda:response.read(1024*1024),b""):
                    offset+=len(chunk)
                    if offset>item["size"]:
                        raise ValueError("Download exceeded catalogue size")
                    out.write(chunk)
                    progress()
    if part.stat().st_size!=item["size"]:
        raise ValueError("Incomplete download; resume on next attempt")
    sha,md5=hashes(part)
    if item.get("md5") and md5!=item["md5"]:
        part.unlink()
        raise ValueError("Published checksum mismatch; invalid partial discarded")
    if key.lower().endswith(".tif"):
        with part.open("rb") as stream:
            if stream.read(4) not in (b"II*\0",b"MM\0*",b"II+\0",b"MM\0+"):
                part.unlink()
                raise ValueError("Downloaded TIFF has an invalid signature")
    if item["source"]=="egm2008":
        import zipfile
        if not zipfile.is_zipfile(part):
            part.unlink()
            raise ValueError("NGA response is not a ZIP archive; no PGM conversion attempted")
        with zipfile.ZipFile(part) as archive:
            if archive.testzip() is not None:
                part.unlink()
                raise ValueError("NGA ZIP CRC validation failed")
    part.replace(target)
    metadata.unlink(missing_ok=True)
    return sha,target.stat().st_mtime_ns
