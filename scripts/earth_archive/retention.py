"""Conservative, opt-in retention. No catalogue sizes are used for savings."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
from client import get, lock, put, utc

SOURCES = {"copernicus", "gebco", "egm2008"}
DIGEST = re.compile(r"[a-f0-9]{64}")


def checked_path(root, relative):
    """Reject aliases, symlinks and Windows junctions at every component."""
    parts = relative.split("/")
    if any(not p or p in (".", "..") or p.endswith((" ", "."))
           or any(c in p for c in '\\:\0')
           or re.fullmatch(r"(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", p, re.I)
           for p in parts):
        raise ValueError("Unsafe managed path")
    path = root
    for part in parts:
        path = path / part
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Links and Windows reparse points are protected")
    return path


def protected_name(relative):
    return any(p.startswith(".") or ".part" in p.lower()
               or p.lower() in ("config.json", "report-token.dpapi")
               for p in relative.split("/"))


def allocation(path, info):
    if os.name != "nt":
        return info.st_blocks * 512 if hasattr(info, "st_blocks") else None
    # GetCompressedFileSize accounts for NTFS compression and sparse files.
    # For ordinary files its documented result is logical length, not cluster
    # allocation; use FileStandardInfo for those instead.
    import ctypes
    from ctypes import wintypes
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    if not getattr(info, "st_file_attributes", 0) & (0x200 | 0x800):
        class StandardInfo(ctypes.Structure):
            _fields_ = [
                ("AllocationSize", ctypes.c_longlong),
                ("EndOfFile", ctypes.c_longlong),
                ("NumberOfLinks", wintypes.DWORD),
                ("DeletePending", wintypes.BOOLEAN),
                ("Directory", wintypes.BOOLEAN),
            ]

        api.CreateFileW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
        ]
        api.CreateFileW.restype = wintypes.HANDLE
        api.GetFileInformationByHandleEx.argtypes = [
            wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD,
        ]
        api.GetFileInformationByHandleEx.restype = wintypes.BOOL
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        api.CloseHandle.restype = wintypes.BOOL
        # FILE_READ_ATTRIBUTES, share read/write/delete, OPEN_EXISTING.
        handle = api.CreateFileW(str(path), 0x80, 0x7, None, 3, 0x00200000, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            standard = StandardInfo()
            if not api.GetFileInformationByHandleEx(
                    handle, 1, ctypes.byref(standard), ctypes.sizeof(standard)):
                raise ctypes.WinError(ctypes.get_last_error())
            return standard.AllocationSize
        finally:
            api.CloseHandle(handle)
    api.GetCompressedFileSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    api.GetCompressedFileSizeW.restype = wintypes.DWORD
    high = wintypes.DWORD()
    ctypes.set_last_error(0)
    low = api.GetCompressedFileSizeW(str(path), ctypes.byref(high))
    if low == 0xFFFFFFFF and ctypes.get_last_error():
        raise ctypes.WinError(ctypes.get_last_error())
    return (high.value << 32) | low


def measure(root, relative):
    path = checked_path(root, relative)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Not a regular file")
    return {"path": relative, "bytes": info.st_size, "allocated_bytes": allocation(path, info),
            "identity": [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                         info.st_ctime_ns, info.st_nlink],
            "protected": protected_name(relative) or info.st_nlink != 1}


def new_group(identity, label, kind):
    return {"id": identity, "label": label, "kind": kind, "active_references": 0,
            "references": [], "files": [], "errors": [], "missing": 0}


def add_file(root, group, relative, reference=None):
    try:
        item = measure(root, relative)
        if item:
            item["reference"] = reference
            group["files"].append(item)
        else:
            group["missing"] += 1
    except (OSError, ValueError) as error:
        group["errors"].append(f"{relative}: {error}")


def scan(root, db):
    """Caller holds the worker lock. Unknown native files are never candidates."""
    groups = {}
    for row in db.execute("SELECT * FROM objects ORDER BY source,key"):
        source, key = row["source"], row["key"]
        release = key.split("/")[0] if source == "gebco" else source
        identity = f"native:{source}:{release}"
        group = groups.setdefault(identity, new_group(identity, f"{source} / {release}", "native"))
        group["active_references"] += int(bool(row["active"]))
        group["references"].append({"source": source, "key": key, "active": row["active"],
                                    "state": row["state"], "sha256": row["sha256"],
                                    "url": row["url"], "validator": row["validator"]})
        if source not in SOURCES:
            group["errors"].append("Unknown source; protected")
            continue
        relative = f"data/{source}/{key}"
        add_file(root, group, relative, [source, key])
        # Sidecars and resumable downloads are shown but never proposed.
        for suffix in (".part", ".part.json", ".part.json.tmp"):
            try:
                if checked_path(root, relative + suffix).exists():
                    add_file(root, group, relative + suffix)
            except (OSError, ValueError) as error:
                group["errors"].append(str(error))

    engine = get(db, "engine")
    selected = engine.get("sha256") if isinstance(engine, dict) else None
    if engine is not None and (not isinstance(selected, str) or not DIGEST.fullmatch(selected)):
        raise ValueError("Invalid engine selection; cleanup disabled")
    directory = checked_path(root, "engines")
    versions = {selected} if selected else set()
    if directory.exists():
        for entry in directory.iterdir():
            name = entry.name.removesuffix(".zip")
            if DIGEST.fullmatch(name):
                versions.add(name)
    for digest in sorted(versions):
        identity = "engine:" + digest
        group = new_group(identity, "Engine " + digest, "engine")
        groups[identity] = group
        group["active_references"] = int(digest == selected)
        group["references"] = [{"selection": "meta.engine" if digest == selected else "unselected",
                                 "sha256": digest}]
        add_file(root, group, f"engines/{digest}.zip")
        try:
            folder = checked_path(root, f"engines/{digest}")
            if folder.exists():
                if not folder.is_dir():
                    raise ValueError("Engine directory is not a directory")
                # Do not follow links, junctions, or descend into private directories.
                pending = [folder]
                while pending:
                    current = pending.pop()
                    for entry in sorted(current.iterdir()):
                        relative = entry.relative_to(root).as_posix()
                        checked_path(root, relative)
                        if entry.is_dir():
                            if protected_name(relative):
                                raise ValueError("Private or partial engine directory is protected")
                            pending.append(entry)
                        else:
                            add_file(root, group, relative)
        except (OSError, ValueError) as error:
            group["errors"].append(str(error))

    # Windows is case-insensitive: catalogue spellings may refer to the same
    # file in different release groups. Protect the physical active object too.
    active_objects = {tuple(f["identity"][:2]) for g in groups.values()
                      if g["active_references"] for f in g["files"]}
    # Even two retired catalogue spellings can alias one NTFS file (nlink=1).
    # Do not double-count savings or remove it while leaving another reference
    # verified. Ambiguous references require inventory repair, not deletion.
    object_counts = Counter(tuple(f["identity"][:2]) for g in groups.values()
                            for f in g["files"])
    for group in groups.values():
        for item in group["files"]:
            identity = tuple(item["identity"][:2])
            if identity in active_objects or object_counts[identity] > 1:
                item["protected"] = True
        group["files"].sort(key=lambda f: f["path"])
        group["state"] = "active" if group["active_references"] else "retired"
        group["local_bytes"] = sum(f["bytes"] for f in group["files"])
        group["allocated_bytes"] = total_allocated(group["files"])
        group["candidates"] = [] if group["active_references"] or group["errors"] else [
            f for f in group["files"] if not f["protected"]]
        group["cleanup_bytes"] = sum(f["bytes"] for f in group["candidates"])
    return list(groups.values())


def total_allocated(files):
    return (sum(f["allocated_bytes"] for f in files)
            if all(f["allocated_bytes"] is not None for f in files) else None)


def build_proposal(root, db, selected):
    groups = scan(root, db)
    if any(g["active_references"] and g["errors"] for g in groups):
        raise ValueError("Cannot resolve every active reference safely; cleanup disabled")
    chosen = [g for g in groups if g["id"] in selected]
    if not selected or len(chosen) != len(set(selected)) or any(not g["candidates"] for g in chosen):
        raise ValueError("Select only retired releases with eligible local files")
    files = [f for g in chosen for f in g["candidates"]]
    # Includes the entire inventory/selection and filesystem snapshot, not just sizes.
    fingerprint = hashlib.sha256(json.dumps(groups, sort_keys=True).encode()).hexdigest()
    return {"selected": sorted(set(selected)), "fingerprint": fingerprint, "files": files,
            "bytes": sum(f["bytes"] for f in files), "allocated_bytes": total_allocated(files),
            "labels": [g["label"] for g in chosen]}


def preview(root, db, selected):
    with lock(root):
        return build_proposal(root, db, selected)


def cleanup(root, db, proposal, confirmation):
    if confirmation != "DELETE":
        raise ValueError("Type DELETE to confirm permanent deletion")
    with lock(root), db:
        db.execute("BEGIN IMMEDIATE")
        fresh = build_proposal(root, db, proposal["selected"])
        if fresh != proposal:
            raise ValueError("Archive changed since preview. Nothing deleted; create a new proposal.")
        before = shutil.disk_usage(root).free
        result = {"at": utc(), "removed_files": 0, "removed_bytes": 0,
                  "removed_empty_directories": 0, "reclaimed_allocated_bytes": 0,
                  "errors": [], "selected": fresh["labels"]}
        for item in fresh["files"]:
            try:
                current = measure(root, item["path"])
                if not current or current["identity"] != item["identity"] or current["protected"]:
                    raise ValueError("File changed; skipped")
                path = checked_path(root, item["path"])
                path.unlink()  # No recursive deletion, no globs, no caller-supplied paths.
                if path.exists():
                    raise OSError("Path still exists after deletion")
            except (OSError, ValueError) as error:
                result["errors"].append({"path": item["path"], "error": str(error)})
                continue
            result["removed_files"] += 1
            result["removed_bytes"] += current["bytes"]
            if current["allocated_bytes"] is None:
                result["reclaimed_allocated_bytes"] = None
            elif result["reclaimed_allocated_bytes"] is not None:
                result["reclaimed_allocated_bytes"] += current["allocated_bytes"]
            if item["reference"]:
                try:
                    db.execute("""UPDATE objects SET state='removed',sha256=NULL,mtime=NULL,error=NULL
                                  WHERE source=? AND key=? AND active=0""", item["reference"])
                except sqlite3.Error as error:
                    result["errors"].append({"path": item["path"],
                                             "error": f"File deleted but inventory update failed: {error}"})
        # An empty content-addressed directory must not look like an installed
        # package on the next acquisition. Only rmdir: partials/unknown files
        # make it nonempty and are preserved. Never touch the engines root.
        directories = set()
        for item in fresh["files"]:
            parts = item["path"].split("/")
            if parts[0] == "engines" and len(parts) > 2:
                directories.update("/".join(parts[:n]) for n in range(2, len(parts)))
        for relative in sorted(directories, key=lambda p: p.count("/"), reverse=True):
            try:
                directory = checked_path(root, relative)
                if directory.is_dir() and not any(directory.iterdir()):
                    directory.rmdir()
                    result["removed_empty_directories"] += 1
            except (OSError, ValueError) as error:
                result["errors"].append({"path": relative, "error": f"Empty folder retained: {error}"})
        try:
            result["free_space_delta_bytes"] = shutil.disk_usage(root).free - before
        except OSError as error:
            result["free_space_delta_bytes"] = None
            result["errors"].append({"path": "(volume)", "error": str(error)})
        # Retain catalogue/source references for provenance and future reacquisition.
        try:
            put(db, "last_cleanup", result)
        except sqlite3.Error as error:
            db.rollback()
            result["errors"].append({"path": "(inventory)",
                                     "error": f"Files were deleted but result could not be saved: {error}"})
        return result
