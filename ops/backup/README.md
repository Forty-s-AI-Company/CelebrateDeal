# CelebrateDeal Production encrypted logical backup

This directory is intentionally safe by default. None of the scripts connect to a database, create an archive, register a scheduled task, or restore data unless their explicit execution switch is supplied.

## Prerequisites

1. Install PostgreSQL client tools and ensure `pg_dump` and `pg_restore` are on `PATH`.
2. Install `age` and ensure it is on `PATH`.
3. Configure `Microsoft.PowerShell.SecretManagement` (preferred) or the `CredentialManager` module.
4. Store the full **Production DIRECT_URL** as `CelebrateDeal.Production.DirectDatabaseUrl`. For Credential Manager, place it in the credential password field; it is read at runtime only.
5. Create an age recipient public-key file from `keys/production-backup.agepub.example`. Keep the matching private identity offline and outside this repository.
6. Prepare an existing, access-controlled off-site destination such as an encrypted NAS share. The scripts do not create or configure cloud storage.
7. Register the Windows task only while signed in as a dedicated, least-privilege backup account. Do not use an administrator's daily account.
8. Pass absolute `pg_dump` and `age` paths to task registration when the backup account's `PATH` differs from your interactive shell.
9. For Google Drive, install `rclone`, configure OAuth outside this repository, and store only the rclone config path and remote destination as runtime secrets. The OAuth config and token must never be committed.

## Safety model

- `Invoke-CelebrateDealProductionBackup.ps1` requires `-Execute` before it reads a secret or calls `pg_dump`.
- `Test-CelebrateDealBackupArchive.ps1` verifies an existing archive offline. It requires `-Execute` because it temporarily decrypts the archive.
- `Invoke-CelebrateDealRestoreDrill.ps1` rejects a source-equivalent or production-looking target and requires both `-Execute` and `-Confirmation RESTORE-TO-ISOLATED-TARGET`.
- `Register-CelebrateDealBackupTask.ps1` is plan-only until `-Enable` is supplied.

## Backup retention and alerting

Keep 7 daily, 4 weekly, and 3 monthly encrypted archives in off-site storage. Do not automate deletion until the first restore drill is signed off. Task Scheduler must alert the owner when the task exits non-zero. Optionally pass an organization-controlled alert handler path to the backup script and task registration command; the handler receives only `Status`, `ArchiveId`, and `ErrorCategory`.

## Google Drive adapter

Use `GoogleDrive` only with a dedicated Drive account or a dedicated folder hierarchy. Configure rclone with the least-privilege `drive.file` scope where operationally suitable; it limits rclone to files and folders it creates. The adapter uploads only `.age` archives and checksum files, then performs an rclone checksum verification. Remote paths and rclone config paths are read at runtime from secret names, never from source code or task arguments.

## Required drill evidence

Record the backup date, archive identifier mask, target RTO, measured restore time, checksum result, `pg_restore --list` result, aggregate consistency result, and signer. Never record connection strings, passwords, private keys, or archive paths that reveal customer data.

## Read-only preflight

Run `Test-CelebrateDealBackupPreflight.ps1` before the first drill and before enabling Task Scheduler. It returns only command availability, credential-name presence, age recipient validity, and whether the source and isolated targets differ. It never prints or persists connection metadata, and it does not invoke a database, rclone, age encryption, or a restore.
