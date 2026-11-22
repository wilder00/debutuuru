//! User settings (appearance for now), stored as `settings.json` in the app's
//! config folder. Versioned: see docs/VERSIONING.md.
//!
//! * `schema_version` is written in every file.
//! * Older files are migrated step by step; the original is backed up first.
//! * A file from a *newer* app version is never overwritten: we run on
//!   defaults in read-only mode, so downgrading can't destroy settings.
//! * Unknown fields are ignored and missing fields get defaults (additive changes
//!   don't need a version bump).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use ts_rs::TS;

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_BACKGROUND_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Settings {
    pub schema_version: u32,
    pub appearance: Appearance,
    /// Added without a schema bump: missing in older files → default.
    pub session: Session,
    /// Added without a schema bump.
    pub git: GitSettings,
    /// Added without a schema bump.
    pub updates: UpdateSettings,
    /// UI language as a BCP 47 tag (`"es"`, `"ja"`…); `None` follows the
    /// system language. Added without a schema bump.
    pub language: Option<String>,
}

/// App updates (signed installers from the GitHub releases).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct UpdateSettings {
    /// Look for a new version a few seconds after start (never installs by itself).
    pub check_on_start: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            check_on_start: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GitSettings {
    /// Which SSH Windows repositories use for push/pull/fetch.
    pub windows_ssh: WindowsSsh,
    /// Distro whose SSH keys to use with [`WindowsSsh::Wsl`]; `None` = default distro.
    pub wsl_distro: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WindowsSsh {
    /// Whatever git is configured to use (default): Git for Windows' ssh,
    /// `core.sshCommand`, etc.
    #[default]
    System,
    /// `wsl.exe -e ssh`: reuse the keys, agent and ~/.ssh/config from WSL.
    Wsl,
}

/// Open repository tabs, restored on the next start.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Session {
    /// Tab keys in UI form (`C:\…` or `\\wsl.localhost\Distro\…`).
    pub open_repos: Vec<String>,
    pub active: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Appearance {
    /// Preset id (see the UI's `theme/presets.ts`) or `"custom"`.
    pub theme: String,
    /// Inputs used when `theme == "custom"`.
    pub custom: ThemeInputs,
    pub background: Option<Background>,
    /// Font family names; `None` = bundled default (Inter / JetBrains Mono).
    pub ui_font: Option<String>,
    pub mono_font: Option<String>,
    /// Base UI font size in px (12–16).
    pub font_size: u32,
    /// Programming ligatures in code views (never in the UI chrome).
    pub ligatures: bool,
    pub density: Density,
}

/// Linear-style theme generation: everything derives from these three.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ThemeInputs {
    /// `#rrggbb`, the darkest app background.
    pub base: String,
    /// `#rrggbb`, used for selection, focus, primary actions.
    pub accent: String,
    /// 0–100.
    pub contrast: u32,
}

/// Warp-style background image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Background {
    /// File name inside the app's `backgrounds` folder.
    pub file: String,
    /// How visible the image is, 0–100.
    pub opacity: u32,
    /// Blur radius in px, 0–40.
    pub blur: u32,
    /// Darkening layer over the image for text contrast, 0–90.
    pub dim: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Density {
    #[default]
    Compact,
    Comfortable,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            appearance: Appearance::default(),
            session: Session::default(),
            git: GitSettings::default(),
            updates: UpdateSettings::default(),
            language: None,
        }
    }
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: "debutuuru".into(),
            custom: ThemeInputs::default(),
            background: None,
            ui_font: None,
            mono_font: None,
            font_size: 13,
            ligatures: true,
            density: Density::Compact,
        }
    }
}

impl Default for ThemeInputs {
    fn default() -> Self {
        Self {
            base: "#101318".into(),
            accent: "#5aa9ff".into(),
            contrast: 50,
        }
    }
}

impl Default for Background {
    fn default() -> Self {
        Self {
            file: String::new(),
            opacity: 60,
            blur: 0,
            dim: 45,
        }
    }
}

impl Settings {
    /// Clamps values so a hand-edited file can't break the UI.
    pub fn sanitized(mut self) -> Self {
        let a = &mut self.appearance;
        a.font_size = a.font_size.clamp(12, 16);
        a.custom.contrast = a.custom.contrast.min(100);
        if !is_hex(&a.custom.base) {
            a.custom.base = ThemeInputs::default().base;
        }
        if !is_hex(&a.custom.accent) {
            a.custom.accent = ThemeInputs::default().accent;
        }
        if let Some(b) = &mut a.background {
            b.opacity = b.opacity.min(100);
            b.blur = b.blur.min(40);
            b.dim = b.dim.min(90);
            if !is_safe_file_name(&b.file) {
                a.background = None;
            }
        }
        for f in [&mut a.ui_font, &mut a.mono_font] {
            if f.as_deref()
                .is_some_and(|s| s.trim().is_empty() || s.contains([';', '{', '}']))
            {
                *f = None;
            }
        }
        let s = &mut self.session;
        s.open_repos.retain(|r| !r.trim().is_empty());
        s.open_repos.dedup();
        s.open_repos.truncate(50);
        if s.active.as_ref().is_some_and(|a| !s.open_repos.contains(a)) {
            s.active = s.open_repos.first().cloned();
        }
        // The distro name ends up in a command line: only plain names.
        if self.git.wsl_distro.as_deref().is_some_and(|d| {
            d.is_empty()
                || !d
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        }) {
            self.git.wsl_distro = None;
        }
        // A language tag is letters, digits and hyphens; anything else means
        // the file was edited by hand: follow the system again.
        if self.language.as_deref().is_some_and(|l| {
            l.is_empty()
                || l.len() > 35
                || !l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        }) {
            self.language = None;
        }
        self.schema_version = SCHEMA_VERSION;
        self
    }
}

fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Only plain names we generated ourselves (no separators, no `..`).
fn is_safe_file_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !s.contains("..")
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LoadedSettings {
    pub settings: Settings,
    /// True when the file was written by a newer app: changes won't be saved.
    pub read_only: bool,
    /// Absolute path of the current background image, for the asset protocol.
    pub background_path: Option<String>,
    /// Human-readable note (migration done, file reset…), if any.
    pub notice: Option<String>,
}

pub struct Store {
    pub file: PathBuf,
    pub backgrounds: PathBuf,
}

impl Store {
    pub fn new(config_dir: &Path, data_dir: &Path) -> Self {
        Self {
            file: config_dir.join("settings.json"),
            backgrounds: data_dir.join("backgrounds"),
        }
    }

    pub fn background_path(&self, s: &Settings) -> Option<String> {
        let b = s.appearance.background.as_ref()?;
        let p = self.backgrounds.join(&b.file);
        p.is_file().then(|| p.to_string_lossy().into_owned())
    }

    pub fn load(&self) -> LoadedSettings {
        let (settings, read_only, notice) = load_file(&self.file);
        LoadedSettings {
            background_path: self.background_path(&settings),
            settings,
            read_only,
            notice,
        }
    }

    pub fn save(&self, s: Settings) -> std::io::Result<Settings> {
        let s = s.sanitized();
        write_atomic(
            &self.file,
            serde_json::to_string_pretty(&s)
                .expect("serializable")
                .as_bytes(),
        )?;
        self.prune_backgrounds(&s);
        Ok(s)
    }

    /// Validates and stores an image, returning its new file name and path.
    pub fn import_background(&self, bytes: &[u8]) -> Result<(String, String), String> {
        if bytes.len() > MAX_BACKGROUND_BYTES {
            return Err(format!(
                "image is larger than {} MB",
                MAX_BACKGROUND_BYTES / 1024 / 1024
            ));
        }
        let ext = image_kind(bytes).ok_or("unsupported image: use PNG, JPEG, WebP or GIF")?;
        std::fs::create_dir_all(&self.backgrounds).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let name = format!("bg-{stamp}.{ext}");
        let path = self.backgrounds.join(&name);
        write_atomic(&path, bytes).map_err(|e| e.to_string())?;
        Ok((name, path.to_string_lossy().into_owned()))
    }

    /// Deletes images no longer referenced by the saved settings.
    fn prune_backgrounds(&self, s: &Settings) {
        let keep = s.appearance.background.as_ref().map(|b| b.file.as_str());
        let Ok(entries) = std::fs::read_dir(&self.backgrounds) else {
            return;
        };
        for e in entries.flatten() {
            let name = e.file_name();
            if Some(name.to_string_lossy().as_ref()) != keep {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

fn load_file(path: &Path) -> (Settings, bool, Option<String>) {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return (Settings::default(), false, None), // first run
    };
    let mut value: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::copy(path, path.with_extension("corrupt.json"));
            return (
                Settings::default(),
                false,
                Some(format!(
                    "Settings file was unreadable ({e}); a copy was kept and defaults are used."
                )),
            );
        }
    };
    let version = value
        .get("schema_version")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    if version > SCHEMA_VERSION {
        return (
            Settings::default(),
            true,
            Some(format!(
                "Settings were saved by a newer Debutuuru (schema {version}). Using defaults; changes won't be saved."
            )),
        );
    }
    let mut notice = None;
    if version < SCHEMA_VERSION {
        let _ = std::fs::copy(path, path.with_extension(format!("v{version}.bak.json")));
        value = migrate(value, version);
        notice = Some(format!(
            "Settings upgraded from schema {version} to {SCHEMA_VERSION}."
        ));
    }
    match serde_json::from_value::<Settings>(value) {
        Ok(s) => (s.sanitized(), false, notice),
        Err(e) => (
            Settings::default(),
            false,
            Some(format!("Settings could not be read ({e}); using defaults.")),
        ),
    }
}

/// Ordered migrations. Add a `from == N` step whenever SCHEMA_VERSION goes to N+1.
fn migrate(mut v: Value, from: u32) -> Value {
    if from == 0 {
        // Pre-release files had no version; their shape is compatible.
    }
    if let Some(o) = v.as_object_mut() {
        o.insert("schema_version".into(), SCHEMA_VERSION.into());
    }
    v
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

fn image_kind(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF8") {
        Some("gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch folder for one test, removed when the test ends (also when it
    /// fails), so runs don't pile up folders in the temp dir.
    struct TmpDir(PathBuf);

    impl std::ops::Deref for TmpDir {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(name: &str) -> TmpDir {
        let d =
            std::env::temp_dir().join(format!("debutuuru-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        TmpDir(d)
    }

    #[test]
    fn first_run_gives_defaults_and_roundtrips() {
        let d = tmp("roundtrip");
        let store = Store::new(&d, &d);
        let loaded = store.load();
        assert_eq!(loaded.settings, Settings::default());
        let mut s = loaded.settings;
        s.appearance.theme = "ember".into();
        store.save(s.clone()).unwrap();
        assert_eq!(store.load().settings.appearance.theme, "ember");
    }

    #[test]
    fn files_from_before_updates_check_for_updates() {
        let d = tmp("updates");
        let store = Store::new(&d, &d);
        std::fs::write(&store.file, r#"{"schema_version": 1, "git": {}}"#).unwrap();
        let loaded = store.load();
        assert!(!loaded.read_only);
        assert!(loaded.settings.updates.check_on_start);
    }

    #[test]
    fn language_follows_the_system_unless_chosen() {
        let d = tmp("language");
        let store = Store::new(&d, &d);
        std::fs::write(&store.file, r#"{"schema_version": 1}"#).unwrap();
        assert_eq!(store.load().settings.language, None);

        std::fs::write(&store.file, r#"{"schema_version": 1, "language": "ja"}"#).unwrap();
        assert_eq!(store.load().settings.language.as_deref(), Some("ja"));

        std::fs::write(
            &store.file,
            r#"{"schema_version": 1, "language": "es;rm -rf"}"#,
        )
        .unwrap();
        assert_eq!(store.load().settings.language, None);
    }

    #[test]
    fn newer_schema_is_read_only_and_untouched() {
        let d = tmp("newer");
        let store = Store::new(&d, &d);
        let original = r#"{"schema_version": 99, "future": true}"#;
        std::fs::write(&store.file, original).unwrap();
        let loaded = store.load();
        assert!(loaded.read_only);
        assert_eq!(std::fs::read_to_string(&store.file).unwrap(), original);
    }

    #[test]
    fn unversioned_file_is_migrated_with_backup() {
        let d = tmp("migrate");
        let store = Store::new(&d, &d);
        std::fs::write(
            &store.file,
            r#"{"appearance": {"theme": "forest", "unknown_field": 1}}"#,
        )
        .unwrap();
        let loaded = store.load();
        assert_eq!(loaded.settings.appearance.theme, "forest");
        assert_eq!(loaded.settings.schema_version, SCHEMA_VERSION);
        assert!(loaded.notice.is_some());
        assert!(d.join("settings.v0.bak.json").is_file());
    }

    #[test]
    fn hostile_values_are_sanitized() {
        let mut s = Settings::default();
        s.appearance.font_size = 400;
        s.appearance.custom.accent = "red; background: url(x)".into();
        s.appearance.ui_font = Some("Inter; }".into());
        s.appearance.background = Some(Background {
            file: "../../etc/passwd".into(),
            ..Default::default()
        });
        s.git.wsl_distro = Some("Ubuntu; rm -rf ~".into());
        let s = s.sanitized();
        assert_eq!(s.appearance.font_size, 16);
        assert_eq!(s.appearance.custom.accent, ThemeInputs::default().accent);
        assert_eq!(s.appearance.ui_font, None);
        assert_eq!(s.appearance.background, None);
        assert_eq!(s.git.wsl_distro, None);
    }

    #[test]
    fn background_import_checks_type_and_prunes_old_files() {
        let d = tmp("bg");
        let store = Store::new(&d, &d);
        assert!(store.import_background(b"not an image").is_err());
        let png = [0x89, b'P', b'N', b'G', 0, 0, 0, 0];
        let (old, _) = store.import_background(&png).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let (new, path) = store.import_background(&png).unwrap();
        assert!(Path::new(&path).is_file());
        let mut s = Settings::default();
        s.appearance.background = Some(Background {
            file: new.clone(),
            ..Default::default()
        });
        store.save(s).unwrap();
        assert!(!store.backgrounds.join(old).exists());
        assert!(store.backgrounds.join(new).exists());
    }
}
