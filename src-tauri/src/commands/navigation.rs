use std::process::{Command, Stdio};
pub(crate) fn workspace_navigation_allowed(url: &reqwest::Url) -> bool {
    let app = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none());
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420);
    (app || dev) && matches!(url.path(), "/" | "/index.html")
}
fn external_url(value: &str) -> Result<reqwest::Url, String> {
    if value.chars().any(char::is_control) {
        return Err("链接含无效控制字符".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "链接地址无效")?;
    if !matches!(url.scheme(), "http" | "https" | "mailto")
        || !url.username().is_empty()
        || url.password().is_some()
        || (url.scheme() != "mailto" && url.host_str().is_none())
    {
        return Err("只允许使用浏览器打开 HTTP/HTTPS 链接或邮件链接".into());
    }
    Ok(url)
}
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = external_url(&url)?;
    #[cfg(windows)]
    let mut command = {
        let system = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").ok_or("无法定位系统浏览器入口")?,
        )
        .join("System32/rundll32.exe");
        let mut command = Command::new(system);
        command.arg("url.dll,FileProtocolHandler");
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(not(windows))]
    let mut command = Command::new(if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    });
    command
        .arg(url.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法打开系统浏览器：{error}"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_links_reject_executable_schemes_and_credentials() {
        for value in [
            "file:///C:/test.exe",
            "javascript:alert(1)",
            "data:text/html,test",
            "https://user:pass@example.com",
            "https://example.com/\n",
        ] {
            assert!(external_url(value).is_err(), "{value}");
        }
        for value in [
            "https://example.com/path",
            "http://127.0.0.1:8080/",
            "mailto:author@example.com",
        ] {
            assert!(external_url(value).is_ok(), "{value}");
        }
    }
    #[test]
    fn workspace_only_allows_its_own_entrypoint_and_anchors() {
        for value in [
            "https://example.com",
            "http://127.0.0.1:12345/",
            "http://tauri.localhost/other.html",
            "http://tauri.localhost.evil/",
            "http://tauri.localhost:8888/",
        ] {
            assert!(
                !workspace_navigation_allowed(&reqwest::Url::parse(value).unwrap()),
                "{value}"
            );
        }
        for value in [
            "http://tauri.localhost/",
            "http://tauri.localhost/#user-content-fn-1",
            "tauri://localhost/index.html",
        ] {
            assert!(
                workspace_navigation_allowed(&reqwest::Url::parse(value).unwrap()),
                "{value}"
            );
        }
    }
}
