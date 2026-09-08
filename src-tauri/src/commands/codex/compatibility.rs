//! Local protocol contracts and successful-probe cache. No downloaded executable code.
use super::*;
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) const ADAPTER: &str = "text-stdio-v1";
pub(super) const VERIFIER: u32 = 1;

pub(super) struct Scratch(pub PathBuf);
impl Scratch {
    pub fn new(parent: &Path) -> Result<Self, String> {
        let path = parent.join(format!("codex-check-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).map_err(|_| "无法创建兼容检查目录")?;
        Ok(Self(path))
    }
    pub fn into_path(mut self) -> PathBuf {
        std::mem::take(&mut self.0)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        // This directory was exclusively created above, never supplied by a caller.
        if !self.0.as_os_str().is_empty() {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn file_hash(path: &Path, owner: &Client) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "无法读取 CLI 文件")?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        check_stop(owner)?;
        let len = file.read(&mut buffer).map_err(|_| "无法校验 CLI 文件")?;
        if len == 0 {
            break;
        }
        hash.update(&buffer[..len]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn check_stop(owner: &Client) -> Result<(), String> {
    if owner.closed.load(Ordering::SeqCst) {
        return Err("窗口已关闭".into());
    }
    if owner.check_cancel.load(Ordering::SeqCst) {
        return Err("兼容检查已取消".into());
    }
    if owner.cancel.load(Ordering::SeqCst)
        && owner.active.lock().map_err(|_| "生成状态不可用")?.is_some()
    {
        return Err("生成已取消".into());
    }
    if owner
        .check_deadline
        .lock()
        .map_err(|_| "检查状态不可用")?
        .is_some_and(|deadline| Instant::now() >= deadline)
    {
        return Err("兼容检查超过 90 秒，请重试".into());
    }
    Ok(())
}

/// Only recognized diagnostic categories leave the subprocess boundary.
pub(super) fn safe_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("unknown variant") {
        "CLI 配置枚举不兼容"
    } else if lower.contains("missing field") {
        "CLI 缺少必需配置字段"
    } else if lower.contains("unrecognized") || lower.contains("unexpected argument") {
        "CLI 不支持所需参数"
    } else if lower.contains("config") {
        "CLI 配置解析失败"
    } else if lower.contains("authentication") || lower.contains("unauthorized") {
        "CLI 登录认证失败"
    } else {
        "CLI 子进程执行失败"
    }
    .into()
}

pub(super) fn command_output(mut command: Command, owner: &Client) -> Result<Vec<u8>, String> {
    check_stop(owner)?;
    let mut child = hidden(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "无法启动 CLI 检测命令")?;
    let stdout = child.stdout.take().ok_or("无法读取 CLI 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 CLI 诊断")?;
    let (tx, rx) = mpsc::channel();
    for (is_error, pipe) in [
        (false, Box::new(stdout) as Box<dyn Read + Send>),
        (true, Box::new(stderr)),
    ] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = pipe.take((MAX_FRAME + 1) as u64).read_to_end(&mut bytes);
            let _ = tx.send((is_error, result.map(|_| bytes)));
        });
    }
    drop(tx);
    let deadline = Instant::now() + CONTROL_TIMEOUT;
    let mut output = Vec::new();
    let mut diagnostic = String::new();
    let result = (|| {
        let mut received = 0;
        loop {
            check_stop(owner)?;
            if Instant::now() >= deadline {
                return Err("CLI 检测命令超时".into());
            }
            while let Ok((is_error, bytes)) = rx.try_recv() {
                let bytes = bytes.map_err(|_| "CLI 检测输出读取失败")?;
                if bytes.len() > MAX_FRAME {
                    return Err("CLI 检测输出超限".into());
                }
                if is_error {
                    diagnostic = safe_error(&String::from_utf8_lossy(&bytes));
                } else {
                    output = bytes;
                }
                received += 1;
            }
            if let Some(status) = child.try_wait().map_err(|_| "无法读取 CLI 退出状态")? {
                if received == 2 {
                    return if status.success() {
                        Ok(output)
                    } else {
                        Err(diagnostic)
                    };
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    })();
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    result
}

pub(super) fn version(path: &Path, owner: &Client) -> Result<String, String> {
    let mut command = Command::new(path);
    command.arg("--version");
    let output = command_output(command, owner)?;
    let text = std::str::from_utf8(&output).map_err(|_| "CLI 版本编码无效")?;
    parse_version(text)
}

fn parse_version(text: &str) -> Result<String, String> {
    let v = text
        .trim()
        .strip_prefix("codex-cli ")
        .ok_or("CLI 版本格式不支持")?;
    semver::Version::parse(v).map_err(|_| "CLI 版本格式不支持")?;
    Ok(v.into())
}

// Resolve only local schema references. Documentation and property order are not protocol semantics.
pub(super) fn normalize(value: &Value, root: &Value, depth: usize) -> Result<Value, String> {
    if depth > 40 {
        return Err("CLI 协议定义递归超限".into());
    }
    if let Some(reference) = value["$ref"].as_str() {
        let pointer = reference.strip_prefix('#').ok_or("CLI 协议包含外部引用")?;
        return normalize(
            root.pointer(pointer).ok_or("CLI 协议引用无效")?,
            root,
            depth + 1,
        );
    }
    match value {
        Value::Object(object) => {
            let mut result = serde_json::Map::new();
            for (key, item) in object {
                if ["description", "title", "$schema", "default", "examples"]
                    .contains(&key.as_str())
                {
                    continue;
                }
                result.insert(key.clone(), normalize(item, root, depth + 1)?);
            }
            Ok(Value::Object(result))
        }
        Value::Array(items) => items
            .iter()
            .map(|v| normalize(v, root, depth + 1))
            .collect(),
        _ => Ok(value.clone()),
    }
}

pub(super) fn verify_schema(
    path: &Path,
    version: &str,
    parent: &Path,
    owner: &Client,
) -> Result<(), String> {
    let scratch = Scratch::new(parent)?;
    let out = scratch.0.join("schema");
    let mut command = Command::new(path);
    command
        .args(["app-server", "generate-json-schema", "--out"])
        .arg(&out)
        .env("CODEX_HOME", &scratch.0)
        .current_dir(&scratch.0);
    let exported = command_output(command, owner);
    if exported.is_err() && version == "0.149.1" {
        check_stop(owner)?;
        // This baseline also requires the real local behavioral probe; never used for unknown versions.
        return Ok(());
    }
    exported?;
    let contract: Value = serde_json::from_str(include_str!("protocol-contract.json"))
        .map_err(|_| "内置协议定义无效")?;
    for (file, expected) in contract.as_object().ok_or("内置协议定义无效")? {
        check_stop(owner)?;
        let bytes = std::fs::read(out.join(file)).map_err(|_| format!("CLI 缺少协议 {file}"))?;
        if bytes.len() > MAX_FRAME {
            return Err("CLI 协议文件超限".into());
        }
        let actual: Value = serde_json::from_slice(&bytes).map_err(|_| "CLI 协议定义无效")?;
        verify_contract(&actual, expected).map_err(|e| format!("{file}: {e}"))?;
    }
    Ok(())
}

pub(super) fn verify_contract(actual: &Value, expected: &Value) -> Result<(), String> {
    for (field, shape) in expected["properties"]
        .as_object()
        .ok_or("内置字段定义无效")?
    {
        let got = actual["properties"]
            .get(field)
            .ok_or_else(|| format!("缺少必需字段 {field}"))?;
        if normalize(got, actual, 0)? != *shape {
            return Err(format!("字段 {field} 类型或枚举不兼容"));
        }
    }
    if expected["request"] == true {
        if let Some(required) = actual["required"].as_array() {
            let allowed = expected["allowedRequired"]
                .as_array()
                .ok_or("内置参数定义无效")?;
            if required.iter().any(|r| !allowed.contains(r)) {
                return Err("新增了无法提供的必填参数".into());
            }
        }
    }
    Ok(())
}

pub(super) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub(super) fn cached(path: &Path, key: &str) -> Option<u64> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(4097)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let checked = value["checkedAt"].as_u64()?;
    (value["key"] == key && checked <= now() && now() - checked < 7 * 86400).then_some(checked)
}
pub(super) fn save_cache(path: &Path, key: &str, checked: u64) {
    let value = json!({"key":key,"checkedAt":checked});
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(value.to_string().as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_versions_and_redacted_diagnostics() {
        assert_eq!(parse_version("codex-cli 0.153.4\n").unwrap(), "0.153.4");
        assert!(parse_version("something 0.153.4").is_err());
        assert!(parse_version("codex-cli 0.153.4 secret").is_err());
        assert!(!safe_error("config token=SECRET novel text").contains("SECRET"));
    }
    #[test]
    fn added_fields_allowed_required_changes_rejected() {
        let expected =
            json!({"properties":{"id":{"type":"string"}},"request":true,"allowedRequired":["id"]});
        assert!(verify_contract(&json!({"properties":{"id":{"type":"string"},"extra":{"type":"boolean"}},"required":["id"]}), &expected).is_ok());
        for actual in [
            json!({"properties":{}}),
            json!({"properties":{"id":{"type":"integer"}}}),
            json!({"properties":{"id":{"type":"string"}},"required":["new"]}),
        ] {
            assert!(verify_contract(&actual, &expected).is_err());
        }
    }
    #[test]
    fn cache_is_bound_and_expires() {
        let temp = Scratch::new(&std::env::temp_dir()).unwrap();
        let file = temp.0.join("cache.json");
        save_cache(&file, "a", now());
        assert!(cached(&file, "a").is_some());
        assert!(cached(&file, "b").is_none());
        save_cache(&file, "a", now() - 8 * 86400);
        assert!(cached(&file, "a").is_none());
        std::fs::write(&file, "bad").unwrap();
        assert!(cached(&file, "a").is_none());
    }
    #[test]
    fn changed_binary_invalidates_fingerprint_and_security_enums_are_exact() {
        let temp = Scratch::new(&std::env::temp_dir()).unwrap();
        let binary = temp.0.join("cli");
        std::fs::write(&binary, "old").unwrap();
        let old = file_hash(&binary, &Client::default()).unwrap();
        std::fs::write(&binary, "new").unwrap();
        assert_ne!(old, file_hash(&binary, &Client::default()).unwrap());
        let expected = json!({"properties":{"sandbox":{"type":"string","enum":["read-only"]}}});
        assert!(verify_contract(&json!({"properties":{"sandbox":{"type":"string","enum":["read-only","new-permission"]}}}),&expected).is_err());
    }
}
