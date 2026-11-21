//! One-time compatibility for identifiers used before the Cardinal rename.
//!
//! These strings are data-continuity identifiers, not branding. This module is
//! the only place the pre-rename names remain: they let an existing app-data
//! directory, Keychain item, and backups survive the move to
//! `com.awychoi.cardinal`. New data always uses the Cardinal identifiers.

use std::fs;
use std::io;
use std::path::Path;

pub(crate) const APP_DATA_DIR_NAME: &str = "com.awychoi.cardiganmoney";

#[cfg(target_os = "macos")]
pub(crate) const KEYCHAIN_SERVICE: &str = "com.awychoi.cardiganmoney.plaid";

pub(crate) const BACKUP_SEAL_DOMAIN: &[u8] = b"cardigan_money backup seal v1";

fn has_vault(dir: &Path) -> bool {
    dir.join("vault").join("vault.header").exists()
        || dir.join("vault").join("vault.header.bak").exists()
}

fn is_effectively_empty(dir: &Path) -> io::Result<bool> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name() == ".DS_Store" {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

/// Move the pre-rename app-data tree into the new identifier's directory.
///
/// The move only happens when the old directory is a real directory (never a
/// symlink) and the new directory is absent or effectively empty with no vault.
/// A current vault always wins, so a user who has already started fresh is not
/// overwritten.
pub(crate) fn migrate_app_data_dir(current: &Path) -> io::Result<bool> {
    let Some(parent) = current.parent() else {
        return Ok(false);
    };
    let legacy = parent.join(APP_DATA_DIR_NAME);

    let legacy_meta = match fs::symlink_metadata(&legacy) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if legacy_meta.file_type().is_symlink() || !legacy_meta.is_dir() {
        return Ok(false);
    }

    match fs::symlink_metadata(current) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_dir() || has_vault(current) {
                return Ok(false);
            }
            if !is_effectively_empty(current)? {
                return Ok(false);
            }
            // Only Finder metadata can be left here; remove it with the empty
            // directory so the legacy tree can take its place.
            fs::remove_dir_all(current)?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    fs::rename(&legacy, current)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn paths(root: &Path) -> (PathBuf, PathBuf) {
        (
            root.join("com.awychoi.cardinal"),
            root.join(APP_DATA_DIR_NAME),
        )
    }

    fn write_legacy_tree(legacy: &Path) {
        fs::create_dir_all(legacy.join("vault")).unwrap();
        fs::create_dir_all(legacy.join("backups")).unwrap();
        fs::write(legacy.join("vault").join("vault.header"), b"header").unwrap();
        fs::write(legacy.join("backups").join("one.cmbak"), b"backup").unwrap();
    }

    #[test]
    fn moves_the_legacy_tree_when_the_new_directory_is_absent() {
        let temp = tempfile::tempdir().unwrap();
        let (current, legacy) = paths(temp.path());
        write_legacy_tree(&legacy);

        assert!(migrate_app_data_dir(&current).unwrap());
        assert!(!legacy.exists());
        assert_eq!(
            fs::read(current.join("vault").join("vault.header")).unwrap(),
            b"header"
        );
        assert_eq!(
            fs::read(current.join("backups").join("one.cmbak")).unwrap(),
            b"backup"
        );
    }

    #[test]
    fn removes_an_empty_new_directory_before_moving() {
        let temp = tempfile::tempdir().unwrap();
        let (current, legacy) = paths(temp.path());
        write_legacy_tree(&legacy);
        fs::create_dir(&current).unwrap();
        fs::write(current.join(".DS_Store"), b"finder").unwrap();

        assert!(migrate_app_data_dir(&current).unwrap());
        assert!(current.join("vault").join("vault.header").exists());
        assert!(!legacy.exists());
    }

    #[test]
    fn a_current_vault_is_never_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let (current, legacy) = paths(temp.path());
        write_legacy_tree(&legacy);
        fs::create_dir_all(current.join("vault")).unwrap();
        fs::write(current.join("vault").join("vault.header"), b"current").unwrap();

        assert!(!migrate_app_data_dir(&current).unwrap());
        assert_eq!(
            fs::read(current.join("vault").join("vault.header")).unwrap(),
            b"current"
        );
        assert!(legacy.exists());
    }

    #[test]
    fn a_non_empty_new_directory_is_not_overwritten() {
        let temp = tempfile::tempdir().unwrap();
        let (current, legacy) = paths(temp.path());
        write_legacy_tree(&legacy);
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join("unrelated"), b"keep").unwrap();

        assert!(!migrate_app_data_dir(&current).unwrap());
        assert_eq!(fs::read(current.join("unrelated")).unwrap(), b"keep");
        assert!(legacy.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_legacy_directory_is_ignored() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let (current, legacy) = paths(temp.path());
        let target = temp.path().join("target");
        write_legacy_tree(&target);
        symlink(&target, &legacy).unwrap();

        assert!(!migrate_app_data_dir(&current).unwrap());
        assert!(target.exists());
        assert!(!current.exists());
    }
}
