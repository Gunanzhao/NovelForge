use crate::models::{AiCompletionInput, AiCompletionResult};

pub(crate) fn normalize_ai_endpoint(endpoint: &str) -> Result<String, String> {
    let value = endpoint.trim().trim_end_matches('/');
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err("AI Provider 地址必须以 http:// 或 https:// 开头".to_string());
    }
    if value.ends_with("/chat/completions") {
        Ok(value.to_string())
    } else if value.ends_with("/v1") {
        Ok(format!("{}/chat/completions", value))
    } else {
        Ok(format!("{}/v1/chat/completions", value))
    }
}

#[tauri::command]
pub fn ai_complete(input: AiCompletionInput) -> Result<AiCompletionResult, String> {
    if input.model.trim().is_empty() {
        return Err("AI Provider 模型不能为空".to_string());
    }
    if input.prompt.trim().is_empty() {
        return Err("AI 请求内容不能为空".to_string());
    }
    if input.prompt.chars().count() > 200_000 {
        return Err("AI 上下文过长，请减少选中的内容".to_string());
    }
    let endpoint = normalize_ai_endpoint(&input.endpoint)?;
    let mut payload = serde_json::json!({
        "model": input.model.trim(),
        "messages": [
            { "role": "system", "content": input.system_prompt.trim() },
            { "role": "user", "content": input.prompt.trim() },
        ],
    });
    if let Some(temperature) = input.temperature {
        if temperature.is_finite() {
            payload["temperature"] = serde_json::json!(temperature.clamp(0.0, 2.0));
        }
    }
    if let Some(max_tokens) = input.max_tokens {
        payload["max_tokens"] = serde_json::json!(max_tokens.clamp(1, 32_000));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "无法初始化 AI Provider 网络客户端".to_string())?;
    let mut request = client.post(endpoint).json(&payload);
    if !input.api_key.trim().is_empty() {
        request = request.bearer_auth(input.api_key.trim());
    }
    let response = request
        .send()
        .map_err(|_| "AI Provider 网络请求失败，请检查地址、网络或本地服务状态".to_string())?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .map_err(|_| "AI Provider 返回了无法解析的响应".to_string())?;
    if !status.is_success() {
        return Err(format!(
            "AI Provider 返回 HTTP {}，请检查模型和鉴权设置",
            status.as_u16()
        ));
    }
    let content = body
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            body.get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("text"))
                .and_then(serde_json::Value::as_str)
        })
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "AI Provider 返回中没有可用内容".to_string())?;
    let model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(input.model.trim())
        .to_string();
    Ok(AiCompletionResult {
        content: content.to_string(),
        model,
    })
}
