"""Portable file-safety primitives for local stores.

POSIX opens refuse a final symbolic link with ``O_NOFOLLOW`` and directories
are flushed after a rename. Windows has neither, and its junctions are reparse
points that ``Path.is_symlink()`` does not report. Here a Windows open uses
``FILE_FLAG_OPEN_REPARSE_POINT`` so a final link is opened as itself and then
refused, never followed. NTFS journals directory metadata, and Windows cannot
flush a directory handle.
"""

from __future__ import annotations

import errno
import os
import stat
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

T = TypeVar("T")
WINDOWS = sys.platform == "win32"
_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_DIRECTORY = 0x10
# Antivirus and indexers briefly hold new files open without delete sharing.
# The desktop's own retries use the same 1.575 second budget.
_SHARING_RETRY_SECONDS = (0.025, 0.05, 0.1, 0.2, 0.4, 0.8)


def is_link(info: os.stat_result) -> bool:
    """Treat every Windows reparse point, including junctions, as a link."""

    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & _REPARSE_POINT)


def is_directory(info: os.stat_result) -> bool:
    """A real directory: Windows reports a junction as a directory too."""

    return stat.S_ISDIR(info.st_mode) and not is_link(info)


def path_is_link(path: str | os.PathLike[str]) -> bool:
    """Whether ``path`` itself is a link or reparse point; False when it is absent."""

    try:
        return is_link(os.lstat(path))
    except (FileNotFoundError, NotADirectoryError):
        return False


def _refuse_link(path: str | os.PathLike[str]) -> None:
    raise OSError(errno.ELOOP, "refusing to follow a link", os.fspath(path))


if sys.platform == "win32":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class _FileInformation(ctypes.Structure):
        _fields_ = [
            ("attributes", wintypes.DWORD),
            ("creation", wintypes.FILETIME),
            ("access", wintypes.FILETIME),
            ("write", wintypes.FILETIME),
            ("volume", wintypes.DWORD),
            ("size_high", wintypes.DWORD),
            ("size_low", wintypes.DWORD),
            ("links", wintypes.DWORD),
            ("index_high", wintypes.DWORD),
            ("index_low", wintypes.DWORD),
        ]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _create_file = _kernel32.CreateFileW
    _create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    _create_file.restype = wintypes.HANDLE
    _file_information = _kernel32.GetFileInformationByHandle
    _file_information.argtypes = [wintypes.HANDLE, ctypes.POINTER(_FileInformation)]
    _file_information.restype = wintypes.BOOL
    _final_path_name = _kernel32.GetFinalPathNameByHandleW
    _final_path_name.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    _final_path_name.restype = wintypes.DWORD
    _close_handle = _kernel32.CloseHandle
    _close_handle.argtypes = [wintypes.HANDLE]
    _close_handle.restype = wintypes.BOOL
    _INVALID_HANDLE = wintypes.HANDLE(-1).value

    def _open_windows(path: str | os.PathLike[str], flags: int) -> int:
        """Open the leaf itself with ``FILE_FLAG_OPEN_REPARSE_POINT`` and check its handle."""

        access_mode = flags & (os.O_RDONLY | os.O_WRONLY | os.O_RDWR)
        access = {os.O_RDONLY: 0x80000000, os.O_WRONLY: 0x40000000, os.O_RDWR: 0xC0000000}[access_mode]
        if flags & os.O_CREAT:
            disposition = 1 if flags & os.O_EXCL else 4  # CREATE_NEW, OPEN_ALWAYS
        else:
            disposition = 3  # OPEN_EXISTING
        # Share reading and writing but not deletion, as Python's own open() does.
        handle = _create_file(os.fspath(path), access, 0x1 | 0x2, None, disposition, 0x00200000, None)
        if handle == _INVALID_HANDLE:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            info = _FileInformation()
            if not _file_information(handle, ctypes.byref(info)):
                raise ctypes.WinError(ctypes.get_last_error())
            if info.attributes & (_REPARSE_POINT | _DIRECTORY):
                _refuse_link(path)
            return msvcrt.open_osfhandle(handle, (flags & ~(os.O_CREAT | os.O_EXCL)) | os.O_BINARY)
        except BaseException:
            _close_handle(handle)
            raise

    def _final_path_windows(descriptor: int) -> str:
        handle = msvcrt.get_osfhandle(descriptor)
        size = 512
        while True:
            buffer = ctypes.create_unicode_buffer(size)
            length = _final_path_name(handle, buffer, size, 0)  # FILE_NAME_NORMALIZED | VOLUME_NAME_DOS
            if length == 0:
                raise ctypes.WinError(ctypes.get_last_error())
            if length < size:
                return buffer.value.removeprefix("\\\\?\\")
            size = length


def open_no_follow(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
    """``os.open`` that never follows a final link or reparse point.

    Windows ignores ``mode``: files are protected by the profile's ACL.
    """

    if sys.platform == "win32":
        return _open_windows(path, flags)
    return os.open(path, flags | os.O_NOFOLLOW, mode)


def final_path(descriptor: int) -> str:
    """The long-name DOS path Windows resolved for an open file.

    Every junction, link and 8.3 alias along the way is already resolved,
    so comparing it with the requested path detects a substituted folder.
    """

    if sys.platform == "win32":
        return _final_path_windows(descriptor)
    raise NotImplementedError("final_path is Windows-only")


def sync_directory(path: str | os.PathLike[str]) -> None:
    """Persist directory-entry changes such as a rename or unlink."""

    if sys.platform == "win32":
        return
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def set_mode(descriptor: int, mode: int) -> None:
    """Apply POSIX permission bits; Windows protects files through ACLs."""

    if sys.platform != "win32":
        os.fchmod(descriptor, mode)


def retry_sharing_violations(operation: Callable[[], T]) -> T:
    """Run a rename or replace, retrying briefly while Windows reports sharing."""

    for delay in (*_SHARING_RETRY_SECONDS, None):
        try:
            return operation()
        except PermissionError:
            if not WINDOWS or delay is None:
                raise
            time.sleep(delay)
    raise AssertionError("unreachable")


def replace(source: Path, destination: Path) -> None:
    """``os.replace``, retrying briefly while Windows reports a sharing violation."""

    retry_sharing_violations(lambda: os.replace(source, destination))
