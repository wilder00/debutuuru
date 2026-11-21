//! Adds or removes one folder in the current user's PATH on Windows
//! (`HKCU\Environment\Path`). The installer calls it so `debutuuru` works in
//! new PowerShell/cmd windows, and the uninstaller calls it to clean up.
//!
//! Done in Rust instead of NSIS script because NSIS strings are capped at
//! 1024 characters, and editing a longer PATH there truncates it. The value
//! keeps its registry type (usually REG_EXPAND_SZ), so `%USERPROFILE%`-style
//! entries stay unexpanded.
//!
//! The string helpers are plain Rust so their tests run on every OS, but only
//! the Windows `update` calls them.
#![cfg_attr(not(windows), allow(dead_code))]

/// `path` with `dir` appended, or `None` if `dir` is already in it.
pub fn with_dir(path: &str, dir: &str) -> Option<String> {
    if path.split(';').any(|e| same(e, dir)) {
        return None;
    }
    let path = path.trim_end_matches(';');
    Some(if path.is_empty() {
        dir.to_string()
    } else {
        format!("{path};{dir}")
    })
}

/// `path` without any entry equal to `dir`, or `None` if it had none.
pub fn without_dir(path: &str, dir: &str) -> Option<String> {
    let kept: Vec<&str> = path.split(';').filter(|e| !same(e, dir)).collect();
    (kept.len() != path.split(';').count()).then(|| kept.join(";"))
}

/// Windows paths compare case-insensitively, ignoring quotes and a trailing
/// separator.
fn same(entry: &str, dir: &str) -> bool {
    let norm = |s: &str| {
        s.trim()
            .trim_matches('"')
            .trim_end_matches(['\\', '/'])
            .to_lowercase()
    };
    let e = norm(entry);
    !e.is_empty() && e == norm(dir)
}

#[cfg(windows)]
pub fn update(add: bool, dir: &str) -> Result<bool, String> {
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::{RegKey, RegValue};

    if dir.is_empty() || dir.contains(';') {
        return Err(format!("not a PATH entry: {dir:?}"));
    }
    let env = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| format!("can't open HKCU\\Environment: {e}"))?;
    let (current, vtype) = match env.get_raw_value("Path") {
        Ok(v) => {
            let wide: Vec<u16> = v
                .bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&c| u16::from_le_bytes(c))
                .collect();
            let text = String::from_utf16(&wide).map_err(|e| e.to_string())?;
            (text.trim_end_matches('\0').to_string(), v.vtype)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (String::new(), RegType::REG_EXPAND_SZ)
        }
        Err(e) => return Err(format!("can't read the user PATH: {e}")),
    };
    let next = if add {
        with_dir(&current, dir)
    } else {
        without_dir(&current, dir)
    };
    let Some(next) = next else { return Ok(false) };
    let bytes: Vec<u8> = next
        .encode_utf16()
        .chain([0])
        .flat_map(u16::to_le_bytes)
        .collect();
    env.set_raw_value(
        "Path",
        &RegValue {
            bytes: bytes.into(),
            vtype,
        },
    )
    .map_err(|e| format!("can't write the user PATH: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIR: &str = r"C:\Users\me\AppData\Local\Debutuuru\bin";

    #[test]
    fn adds_once_at_the_end() {
        assert_eq!(with_dir("", DIR).as_deref(), Some(DIR));
        let p = r"%USERPROFILE%\bin;C:\tools;";
        let added = with_dir(p, DIR).unwrap();
        assert_eq!(added, format!(r"%USERPROFILE%\bin;C:\tools;{DIR}"));
        assert_eq!(with_dir(&added, DIR), None);
        // Same folder written differently is not added twice.
        assert_eq!(
            with_dir(&format!(r#"C:\x;"{}\""#, DIR.to_uppercase()), DIR),
            None
        );
    }

    #[test]
    fn removes_only_that_folder() {
        let p = format!(r"C:\a;{DIR};C:\b;{DIR}\");
        assert_eq!(without_dir(&p, DIR).as_deref(), Some(r"C:\a;C:\b"));
        assert_eq!(without_dir(r"C:\a;C:\b", DIR), None);
        assert_eq!(without_dir(DIR, DIR).as_deref(), Some(""));
        // A longer path that only starts the same stays.
        assert_eq!(without_dir(&format!(r"{DIR}2"), DIR), None);
    }

    #[test]
    fn keeps_paths_longer_than_nsis_can_hold() {
        let long: String = (0..200).map(|i| format!(r"C:\folder{i};")).collect();
        assert!(long.len() > 2000);
        let added = with_dir(&long, DIR).unwrap();
        assert!(added.starts_with(long.trim_end_matches(';')));
        assert_eq!(
            without_dir(&added, DIR).unwrap(),
            long.trim_end_matches(';')
        );
    }
}
