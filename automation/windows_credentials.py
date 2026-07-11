from __future__ import annotations

import argparse
import ctypes
import os
import re
import secrets
import sys
from ctypes import wintypes


TARGET = "CelebrateDeal/AI_PIPELINE_ATTESTATION_KEY"
KEY_PATTERN = re.compile(r"^[0-9a-f]{64}$")
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2
ERROR_NOT_FOUND = 1168


class CredentialError(RuntimeError):
    pass


class CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def _advapi32():
    if os.name != "nt":
        raise CredentialError("Windows Credential Manager is unavailable on this platform")
    library = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    library.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIALW))]
    library.CredReadW.restype = wintypes.BOOL
    library.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIALW), wintypes.DWORD]
    library.CredWriteW.restype = wintypes.BOOL
    library.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    library.CredDeleteW.restype = wintypes.BOOL
    library.CredFree.argtypes = [ctypes.c_void_p]
    return library


def validate_key(value: str) -> str:
    normalized = value.strip().lower()
    if not KEY_PATTERN.fullmatch(normalized):
        raise CredentialError("Attestation key must be exactly 64 hexadecimal characters")
    if len(set(normalized)) < 8:
        raise CredentialError("Attestation key does not have sufficient symbol diversity")
    return normalized


def write_key(value: str) -> None:
    key = validate_key(value)
    blob = key.encode("utf-16-le")
    buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    credential = CREDENTIALW(
        0, CRED_TYPE_GENERIC, TARGET, "CelebrateDeal coordinator attestation key", wintypes.FILETIME(),
        len(blob), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), CRED_PERSIST_LOCAL_MACHINE,
        0, None, None, "CelebrateDeal-AI-Team",
    )
    library = _advapi32()
    if not library.CredWriteW(ctypes.byref(credential), 0):
        raise CredentialError(f"CredWriteW failed with Windows error {ctypes.get_last_error()}")


def read_key() -> str | None:
    library = _advapi32()
    pointer = ctypes.POINTER(CREDENTIALW)()
    if not library.CredReadW(TARGET, CRED_TYPE_GENERIC, 0, ctypes.byref(pointer)):
        error = ctypes.get_last_error()
        if error == ERROR_NOT_FOUND:
            return None
        raise CredentialError(f"CredReadW failed with Windows error {error}")
    try:
        credential = pointer.contents
        raw = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        return validate_key(raw.decode("utf-16-le"))
    finally:
        library.CredFree(pointer)


def delete_key() -> bool:
    library = _advapi32()
    if library.CredDeleteW(TARGET, CRED_TYPE_GENERIC, 0):
        return True
    error = ctypes.get_last_error()
    if error == ERROR_NOT_FOUND:
        return False
    raise CredentialError(f"CredDeleteW failed with Windows error {error}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage the coordinator attestation key in Windows Credential Manager")
    parser.add_argument("command", choices=["generate", "set", "status", "delete"])
    args = parser.parse_args(argv)
    try:
        if args.command == "generate":
            write_key(secrets.token_hex(32))
            print("credential-generated")
        elif args.command == "set":
            value = sys.stdin.readline()
            if not value:
                raise CredentialError("No key was provided on stdin")
            write_key(value)
            print("credential-stored")
        elif args.command == "delete":
            print("credential-deleted" if delete_key() else "credential-not-found")
        else:
            print("credential-ready" if read_key() else "credential-not-found")
    except CredentialError as error:
        print(f"credential error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
