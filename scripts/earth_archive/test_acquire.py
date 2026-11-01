"""Deterministic protocol tests. Fixture bytes are never shipped as Earth data."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from acquire import download,safe_key,copernicus,gebco
from client import database,status,put,inventory

class Response(io.BytesIO):
    def __init__(self,data,status=200,headers=None):
        super().__init__(data)
        self.status=status
        self.headers=headers or {}

class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.item={"source":"copernicus","key":"tile.bin","url":"https://example.test/tile",
                   "size":6,"validator":'etag:"revision1"',"md5":hashlib.md5(b"abcdef").hexdigest()}
    def tearDown(self):
        self.tmp.cleanup()
    def partial(self,data=b"abc",validator=None):
        p=self.root/"data/copernicus/tile.bin.part"
        p.parent.mkdir(parents=True)
        p.write_bytes(data)
        m={k:self.item[k] for k in ("url","size","validator")}
        if validator:
            m["validator"]=validator
        p.with_name(p.name+".json").write_text(json.dumps(m))
        return p
    def test_range_resume_and_hash(self):
        p=self.partial()
        def source(url,headers):
            self.assertEqual(headers["Range"],"bytes=3-")
            self.assertEqual(headers["If-Match"],'"revision1"')
            return Response(b"def",206,{"Content-Range":"bytes 3-5/6"})
        digest,_=download(self.item,self.root,opener=source)
        self.assertEqual(digest,hashlib.sha256(b"abcdef").hexdigest())
        self.assertFalse(p.exists())
    def test_ignored_range_restarts(self):
        self.partial()
        download(self.item,self.root,opener=lambda *a,**k:Response(b"abcdef"))
        self.assertEqual((self.root/"data/copernicus/tile.bin").read_bytes(),b"abcdef")
    def test_stale_partial_restarts(self):
        self.partial(validator="etag:old")
        def source(url,headers):
            self.assertNotIn("Range",headers)
            return Response(b"abcdef")
        download(self.item,self.root,opener=source)
    def test_interrupted_metadata_write_recovers(self):
        p=self.partial()
        p.with_name(p.name+".json").write_text("{broken")
        download(self.item,self.root,opener=lambda *a,**k:Response(b"abcdef"))
        self.assertEqual((self.root/"data/copernicus/tile.bin").read_bytes(),b"abcdef")
    def test_incorrect_range_rejected(self):
        self.partial()
        with self.assertRaises(ValueError):
            download(self.item,self.root,opener=lambda *a,**k:Response(b"def",206,{"Content-Range":"bytes 0-2/6"}))
        self.assertFalse((self.root/"data/copernicus/tile.bin").exists())
    def test_checksum_failure_never_promoted(self):
        with self.assertRaisesRegex(ValueError,"checksum"):
            download(self.item,self.root,opener=lambda *a,**k:Response(b"xxxxxx"))
        self.assertFalse((self.root/"data/copernicus/tile.bin").exists())
        self.assertFalse((self.root/"data/copernicus/tile.bin.part").exists())
    def test_truncated_transfer_keeps_partial(self):
        with self.assertRaisesRegex(ValueError,"Incomplete"):
            download(self.item,self.root,opener=lambda *a,**k:Response(b"abc"))
        self.assertEqual((self.root/"data/copernicus/tile.bin.part").read_bytes(),b"abc")
    def test_low_disk_preserves_partial(self):
        p=self.partial()
        from collections import namedtuple
        with patch("acquire.shutil.disk_usage",return_value=namedtuple("Usage","free")(1)):
            with self.assertRaises(OSError):
                download(self.item,self.root)
        self.assertEqual(p.read_bytes(),b"abc")
    def test_traversal_rejected(self):
        for key in ("../private","/etc/passwd","C:/windows","foo\\bar"):
            with self.assertRaises(ValueError):
                safe_key(key)
    def test_empty_inventory_is_never_complete(self):
        db=database(self.root)
        self.assertFalse(status(db)["archive_complete"])
        db.close()
    def test_failed_source_does_not_mark_archive_complete(self):
        db=database(self.root)
        def failure():
            raise OSError("Unavailable test source")
        with patch("client.copernicus",lambda:iter([self.item])),patch("client.gebco",failure),patch("client.egm2008",failure):
            inventory(db,lambda *a:None)
        self.assertFalse(status(db)["catalog_complete"])
        self.assertEqual(status(db)["catalog_objects"],1)
        db.close()
    def test_s3_follows_continuation(self):
        calls=[]
        def page(url):
            calls.append(url)
            last=len(calls)==2
            body=f'''<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>copernicus-dem-30m</Name><IsTruncated>{str(not last).lower()}</IsTruncated><NextContinuationToken>next</NextContinuationToken><Contents><Key>tile{len(calls)}</Key><Size>6</Size><ETag>"v1"</ETag></Contents></ListBucketResult>'''
            return Response(body.encode())
        with patch("acquire.open_url",page):
            self.assertEqual(len(list(copernicus())),2)
        self.assertIn("continuation-token=next",calls[1])
    def test_s3_missing_continuation_fails(self):
        body=b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>copernicus-dem-30m</Name><IsTruncated>true</IsTruncated></ListBucketResult>'
        with patch("acquire.open_url",lambda *a:Response(body)):
            with self.assertRaises(ValueError):
                list(copernicus())
    def test_gebco_latest_release_and_all_formats(self):
        def listing(url):
            if url.endswith("global/?json"):
                return {"items":[{"name":"gebco_2025","type":"dir"},{"name":"gebco_2026","type":"dir"}]}
            return {"items":[{"type":"file","path":"/bodc/gebco/global/gebco_2026/grid.nc",
                "download":"https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/grid.nc","md5":"0"*32,"size":100}]}
        with patch("acquire.read_json",listing):
            self.assertEqual(list(gebco())[0]["key"],"gebco_2026/grid.nc")

if __name__=="__main__":
    unittest.main()
