"""Scheduled-task entry point: no PowerShell policy changes or shell command strings."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys

def reporting_token(path):
    """Read the current user's DPAPI-protected PowerShell SecureString."""
    if os.name != "nt":
        raise RuntimeError("The scheduled launcher requires Windows")
    class Blob(ctypes.Structure):
        _fields_=[("size",wintypes.DWORD),("data",ctypes.POINTER(ctypes.c_ubyte))]
    encrypted=bytes.fromhex(path.read_text(encoding="ascii").strip())
    buffer=(ctypes.c_ubyte*len(encrypted)).from_buffer_copy(encrypted)
    incoming=Blob(len(encrypted),buffer)
    outgoing=Blob()
    crypt=ctypes.WinDLL("crypt32",use_last_error=True)
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    crypt.CryptUnprotectData.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype=wintypes.BOOL
    kernel.LocalFree.argtypes=[ctypes.c_void_p]
    kernel.LocalFree.restype=ctypes.c_void_p
    if not crypt.CryptUnprotectData(ctypes.byref(incoming),None,None,None,None,1,ctypes.byref(outgoing)):
        raise OSError("Windows could not unlock the reporting credential for this user")
    try:
        return ctypes.string_at(outgoing.data,outgoing.size).decode("utf-16-le")
    finally:
        ctypes.memset(outgoing.data,0,outgoing.size)
        kernel.LocalFree(outgoing.data)

def main():
    private=Path(__file__).resolve().parent
    config=json.loads((private/"config.json").read_text(encoding="utf-8-sig"))
    args=[sys.executable,str(private/"client.py"),"--target",config["target"]]
    env=os.environ.copy()
    env.pop("YODA_ARCHIVE_REPORT_TOKEN",None)
    if "--serve" in sys.argv:
        args.append("--serve")
    else:
        env["YODA_ARCHIVE_REPORT_TOKEN"]=reporting_token(private/"report-token.dpapi")
    with (private/"runner.log").open("ab",buffering=0) as log:
        return subprocess.call(args,env=env,stdout=log,stderr=log)

if __name__=="__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # No credential or document content in logs.
        print("Yoda archive launcher failed: "+type(error).__name__,file=sys.stderr)
        sys.exit(1)
