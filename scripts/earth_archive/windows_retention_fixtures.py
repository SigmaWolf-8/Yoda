"""Native NTFS fixture tools. Only imported by the Windows retention tests.

No downloads, archive discovery, installed client, or administrative operations.
Every path is supplied by a test's TemporaryDirectory.
"""
import contextlib
import ctypes
from ctypes import wintypes
import os

if os.name != "nt":
    raise RuntimeError("These fixtures require native Windows")

kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateFileW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
kernel.DeviceIoControl.argtypes = [
    wintypes.HANDLE, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD,
    wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
]
kernel.DeviceIoControl.restype = wintypes.BOOL
kernel.GetFileInformationByHandleEx.argtypes = [
    wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD,
]
kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
kernel.GetVolumePathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
kernel.GetVolumePathNameW.restype = wintypes.BOOL
kernel.GetVolumeInformationW.argtypes = [
    wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
    ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD,
]
kernel.GetVolumeInformationW.restype = wintypes.BOOL


def checked(ok):
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())


@contextlib.contextmanager
def handle(path, *, writable=False, share_delete=True):
    # OPEN_EXISTING; a real sharing lock, not a mocked unlink failure.
    access = 0x80000000 | (0x40000000 if writable else 0)  # GENERIC_READ/WRITE
    share = 0x1 | 0x2 | (0x4 if share_delete else 0)
    value = kernel.CreateFileW(str(path), access, share, None, 3, 0x80, None)
    if value == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield value
    finally:
        checked(kernel.CloseHandle(value))


def control(path, code, value=None):
    with handle(path, writable=True) as opened:
        returned = wintypes.DWORD()
        checked(kernel.DeviceIoControl(
            opened, code, ctypes.byref(value) if value is not None else None,
            ctypes.sizeof(value) if value is not None else 0,
            None, 0, ctypes.byref(returned), None,
        ))


def sparse(path):
    path.write_bytes(b"")
    control(path, 0x000900C4)  # FSCTL_SET_SPARSE
    with path.open("r+b") as stream:
        stream.write(b"S" * 4096)
        stream.seek(32 * 1024 * 1024 - 4096)
        stream.write(b"E" * 4096)
        stream.flush()
        os.fsync(stream.fileno())
    if not path.stat().st_file_attributes & 0x200:  # FILE_ATTRIBUTE_SPARSE_FILE
        raise AssertionError("NTFS did not create a sparse fixture")


def compressed(path):
    path.write_bytes(b"")
    control(path, 0x0009C040, wintypes.WORD(1))  # FSCTL_SET_COMPRESSION, DEFAULT
    with path.open("r+b") as stream:
        stream.write(b"compressible fixture\n" * 200_000)
        stream.flush()
        os.fsync(stream.fileno())
    if not path.stat().st_file_attributes & 0x800:  # FILE_ATTRIBUTE_COMPRESSED
        raise AssertionError("NTFS did not create a compressed fixture")


class CompressionInfo(ctypes.Structure):
    _fields_ = [
        ("CompressedFileSize", ctypes.c_longlong),
        ("CompressionFormat", wintypes.WORD),
        ("CompressionUnitShift", wintypes.BYTE),
        ("ChunkShift", wintypes.BYTE),
        ("ClusterShift", wintypes.BYTE),
        ("Reserved", wintypes.BYTE * 3),
    ]


class StandardInfo(ctypes.Structure):
    _fields_ = [
        ("AllocationSize", ctypes.c_longlong),
        ("EndOfFile", ctypes.c_longlong),
        ("NumberOfLinks", wintypes.DWORD),
        ("DeletePending", wintypes.BOOLEAN),
        ("Directory", wintypes.BOOLEAN),
    ]


def allocated(path):
    """Independent handle-based oracle; never calls retention.allocation."""
    is_compressed_or_sparse = path.stat().st_file_attributes & (0x200 | 0x800)
    info = CompressionInfo() if is_compressed_or_sparse else StandardInfo()
    with handle(path) as opened:
        checked(kernel.GetFileInformationByHandleEx(
            opened, 8 if is_compressed_or_sparse else 1,
            ctypes.byref(info), ctypes.sizeof(info),
        ))
    return info.CompressedFileSize if is_compressed_or_sparse else info.AllocationSize


def require_ntfs(path):
    volume = ctypes.create_unicode_buffer(32768)
    filesystem = ctypes.create_unicode_buffer(256)
    flags = wintypes.DWORD()
    checked(kernel.GetVolumePathNameW(str(path), volume, len(volume)))
    checked(kernel.GetVolumeInformationW(
        volume.value, None, 0, None, None, ctypes.byref(flags),
        filesystem, len(filesystem),
    ))
    if filesystem.value.upper() != "NTFS" or flags.value & 0x50 != 0x50:
        raise AssertionError(
            f"Native retention verification requires NTFS sparse/compression support; "
            f"got {filesystem.value}, flags={flags.value:#x}. Use an NTFS TEMP directory."
        )
