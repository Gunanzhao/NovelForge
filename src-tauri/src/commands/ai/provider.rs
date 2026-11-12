use super::{
    normalize_ai_endpoint, response_content, response_incomplete, StreamSink, MAX_AI_RESPONSE_BYTES,
};
use crate::models::{AiCompletionInput, AiCompletionResult, AiUsage};
use serde::Serialize;
use serde_json::{json, Value};

pub(super) fn is_deepseek(endpoint: &str, kind: Option<&str>) -> bool {
    match kind {
        Some("deepseek") => true,
        Some("compatible") => false,
        _ => reqwest::Url::parse(endpoint)
            .ok()
            .is_some_and(|url| url.host_str() == Some("api.deepseek.com")),
    }
}

pub(super) fn payload(input: &AiCompletionInput) -> Result<Value, String> {
    if input.model.trim().is_empty() {
        return Err("AI Provider 模型不能为空".into());
    }
    if input.prompt.trim().is_empty() {
        return Err("AI 请求内容不能为空".into());
    }
    if input
        .system_prompt
        .chars()
        .chain(input.prompt.chars())
        .take(200_001)
        .count()
        > 200_000
    {
        return Err("AI 上下文过长，请减少选中的内容".into());
    }
    let deepseek = is_deepseek(&input.endpoint, input.provider_kind.as_deref());
    if deepseek && input.api_key.trim().is_empty() {
        return Err("请填写 DeepSeek API Key。".into());
    }
    let thinking = deepseek && input.thinking.as_deref() == Some("enabled");
    if deepseek
        && input
            .thinking
            .as_deref()
            .is_some_and(|s| !["enabled", "disabled"].contains(&s))
    {
        return Err("无效的 DeepSeek 思考模式".into());
    }
    let mut body = json!({"model": input.model.trim(), "messages": [{"role":"system","content":input.system_prompt.trim()}, {"role":"user","content":input.prompt.trim()}]});
    if deepseek {
        body["thinking"] = json!({"type": if thinking { "enabled" } else { "disabled" }});
        if thinking {
            let effort = input.reasoning_effort.as_deref().unwrap_or("high");
            if !["low", "high", "max"].contains(&effort) {
                return Err("无效的 DeepSeek 思考强度".into());
            }
            body["reasoning_effort"] = json!(effort);
        }
    }
    if !thinking {
        if let Some(value) = input.temperature.filter(|n| n.is_finite()) {
            body["temperature"] = json!(value.clamp(0.0, 2.0));
        }
    }
    if let Some(value) = input.max_tokens {
        body["max_tokens"] = json!(value.clamp(1, if deepseek { 65_536 } else { 32_000 }));
    }
    if input.stream.unwrap_or(false) {
        body["stream"] = json!(true);
        if deepseek {
            body["stream_options"] = json!({"include_usage":true});
        }
    }
    Ok(body)
}

pub(super) fn status_error(status: reqwest::StatusCode) -> String {
    let hint = match status.as_u16() {
        400 | 422 => "请求参数不被模型接受，请检查模型、思考设置与输出上限",
        401 => "API Key 无效或已失效，请重新填写",
        402 => "账户余额不足，请检查服务账户余额",
        403 => "没有访问权限，请检查 API Key 与模型权限",
        404 => "接口或模型不存在，请检查服务地址与模型名称",
        429 => "请求过于频繁或并发已满，请稍后重试",
        500 | 502 | 503 | 504 => "服务暂时不可用，请稍后重试",
        _ => "请检查模型和鉴权设置",
    };
    format!("AI Provider 返回 HTTP {}：{hint}", status.as_u16())
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "AI 请求等待超时，可提高连接设置中的等待时限，或关闭思考模式后重试。".into()
    } else {
        "AI Provider 网络请求失败，请检查地址、网络或本地服务状态".into()
    }
}

fn client(seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(seconds))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 AI Provider 网络客户端".into())
}

fn check_status(response: &reqwest::Response) -> Result<(), String> {
    let status = response.status();
    if status.is_redirection() {
        return Err(format!(
            "AI Provider 返回 HTTP {} 重定向；为避免内容被转发，请直接填写最终地址",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        return Err(status_error(status));
    }
    Ok(())
}

async fn read_json(mut response: reqwest::Response, limit: u64) -> Result<Value, String> {
    if response.content_length().is_some_and(|n| n > limit) {
        return Err(if limit == MAX_AI_RESPONSE_BYTES {
            "AI Provider 响应超过 2 MiB 安全上限"
        } else {
            "模型列表超过 256 KiB 安全上限"
        }
        .into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() as u64 + chunk.len() as u64 > limit {
            return Err(if limit == MAX_AI_RESPONSE_BYTES {
                "AI Provider 响应超过 2 MiB 安全上限"
            } else {
                "模型列表超过 256 KiB 安全上限"
            }
            .into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "AI Provider 返回了无法解析的响应".into())
}

pub(super) fn usage(body: &Value) -> Option<AiUsage> {
    let value = body.get("usage")?.as_object()?;
    let usage = AiUsage {
        prompt_tokens: value.get("prompt_tokens").and_then(Value::as_u64),
        completion_tokens: value.get("completion_tokens").and_then(Value::as_u64),
        total_tokens: value.get("total_tokens").and_then(Value::as_u64),
        reasoning_tokens: value
            .get("completion_tokens_details")
            .and_then(|v| v.get("reasoning_tokens"))
            .and_then(Value::as_u64),
        cached_tokens: value
            .get("prompt_cache_hit_tokens")
            .and_then(Value::as_u64)
            .or_else(|| {
                value
                    .get("prompt_tokens_details")
                    .and_then(|v| v.get("cached_tokens"))
                    .and_then(Value::as_u64)
            }),
    };
    if usage.prompt_tokens.is_none()
        && usage.completion_tokens.is_none()
        && usage.total_tokens.is_none()
    {
        None
    } else {
        Some(usage)
    }
}

pub(super) async fn complete(
    input: AiCompletionInput,
    sink: Option<StreamSink>,
) -> Result<AiCompletionResult, String> {
    let body = payload(&input)?;
    let endpoint = normalize_ai_endpoint(&input.endpoint)?;
    let deepseek = is_deepseek(&endpoint, input.provider_kind.as_deref());
    let seconds = input
        .timeout_seconds
        .unwrap_or(if deepseek { 300 } else { 120 })
        .clamp(30, 600);
    let mut request = client(seconds)?.post(endpoint).json(&body);
    if !input.api_key.trim().is_empty() {
        request = request.bearer_auth(input.api_key.trim());
    }
    let mut response = request.send().await.map_err(network_error)?;
    check_status(&response)?;
    let streaming = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.to_ascii_lowercase().starts_with("text/event-stream"));
    let (body, stream_complete) = if streaming {
        let mut parser = super::stream::StreamResponse::default();
        let mut total = 0_u64;
        let mut previous = String::new();
        while let Some(chunk) = response.chunk().await.map_err(network_error)? {
            total += chunk.len() as u64;
            // SSE envelopes repeat metadata per token; bound wire traffic separately
            // while StreamResponse still limits each event and the final text to 2 MiB.
            if total > 32 * 1024 * 1024 {
                return Err("AI 流式传输超过 32 MiB 安全上限".into());
            }
            parser.push(&chunk)?;
            let content = parser.visible_content();
            if content != previous {
                if let Some(ref emit) = sink {
                    emit(super::AiStreamEvent {
                        content: content.clone(),
                    });
                }
                previous = content;
            }
            if parser.done {
                break;
            }
        }
        parser.finish()?
    } else {
        (read_json(response, MAX_AI_RESPONSE_BYTES).await?, true)
    };
    Ok(AiCompletionResult {
        content: response_content(&body)?,
        model: body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(input.model.trim())
            .to_string(),
        incomplete: !stream_complete || response_incomplete(&body),
        usage: usage(&body),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    id: String,
    name: Option<String>,
    context_window: Option<u64>,
    max_output_tokens: Option<u64>,
}

pub(super) fn models_endpoint(endpoint: &str) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(&normalize_ai_endpoint(endpoint)?).map_err(|_| "服务地址无效")?;
    let path = url.path().trim_end_matches("/chat/completions").to_string();
    url.set_path(&format!("{path}/models"));
    Ok(url.into())
}

#[tauri::command]
pub async fn ai_models(
    endpoint: String,
    api_key: String,
    provider_kind: Option<String>,
) -> Result<Vec<ProviderModel>, String> {
    if is_deepseek(&endpoint, provider_kind.as_deref()) && api_key.trim().is_empty() {
        return Err("请填写 DeepSeek API Key。".into());
    }
    let mut request = client(20)?.get(models_endpoint(&endpoint)?);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request.send().await.map_err(network_error)?;
    check_status(&response)?;
    let body = read_json(response, 256 * 1024).await?;
    let values = body["data"]
        .as_array()
        .ok_or("模型列表格式无效，请检查服务地址")?;
    let mut models = Vec::new();
    for item in values.iter().take(1000) {
        if let Some(id) = item["id"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 256)
        {
            models.push(ProviderModel {
                id: id.to_string(),
                name: item["name"].as_str().map(|s| s.chars().take(256).collect()),
                context_window: item["context_window"].as_u64(),
                max_output_tokens: item["max_output_tokens"].as_u64(),
            });
        }
    }
    if models.is_empty() {
        return Err("连接成功，但服务未返回可用模型。请检查模型访问权限。".into());
    }
    Ok(models)
}
