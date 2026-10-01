//! Allowlisted startup diagnostics: never serialize arbitrary exception strings.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
const LIMIT: u64 = 256 * 1024;
fn directory() -> PathBuf {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    #[cfg(not(windows))]
    let root = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join(".local/state")
        });
    root.join("NovelForge/logs")
}
fn record(root: &Path, code: &str, _private_detail: &str) -> std::io::Result<()> {
    fs::create_dir_all(root)?;
    let path = root.join("startup.log");
    if fs::metadata(&path)
        .map(|m| m.len() >= LIMIT)
        .unwrap_or(false)
    {
        let old = root.join("startup.1.log");
        match fs::remove_file(&old) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        fs::rename(&path, old)?;
    }
    let allowed = match code {
        "STARTUP_BEGIN"
        | "STARTUP_FAILED"
        | "STARTUP_SELF_TEST"
        | "STARTUP_RUN_ENTER"
        | "STARTUP_SETUP_ENTER"
        | "STARTUP_CONFIG_READY"
        | "STARTUP_WEBVIEW_BUILD_BEGIN"
        | "STARTUP_WEBVIEW_BUILD_DONE"
        | "STARTUP_PAGE_LOAD_STARTED"
        | "STARTUP_PAGE_LOAD_FINISHED" => code,
        _ => "STARTUP_UNKNOWN",
    };
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{} {}", chrono::Utc::now().to_rfc3339(), allowed)?;
    file.sync_all()
}
pub fn stage(code: &str) {
    let _ = record(&directory(), code, "");
}
pub fn begin() {
    stage("STARTUP_BEGIN");
}
pub fn fail(detail: &str, self_test: bool) {
    let written = record(
        &directory(),
        if self_test {
            "STARTUP_SELF_TEST"
        } else {
            "STARTUP_FAILED"
        },
        detail,
    )
    .is_ok();
    let message = if written {
        "NovelForge 启动失败。\n诊断码：STARTUP_FAILED\nWindows 日志：%LOCALAPPDATA%\\NovelForge\\logs\\startup.log\n日志不包含正文、密钥或原始错误中的敏感路径。"
    } else {
        "NovelForge 启动失败，且无法写入诊断日志。\n诊断码：STARTUP_FAILED / LOG_UNAVAILABLE\n请检查本机应用数据目录权限与磁盘空间。"
    };
    native_notice(message);
}
#[cfg(windows)]
fn native_notice(message: &str) {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(
            window: *mut std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            flags: u32,
        ) -> i32;
    }
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let caption: Vec<u16> = "NovelForge 启动失败"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    // Valid NUL-terminated buffers remain live for the blocking native call.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}
#[cfg(not(windows))]
fn native_notice(message: &str) {
    eprintln!("{message}");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_allowlist_excludes_secrets_bodies_and_paths_and_rotates() {
        let root = std::env::temp_dir().join(format!("nf-diagnostics-{}", uuid::Uuid::new_v4()));
        record(
            &root,
            "STARTUP_FAILED",
            "API_KEY=secret 原始正文 C:\\private\\novel",
        )
        .unwrap();
        record(&root, "Bearer secret", "private").unwrap();
        let text = fs::read_to_string(root.join("startup.log")).unwrap();
        assert!(text.contains("STARTUP_FAILED"));
        for denied in ["secret", "private", "原始正文", "API_KEY", "Bearer"] {
            assert!(!text.contains(denied));
        }
        fs::write(root.join("startup.log"), vec![b'x'; LIMIT as usize]).unwrap();
        record(&root, "STARTUP_BEGIN", "").unwrap();
        assert_eq!(
            fs::metadata(root.join("startup.1.log")).unwrap().len(),
            LIMIT
        );
        assert!(fs::metadata(root.join("startup.log")).unwrap().len() < 1024);
        fs::remove_dir_all(root).unwrap();
    }
}
