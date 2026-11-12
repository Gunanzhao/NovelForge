use super::{provider, response_content, response_incomplete, stream::StreamResponse};
use crate::models::AiCompletionInput;
use serde_json::{json, Value};

fn input() -> AiCompletionInput {
    AiCompletionInput {
        endpoint: "https://api.deepseek.com/chat/completions".into(),
        api_key: "test-key".into(),
        model: "deepseek-flash".into(),
        prompt: "续写".into(),
        temperature: Some(0.7),
        max_tokens: Some(999_999),
        stream: Some(true),
        ..Default::default()
    }
}

#[test]
fn deepseek_defaults_to_writing_and_sends_only_supported_parameters() {
    let body = provider::payload(&input()).unwrap();
    assert_eq!(body["thinking"]["type"], "disabled");
    assert_eq!(body["max_tokens"], 65_536);
    assert_eq!(body["stream_options"]["include_usage"], true);
    assert!(body.get("temperature").is_some());
    assert!(body.get("reasoning_effort").is_none());
    let body = provider::payload(&AiCompletionInput {
        thinking: Some("enabled".into()),
        reasoning_effort: Some("low".into()),
        ..input()
    })
    .unwrap();
    assert_eq!(body["reasoning_effort"], "low");
    assert!(body.get("temperature").is_none());
    assert!(provider::payload(&AiCompletionInput {
        api_key: String::new(),
        ..input()
    })
    .unwrap_err()
    .contains("API Key"));
}

#[test]
fn custom_compatible_providers_keep_the_original_contract() {
    let body = provider::payload(&AiCompletionInput {
        provider_kind: Some("compatible".into()),
        api_key: String::new(),
        thinking: Some("enabled".into()),
        ..input()
    })
    .unwrap();
    assert_eq!(body["max_tokens"], 32_000);
    assert!(body.get("temperature").is_some());
    assert!(body.get("thinking").is_none());
    assert!(body.get("reasoning_effort").is_none());
    assert!(body.get("stream_options").is_none());
}

#[test]
fn model_urls_preserve_proxy_prefix_and_support_full_and_base_urls() {
    for (url, expected) in [
        (
            "https://api.deepseek.com",
            "https://api.deepseek.com/models",
        ),
        (
            "https://api.deepseek.com/chat/completions",
            "https://api.deepseek.com/models",
        ),
        (
            "https://api.deepseek.com/v1",
            "https://api.deepseek.com/v1/models",
        ),
        (
            "http://localhost:1234/proxy/v1/chat/completions",
            "http://localhost:1234/proxy/v1/models",
        ),
    ] {
        assert_eq!(provider::models_endpoint(url).unwrap(), expected);
    }
}

fn frame(value: Value) -> String {
    format!("data: {}\r\n\r\n", value)
}

#[test]
fn streaming_handles_byte_boundaries_keepalive_reasoning_and_usage() {
    let wire = format!(
        ": keep-alive\r\n\r\n{}{}{}data: [DONE]\r\n\r\n",
        frame(json!({"choices":[{"index":0,"delta":{"reasoning_content":"不能进入正文的思考"}}]})),
        frame(
            json!({"model":"deepseek-flash","choices":[{"index":0,"delta":{"content":"夜色🌙"}}]})
        ),
        frame(
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"completion_tokens_details":{"reasoning_tokens":15},"prompt_cache_hit_tokens":5}})
        )
    );
    let mut parser = StreamResponse::default();
    for byte in wire.as_bytes() {
        parser.push(&[*byte]).unwrap();
        assert!(!parser.visible_content().contains("思考"));
    }
    let (body, done) = parser.finish().unwrap();
    assert!(done && !response_incomplete(&body));
    assert_eq!(response_content(&body).unwrap(), "夜色🌙");
    let usage = provider::usage(&body).unwrap();
    assert_eq!(usage.reasoning_tokens, Some(15));
    assert_eq!(usage.cached_tokens, Some(5));
}

#[test]
fn split_think_tags_are_never_exposed() {
    let mut parser = StreamResponse::default();
    for text in ["<thi", "nk>秘密", "</think>", "正文"] {
        parser
            .push(frame(json!({"choices":[{"delta":{"content":text}}]})).as_bytes())
            .unwrap();
        assert!(!parser.visible_content().contains("秘密"));
    }
    assert_eq!(parser.visible_content(), "正文");
}

#[test]
fn missing_done_and_nonstop_finish_are_not_complete() {
    for reason in ["stop", "length", "tool_calls"] {
        let mut parser = StreamResponse::default();
        parser
            .push(
                frame(json!({"choices":[{"delta":{"content":"部分正文"},"finish_reason":reason}]}))
                    .as_bytes(),
            )
            .unwrap();
        let (body, done) = parser.finish().unwrap();
        assert!(!done);
        assert_eq!(response_content(&body).unwrap(), "部分正文");
        if reason != "stop" {
            assert!(response_incomplete(&body));
        }
    }
}

#[test]
fn usage_only_chunks_and_truncated_stream_errors_are_handled() {
    let mut parser = StreamResponse::default();
    parser
        .push(
            frame(json!({"choices":[{"delta":{"content":"正文"},"finish_reason":"stop"}]}))
                .as_bytes(),
        )
        .unwrap();
    parser
        .push(
            frame(json!({"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}))
                .as_bytes(),
        )
        .unwrap();
    parser.push(b"data: [DONE]").unwrap();
    let (body, done) = parser.finish().unwrap();
    assert!(done);
    assert_eq!(provider::usage(&body).unwrap().completion_tokens, Some(2));
    let mut parser = StreamResponse::default();
    parser.push(b"data: {\"secret\"").unwrap();
    let error = parser.finish().unwrap_err();
    assert!(error.contains("格式无效") && !error.contains("secret"));
}

#[test]
fn cloud_errors_distinguish_auth_balance_and_rate_limits() {
    for (status, hint) in [
        (401, "API Key"),
        (402, "余额"),
        (429, "频繁"),
        (503, "暂时不可用"),
    ] {
        assert!(
            provider::status_error(reqwest::StatusCode::from_u16(status).unwrap()).contains(hint)
        );
    }
}

#[test]
fn oversized_unterminated_stream_events_are_bounded() {
    let mut parser = StreamResponse::default();
    assert!(parser
        .push(&vec![b'x'; super::MAX_AI_RESPONSE_BYTES as usize + 1])
        .unwrap_err()
        .contains("安全上限"));
}
