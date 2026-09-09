use crate::models::{AiCompletionInput, AiCompletionResult};
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use tokio::sync::watch;

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
            let error = tauri::async_runtime::block_on(complete_http(input)).unwrap_err();
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

struct ActiveRequest {
    id: String,
    cancel: watch::Sender<bool>,
    done: watch::Receiver<bool>,
}
#[derive(Default)]
struct Requests {
    active: HashMap<String, ActiveRequest>,
    cancelled: VecDeque<(String, String)>,
}
fn requests() -> &'static Mutex<Requests> {
    static REQUESTS: OnceLock<Mutex<Requests>> = OnceLock::new();
    REQUESTS.get_or_init(Default::default)
}
struct RequestGuard {
    owner: String,
    id: String,
    done: watch::Sender<bool>,
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = requests().lock() {
            if state
                .active
                .get(&self.owner)
                .is_some_and(|entry| entry.id == self.id)
            {
                state.active.remove(&self.owner);
            }
        }
        let _ = self.done.send(true);
    }
}
async fn run_request(
    owner: String,
    id: String,
    input: AiCompletionInput,
) -> Result<AiCompletionResult, String> {
    if id.is_empty() || id.len() > 128 {
        return Err("无效的 Provider 请求 ID".into());
    }
    let (cancel, mut cancelled) = watch::channel(false);
    let (done, finished) = watch::channel(false);
    {
        let mut state = requests().lock().map_err(|_| "Provider 状态不可用")?;
        if let Some(index) = state
            .cancelled
            .iter()
            .position(|entry| entry == &(owner.clone(), id.clone()))
        {
            state.cancelled.remove(index);
            return Err("AI 生成已取消".into());
        }
        if state.active.contains_key(&owner) {
            return Err("上一个 Provider 请求仍在结束，请稍后重试。".into());
        }
        state.active.insert(
            owner.clone(),
            ActiveRequest {
                id: id.clone(),
                cancel,
                done: finished,
            },
        );
    }
    let _guard = RequestGuard { owner, id, done };
    tokio::select! {
        biased;
        _ = cancelled.changed() => Err("AI 生成已取消".into()),
        result = complete_http(input) => result,
    }
}
async fn cancel_request(owner: &str, id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("无效的 Provider 请求 ID".into());
    }
    let pending = {
        let mut state = requests().lock().map_err(|_| "Provider 状态不可用")?;
        if let Some(entry) = state.active.get(owner).filter(|entry| entry.id == id) {
            let _ = entry.cancel.send(true);
            Some(entry.done.clone())
        } else {
            if state.cancelled.len() >= 64 {
                state.cancelled.pop_front();
            }
            state
                .cancelled
                .push_back((owner.to_string(), id.to_string()));
            None
        }
    };
    if let Some(mut done) = pending {
        if !*done.borrow() {
            let _ = done.changed().await;
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn ai_complete(
    window: tauri::WebviewWindow,
    input: AiCompletionInput,
    request_id: Option<String>,
) -> Result<AiCompletionResult, String> {
    run_request(
        window.label().to_string(),
        request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        input,
    )
    .await
}
#[tauri::command]
pub async fn ai_cancel(window: tauri::WebviewWindow, request_id: String) -> Result<(), String> {
    cancel_request(window.label(), &request_id).await
}
#[cfg(test)]
pub(crate) async fn ai_complete_for_test(
    input: AiCompletionInput,
) -> Result<AiCompletionResult, String> {
    complete_http(input).await
}

async fn complete_http(input: AiCompletionInput) -> Result<AiCompletionResult, String> {
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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 AI Provider 网络客户端".to_string())?;
    let mut request = client.post(endpoint).json(&payload);
    if !input.api_key.trim().is_empty() {
        request = request.bearer_auth(input.api_key.trim());
    }
    let mut response = request
        .send()
        .await
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
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "无法读取 AI Provider 响应".to_string())?
    {
        if body_bytes.len() as u64 + chunk.len() as u64 > MAX_AI_RESPONSE_BYTES {
            return Err("AI Provider 响应超过 2 MiB 安全上限".into());
        }
        body_bytes.extend_from_slice(&chunk);
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

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;
    fn input(endpoint: String) -> AiCompletionInput {
        AiCompletionInput {
            endpoint,
            api_key: String::new(),
            model: "mock".into(),
            system_prompt: "system".into(),
            prompt: "prompt".into(),
            temperature: None,
            max_tokens: Some(100),
        }
    }
    #[test]
    fn cancel_releases_socket_and_slot_during_headers_and_body() {
        for partial_body in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let (sent, ready) = std::sync::mpsc::channel();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
                        let size: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= header_end + 4 + size {
                            break;
                        }
                    }
                }
                if partial_body {
                    stream
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{")
                        .unwrap();
                }
                sent.send(()).unwrap();
                let mut byte = [0; 1];
                match stream.read(&mut byte) {
                    Ok(0) => (),
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::ConnectionReset
                                | std::io::ErrorKind::ConnectionAborted
                        ) =>
                    {
                        ()
                    }
                    other => panic!("cancel did not close socket: {other:?}"),
                }
            });
            tauri::async_runtime::block_on(async {
                let owner = uuid::Uuid::new_v4().to_string();
                let run = tauri::async_runtime::spawn(run_request(
                    owner.clone(),
                    "first".into(),
                    input(endpoint.clone()),
                ));
                tauri::async_runtime::spawn_blocking(move || {
                    ready.recv_timeout(Duration::from_secs(5)).unwrap()
                })
                .await
                .unwrap();
                assert!(run_request(owner.clone(), "second".into(), input(endpoint))
                    .await
                    .unwrap_err()
                    .contains("仍在结束"));
                cancel_request("another-window", "first").await.unwrap();
                assert!(requests().lock().unwrap().active.contains_key(&owner));
                tokio::time::timeout(Duration::from_secs(2), cancel_request(&owner, "first"))
                    .await
                    .unwrap()
                    .unwrap();
                assert!(run.await.unwrap().unwrap_err().contains("取消"));
                assert!(!requests().lock().unwrap().active.contains_key(&owner));
                assert!(run_request(owner, "next".into(), input("invalid".into()))
                    .await
                    .unwrap_err()
                    .contains("地址格式"));
            });
            server.join().unwrap();
        }
    }
    #[test]
    fn cancellation_before_registration_does_not_send_request() {
        tauri::async_runtime::block_on(async {
            let owner = uuid::Uuid::new_v4().to_string();
            cancel_request(&owner, "early").await.unwrap();
            assert!(run_request(owner, "early".into(), input("invalid".into()))
                .await
                .unwrap_err()
                .contains("取消"));
        });
    }
}
