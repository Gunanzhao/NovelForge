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
            let error = tauri::async_runtime::block_on(ai_complete(input)).unwrap_err();
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
pub async fn ai_complete(input: AiCompletionInput) -> Result<AiCompletionResult, String> {
    tauri::async_runtime::spawn_blocking(move || complete_blocking(input))
        .await
        .map_err(|_| "AI Provider 后台任务异常，请重试".to_string())?
}

fn complete_blocking(input: AiCompletionInput) -> Result<AiCompletionResult, String> {
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
    let content = response_content(&body)?;
    let model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(input.model.trim())
        .to_string();
    Ok(AiCompletionResult {
        content: content.to_string(),
        model,
        incomplete: response_incomplete(&body),
    })
}

fn response_incomplete(body: &serde_json::Value) -> bool {
    body["choices"][0]["finish_reason"]
        .as_str()
        .is_some_and(|reason| reason != "stop")
}

fn response_content(body: &serde_json::Value) -> Result<String, String> {
    let choice = &body["choices"][0];
    let message = &choice["message"];
    let raw = match &message["content"] {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter(|part| part["type"] == "text" || part["type"] == "output_text")
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    };
    let raw = if raw.trim().is_empty() {
        choice["text"].as_str().unwrap_or("")
    } else {
        &raw
    };
    let mut content = raw.trim();
    while let Some(thinking) = content.strip_prefix("<think>") {
        content = thinking
            .split_once("</think>")
            .map(|(_, text)| text.trim())
            .unwrap_or("");
    }
    if !content.is_empty() {
        return Ok(content.to_string());
    }
    if choice["finish_reason"] == "length" {
        let used = body["usage"]["completion_tokens"].as_u64();
        let reasoning = body["usage"]["completion_tokens_details"]["reasoning_tokens"].as_u64();
        let usage = match (used, reasoning) {
            (Some(total), Some(thought)) => {
                format!("已生成 {total} Token，其中思考 {thought} Token。")
            }
            (Some(total), None) => format!("已生成 {total} Token。"),
            _ => String::new(),
        };
        return Err(format!("AI 输出上限耗尽，尚未生成正文。{usage}请提高 Max Tokens 后重试，或在模型服务中关闭/降低思考；这会增加生成时间。"));
    }
    if message["refusal"]
        .as_str()
        .is_some_and(|text| !text.trim().is_empty())
        || choice["finish_reason"] == "content_filter"
    {
        return Err("AI 服务拒绝了本次请求，未返回正文。请调整请求后重试。".to_string());
    }
    if message["tool_calls"]
        .as_array()
        .is_some_and(|calls| !calls.is_empty())
    {
        return Err(
            "AI 返回了工具调用而非正文；当前写作模式不执行工具，请让模型直接输出文本。".to_string(),
        );
    }
    let thinking = ["reasoning_content", "reasoning"].iter().any(|key| {
        message[key]
            .as_str()
            .is_some_and(|text| !text.trim().is_empty())
    }) || raw.contains("<think>");
    if thinking {
        return Err(
            "AI 仅返回了思考内容，未返回正文。请调整模型的思考设置或输出上限后重试。".to_string(),
        );
    }
    Err(
        "AI Provider 返回中没有可用正文。请检查模型是否支持文本对话及服务响应格式，然后重试。"
            .to_string(),
    )
}

#[cfg(test)]
mod response_tests {
    use super::{response_content, response_incomplete};
    use serde_json::json;
    #[test]
    fn partial_text_keeps_its_incomplete_status() {
        for reason in ["length", "content_filter", "tool_calls"] {
            let body =
                json!({"choices":[{"finish_reason":reason,"message":{"content":"半段正文"}}]});
            assert_eq!(response_content(&body).unwrap(), "半段正文");
            assert!(response_incomplete(&body));
        }
        assert!(!response_incomplete(
            &json!({"choices":[{"finish_reason":"stop"}]})
        ));
        assert!(!response_incomplete(
            &json!({"choices":[{"message":{"content":"兼容旧服务"}}]})
        ));
    }
    #[test]
    fn parses_text_blocks_and_legacy_fallback() {
        assert_eq!(response_content(&json!({"choices":[{"message":{"content":[{"type":"text","text":"正文"},{"type":"reasoning","text":"private"},{"type":"text","text":"结束"}]}}]})).unwrap(), "正文结束");
        assert_eq!(
            response_content(&json!({"choices":[{"message":{"content":" "},"text":"旧格式正文"}]}))
                .unwrap(),
            "旧格式正文"
        );
    }
    #[test]
    fn exhausted_reasoning_budget_is_actionable_without_exposing_thoughts() {
        let error = response_content(&json!({"choices":[{"finish_reason":"length","message":{"content":"","reasoning_content":"private thoughts"}}],"usage":{"completion_tokens":1024,"completion_tokens_details":{"reasoning_tokens":1024}}})).unwrap_err();
        assert!(
            error.contains("输出上限耗尽") && error.contains("1024") && !error.contains("private")
        );
    }
    #[test]
    fn thinking_is_never_used_as_manuscript() {
        assert!(response_content(
            &json!({"choices":[{"message":{"content":null,"reasoning":"private"}}]})
        )
        .unwrap_err()
        .contains("仅返回了思考"));
        assert_eq!(
            response_content(
                &json!({"choices":[{"message":{"content":"<think>private</think>正文"}}]})
            )
            .unwrap(),
            "正文"
        );
        assert!(
            response_content(&json!({"choices":[{"message":{"content":"<think>private"}}]}))
                .is_err()
        );
    }
    #[test]
    fn distinguishes_refusal_tools_and_invalid_choices() {
        for (body, expected) in [
            (
                json!({"choices":[{"message":{"refusal":"private"}}]}),
                "拒绝",
            ),
            (
                json!({"choices":[{"message":{"tool_calls":[{}]}}]}),
                "工具调用",
            ),
            (json!({"choices":[]}), "没有可用正文"),
        ] {
            assert!(response_content(&body).unwrap_err().contains(expected));
        }
    }
}
