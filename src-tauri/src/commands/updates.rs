use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    available: bool,
    url: String,
}
fn select_release(current: &str, releases: Vec<Release>) -> Result<UpdateInfo, String> {
    let current_version = semver::Version::parse(current).map_err(|e| e.to_string())?;
    let latest = releases
        .into_iter()
        .filter(|r| !r.draft && (!r.prerelease || !current_version.pre.is_empty()))
        .filter_map(|r| {
            semver::Version::parse(r.tag_name.trim_start_matches('v'))
                .ok()
                .map(|version| (version, r.tag_name))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .ok_or("未找到适用的公开版本")?;
    Ok(UpdateInfo {
        current_version: current.into(),
        latest_version: latest.0.to_string(),
        available: latest.0 > current_version,
        url: format!(
            "https://github.com/Gunanzhao/NovelForge/releases/tag/{}",
            latest.1
        ),
    })
}
#[tauri::command]
pub async fn check_updates() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("NovelForge-update-check")
        .build()
        .map_err(|e| e.to_string())?;
    let releases = client
        .get("https://api.github.com/repos/Gunanzhao/NovelForge/releases?per_page=30")
        .send()
        .await
        .map_err(|e| format!("无法连接发布服务器：{e}"))?
        .error_for_status()
        .map_err(|e| format!("发布服务器响应失败：{e}"))?
        .json::<Vec<Release>>()
        .await
        .map_err(|e| format!("无法读取发布信息：{e}"))?;
    select_release(env!("CARGO_PKG_VERSION"), releases)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, prerelease: bool) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease,
            draft: false,
        }
    }
    #[test]
    fn compares_numeric_release_candidates_and_ignores_invalid_tags() {
        let info = select_release(
            "1.1.0-rc.9",
            vec![
                release("v1.1.0-rc.10", true),
                release("not-a-version", false),
            ],
        )
        .unwrap();
        assert!(info.available);
        assert_eq!(info.latest_version, "1.1.0-rc.10");
        assert!(
            !select_release("1.1.0-rc.11", vec![release("v1.1.0-rc.10", true)])
                .unwrap()
                .available
        );
    }
    #[test]
    fn stable_versions_exclude_prereleases_and_drafts() {
        let mut draft = release("v9.0.0", false);
        draft.draft = true;
        let info = select_release(
            "1.0.0",
            vec![
                release("v1.0.0", false),
                release("v2.0.0-rc.1", true),
                draft,
            ],
        )
        .unwrap();
        assert!(!info.available);
        assert_eq!(info.latest_version, "1.0.0");
    }
}
