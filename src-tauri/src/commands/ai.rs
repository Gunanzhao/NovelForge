use crate::models::{AiCompletionInput, AiCompletionResult};
use std::io::Read;

const MAX_AI_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combined_context_limit_is_checked_before_endpoint_or_network() {
        for (system_length, user_length, too_long) in [
            (100_000, 100_000, false),
            (100_001, 100_000, true),
            (200_000, 1, true),
            (0, 200_000, false),
            (0, 200_001, true),
        ] {
            let input = AiCompletionInput {
                endpoint: "invalid endpoint".to_string(),
                api_key: String::new(),
                model: "test".to_string(),
                system_prompt: "系".repeat(system_length),
                prompt: "文".repeat(user_length),
                temperature: None,
                max_tokens: None,
            };
            let error = ai_complete(input).unwrap_err();
            assert_eq!(
                error,
                if too_long {
                    "AI 上下文过长，请减少选中的内容"
                } else {
                    "AI Provider 地址格式无效"
                },
                "system={system_length}, user={user_length}"
            );
        }
    }
}

pub(crate) fn normalize_ai_endpoint(endpoint: &str) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(endpoint.trim()).map_err(|_| "AI Provider 地址格式无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("AI Provider 地址必须使用 http:// 或 https://".to_string());
    }
    if url.host_str().is_none() {
        return Err("AI Provider 地址缺少有效主机".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("AI Provider 地址不能包含用户名或密码".to_string());
    }
    if url.fragment().is_some() {
        return Err("AI Provider 地址不能包含片段标识".to_string());
    }
    let path = url.path().trim_end_matches('/');
    let path = if path.ends_with("/chat/completions") {
        path.to_string()
    } else if path.ends_with("/v1") {
        format!("{path}/chat/completions")
    } else {
        format!("{path}/v1/chat/completions")
    };
    url.set_path(&path);
    Ok(url.to_string())
}

#[tauri::command]
pub fn ai_complete(input: AiCompletionInput) -> Result<AiCompletionResult, String> {
    if input.model.trim().is_empty() {
        return Err("AI Provider 模型不能为空".to_string());
    }
    if input.prompt.trim().is_empty() {
        return Err("AI 请求内容不能为空".to_string());
    }
    if input
        .system_prompt
        .chars()
        .chain(input.prompt.chars())
        .take(200_001)
        .count()
        > 200_000
    {
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
        .redirect(reqwest::redirect::Policy::none())
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
    if status.is_redirection() {
        return Err(format!(
            "AI Provider 返回 HTTP {} 重定向；为避免内容被转发，请直接填写最终地址",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        return Err(format!(
            "AI Provider 返回 HTTP {}，请检查模型和鉴权设置",
            status.as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_AI_RESPONSE_BYTES)
    {
        return Err("AI Provider 响应超过 2 MiB 安全上限".to_string());
    }
    let mut body_bytes = Vec::new();
    response
        .take(MAX_AI_RESPONSE_BYTES + 1)
        .read_to_end(&mut body_bytes)
        .map_err(|_| "无法读取 AI Provider 响应".to_string())?;
    if body_bytes.len() as u64 > MAX_AI_RESPONSE_BYTES {
        return Err("AI Provider 响应超过 2 MiB 安全上限".to_string());
    }
    let body = serde_json::from_slice::<serde_json::Value>(&body_bytes)
        .map_err(|_| "AI Provider 返回了无法解析的响应".to_string())?;
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
