use super::*;

pub(super) struct CheckGuard(Arc<Client>);
impl CheckGuard {
    pub fn start(owner: Arc<Client>, id: &str) -> Result<Self, String> {
        Self::begin(owner, id, false)
    }
    pub fn generation(owner: Arc<Client>, id: &str) -> Result<Self, String> {
        Self::begin(owner, id, true)
    }
    fn begin(owner: Arc<Client>, id: &str, generation: bool) -> Result<Self, String> {
        if id.is_empty() || id.len() > 160 {
            return Err("无效检查 ID".into());
        }
        if !generation && owner.active.lock().map_err(|_| "生成状态不可用")?.is_some() {
            return Err("Codex 正在生成，请完成或停止后检查连接".into());
        }
        {
            let mut checking = owner.checking.lock().map_err(|_| "Codex 检查状态不可用")?;
            if checking.is_some() {
                return Err("Codex 正在进行兼容检查".into());
            }
            let mut cancelled = owner
                .cancelled_checks
                .lock()
                .map_err(|_| "检查取消状态不可用")?;
            if let Some(index) = cancelled.iter().position(|v| v == id) {
                cancelled.remove(index);
                return Err("兼容检查已取消".into());
            }
            owner.check_cancel.store(false, Ordering::SeqCst);
            *owner
                .check_deadline
                .lock()
                .map_err(|_| "Codex 检查状态不可用")? =
                Some(Instant::now() + Duration::from_secs(90));
            *checking = Some(id.into());
        }
        Ok(Self(owner))
    }
}
impl Drop for CheckGuard {
    fn drop(&mut self) {
        if let Ok(mut checking) = self.0.checking.lock() {
            *checking = None;
            self.0.check_cancel.store(false, Ordering::SeqCst);
            if let Ok(mut deadline) = self.0.check_deadline.lock() {
                *deadline = None;
            }
        }
    }
}

fn config_fingerprint(config: &Value, owner: &Client) -> Result<String, String> {
    let mut effective = config.clone();
    effective["model_catalog_json"] = Value::Null;
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|p| PathBuf::from(p).join(".codex"))
        });
    let disk = if let Some(path) = home.map(|p| p.join("config.toml")).filter(|p| p.is_file()) {
        compatibility::file_hash(&path, owner)?
    } else {
        String::new()
    };
    Ok(compatibility::digest(
        json!({"effective":effective,"disk":disk})
            .to_string()
            .as_bytes(),
    ))
}

pub(super) fn prepare(
    rpc: &mut Rpc,
    owner: &Client,
    model: &str,
    effort: &str,
    force: bool,
    mut phase: impl FnMut(&str),
) -> Result<Value, String> {
    rpc.verified_key = None;
    compatibility::check_stop(owner)?;
    phase("configuration");
    let path = rpc.path.clone();
    let parent = rpc.cwd.parent().ok_or("检查缓存路径无效")?.to_owned();
    let fingerprint = compatibility::file_hash(&path, owner)?;
    let version = compatibility::version(&path, owner)?;
    // Rebuild from disk; do not authorize from an old process's configuration snapshot.
    let mut safe = Rpc::connect(path.clone(), rpc.cwd.clone(), owner)?;
    safe.version = version.clone();
    safe.fingerprint = fingerprint.clone();
    let config =
        safe.read_call("config/read", json!({"includeLayers":false}), owner)?["config"].clone();
    check_config(&config, safe.catalog.as_ref().map(|c| c.0.as_path()))?;
    let models = safe.list_models(owner)?;
    let selected = models
        .iter()
        .find(|m| m["model"] == model)
        .ok_or("所选模型已不可用，请重新选择模型")?;
    if !selected["supportedReasoningEfforts"]
        .as_array()
        .is_some_and(|items| items.iter().any(|v| v["reasoningEffort"] == effort))
    {
        return Err("所选推理强度已不可用，请重新选择".into());
    }
    let normalized = text_catalog(std::slice::from_ref(selected))?;
    let config_key = config_fingerprint(&config, owner)?;
    let key = compatibility::digest(json!({"binary":fingerprint,"adapter":compatibility::ADAPTER,"verifier":compatibility::VERIFIER,"model":normalized,"effort":effort,"config":config_key}).to_string().as_bytes());
    let cache = parent.join(format!("compat-{key}.json"));
    if force {
        let _ = std::fs::remove_file(&cache);
    }
    let hit = if force {
        None
    } else {
        compatibility::cached(&cache, &key)
    };
    let checked = if let Some(checked) = hit {
        checked
    } else {
        phase("protocol");
        compatibility::verify_schema(&path, &version, &parent, owner)?;
        phase("verification");
        verification::verify(&path, &parent, selected, effort, owner)?;
        compatibility::check_stop(owner)?;
        compatibility::now()
    };
    // Catch binary replacement or config edits while the verifier was running.
    if compatibility::file_hash(&path, owner)? != fingerprint
        || config_fingerprint(&config, owner)? != config_key
    {
        return Err("检查期间 CLI 或配置发生变化，请重新检查".into());
    }
    let final_config =
        safe.read_call("config/read", json!({"includeLayers":false}), owner)?["config"].clone();
    check_config(&final_config, safe.catalog.as_ref().map(|c| c.0.as_path()))?;
    if config_fingerprint(&final_config, owner)? != config_key {
        return Err("检查期间配置发生变化，请重新检查".into());
    }
    safe.verified_key = Some(key.clone());
    safe.owns_cwd = rpc.owns_cwd;
    rpc.owns_cwd = false;
    *rpc = safe;
    compatibility::save_cache(&cache, &key, checked);
    Ok(
        json!({"state":"passed","stage":"complete","adapter":compatibility::ADAPTER,"checkedAt":checked,"cached":hit.is_some(),"diagnostic":null}),
    )
}

pub(super) fn normalize_limits(raw: &Value) -> Value {
    let source = raw["rateLimitsByLimitId"]
        .as_object()
        .filter(|m| !m.is_empty());
    let buckets: Vec<_> = if let Some(source) = source {
        source
            .iter()
            .map(|(id, value)| (id.clone(), value))
            .collect()
    } else if raw["rateLimits"].is_object() {
        vec![("codex".into(), &raw["rateLimits"])]
    } else {
        vec![]
    };
    Value::Array(buckets.into_iter().map(|(id,value)| {
        let windows:Vec<_>=["primary","secondary"].into_iter().filter_map(|name| {
            let window=&value[name];
            let used=window["usedPercent"].as_f64().filter(|p| p.is_finite())?;
            Some(json!({"name":name,"usedPercent":used.clamp(0.0,100.0),"windowDurationMins":window["windowDurationMins"],"resetsAt":window["resetsAt"]}))
        }).collect();
        json!({"id":id,"name":value["limitName"].as_str().unwrap_or(&id),"windows":windows})
    }).collect())
}

fn diagnosis(error: &str, stage: &str) -> Value {
    let (code, retryable) = if error.contains("取消") {
        ("cancelled", true)
    } else if error.contains("超时") || error.contains("90 秒") {
        ("timeout", true)
    } else if error.contains("协议") || error.contains("不兼容") {
        ("unsupported_protocol", false)
    } else if error.contains("模型") || error.contains("推理") {
        ("model_unavailable", true)
    } else if error.contains("配置") || error.contains("工具") || error.contains("权限") {
        ("isolation_failed", false)
    } else {
        ("connection_failed", true)
    };
    // Errors are generated by this adapter; raw CLI JSON/config/stderr are never returned.
    json!({"code":code,"stage":stage,"message":error.chars().take(240).collect::<String>(),"retryable":retryable})
}

pub(super) fn check(
    window: &tauri::WebviewWindow,
    path: &str,
    request_id: &str,
    model: &str,
    effort: &str,
    force: bool,
) -> Value {
    let mut report = json!({"version":null,"cliPath":path,"authMode":"unknown","planType":null,"ready":false,"models":[],"selectedModel":model,"selectedEffort":effort,"rateLimits":[],"compatibility":{"state":"checking","stage":"discovery","adapter":null,"checkedAt":null,"cached":false,"diagnostic":null}});
    let mut stage = "discovery".to_owned();
    let emit = |stage: &str| {
        let _ = window.emit("codex-check", json!({"requestId":request_id,"stage":stage}));
    };
    emit(&stage);
    // Preserve identity even if app-server startup fails later.
    if let Ok(owner) = client(window) {
        if let Ok(resolved) = resolve_cli(path) {
            report["cliPath"] = json!(resolved);
            if let Ok(version) = compatibility::version(&resolved, &owner) {
                report["version"] = json!(version);
            }
        }
    }
    let outcome = with_rpc(window, path, |rpc, owner| {
        report["version"] = json!(rpc.version);
        report["cliPath"] = json!(rpc.path);
        stage = "account".into();
        emit(&stage);
        let account = rpc.read_call("account/read", json!({"refreshToken":false}), owner)?;
        let auth = account["account"]["type"].as_str().unwrap_or("none");
        report["authMode"] = json!(auth);
        report["planType"] = account["account"]["planType"].clone();
        if auth != "chatgpt" {
            report["compatibility"]["state"] = json!("unchecked");
            report["compatibility"]["stage"] = json!("account");
            return Ok(());
        }
        // Rate limits are optional; don't let a missing endpoint block writing.
        if let Ok(limits) = rpc.read_call("account/rateLimits/read", json!({}), owner) {
            report["rateLimits"] = normalize_limits(&limits);
        }
        stage = "models".into();
        emit(&stage);
        let models = rpc.list_models(owner)?;
        report["models"] = json!(models);
        let chosen = if model.is_empty() {
            models
                .iter()
                .find(|m| m["isDefault"] == true)
                .or_else(|| models.first())
        } else {
            models.iter().find(|m| m["model"] == model)
        }
        .ok_or("所选模型已不可用，请重新选择模型")?;
        let chosen_model = chosen["model"].as_str().ok_or("模型标识无效")?;
        let chosen_effort = if model.is_empty() || effort.is_empty() {
            chosen["defaultReasoningEffort"]
                .as_str()
                .ok_or("默认推理强度无效")?
        } else {
            effort
        };
        report["selectedModel"] = json!(chosen_model);
        report["selectedEffort"] = json!(chosen_effort);
        report["compatibility"] =
            prepare(rpc, owner, chosen_model, chosen_effort, force, |next| {
                stage = next.into();
                emit(next);
            })?;
        report["ready"] = json!(true);
        Ok(())
    });
    if let Err(error) = outcome {
        let diagnostic = diagnosis(&error, &stage);
        report["compatibility"]["state"] = json!(if diagnostic["code"] == "unsupported_protocol" {
            "unsupported"
        } else {
            "failed"
        });
        report["compatibility"]["stage"] = json!(stage);
        report["compatibility"]["diagnostic"] = diagnostic;
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_new_and_old_limits_without_inventing_zero() {
        assert_eq!(normalize_limits(&json!({})), json!([]));
        let raw = json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"writing":{"primary":{"usedPercent":12},"secondary":null}}});
        assert_eq!(normalize_limits(&raw)[0]["windows"][0]["usedPercent"], 12.0);
        assert_eq!(
            normalize_limits(&json!({"rateLimits":{"primary":{"usedPercent":0}}}))[0]["windows"][0]
                ["usedPercent"],
            0.0
        );
    }
    #[test]
    fn checks_have_independent_cancellation_and_cleanup() {
        let owner = Arc::new(Client::default());
        let guard = CheckGuard::start(owner.clone(), "check").unwrap();
        assert!(CheckGuard::start(owner.clone(), "other").is_err());
        owner.check_cancel.store(true, Ordering::SeqCst);
        assert!(compatibility::check_stop(&owner).is_err());
        drop(guard);
        assert!(compatibility::check_stop(&owner).is_ok());
    }
    #[test]
    fn cancellation_before_start_deadlines_and_busy_generation() {
        let owner = Arc::new(Client::default());
        owner
            .cancelled_checks
            .lock()
            .unwrap()
            .push_back("early".into());
        assert!(CheckGuard::start(owner.clone(), "early").is_err());
        let guard = CheckGuard::start(owner.clone(), "check").unwrap();
        *owner.check_deadline.lock().unwrap() = Some(Instant::now() - Duration::from_millis(1));
        assert!(compatibility::check_stop(&owner)
            .unwrap_err()
            .contains("90 秒"));
        drop(guard);
        *owner.active.lock().unwrap() = Some("generation".into());
        assert!(CheckGuard::start(owner.clone(), "generate-spoof").is_err());
    }
    #[test]
    #[ignore = "Read installed CLI login and verify local fixture/cache; never runs a subscription generation"]
    fn installed_runtime_cache_probe() {
        let owner = Arc::new(Client::default());
        let _guard = CheckGuard::start(owner.clone(), "runtime-check").unwrap();
        let root = compatibility::Scratch::new(&std::env::temp_dir()).unwrap();
        let cwd = root.0.join("work");
        std::fs::create_dir(&cwd).unwrap();
        let path = resolve_cli("").unwrap();
        let mut rpc = Rpc::spawn(path, cwd, &[]).unwrap();
        rpc.initialize(&owner).unwrap();
        let account = rpc
            .read_call("account/read", json!({"refreshToken":false}), &owner)
            .unwrap();
        let models = rpc.list_models(&owner).unwrap();
        let model = models
            .iter()
            .find(|m| m["isDefault"] == true)
            .unwrap_or(&models[0]);
        let id = model["model"].as_str().unwrap();
        let effort = model["defaultReasoningEffort"].as_str().unwrap();
        let checked = prepare(&mut rpc, &owner, id, effort, true, |_| {}).unwrap();
        assert_eq!(checked["state"], "passed");
        assert_eq!(checked["cached"], false);
        let cached = prepare(&mut rpc, &owner, id, effort, false, |_| {}).unwrap();
        assert_eq!(cached["cached"], true);
        assert_eq!(checked["checkedAt"], cached["checkedAt"]);
        eprintln!(
            "CODEX_RUNTIME_CACHE_OK version={} auth={}",
            rpc.version,
            account["account"]["type"].as_str().unwrap_or("none")
        );
        drop(rpc);
    }
}
