use serde_json::{json, Value};

#[derive(Default)]
pub(super) struct StreamResponse {
    pending: Vec<u8>,
    data: Vec<String>,
    event_bytes: usize,
    content: String,
    reason: Option<String>,
    model: Option<String>,
    usage: Value,
    thinking: bool,
    refusal: bool,
    tools: bool,
    pub done: bool,
}

impl StreamResponse {
    pub fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.pending.extend_from_slice(bytes);
        let mut consumed = 0;
        while let Some(offset) = self.pending[consumed..].iter().position(|b| *b == b'\n') {
            let end = consumed + offset;
            if end - consumed > super::MAX_AI_RESPONSE_BYTES as usize {
                return Err("AI 流式事件超过 2 MiB 安全上限".into());
            }
            let line = std::str::from_utf8(&self.pending[consumed..end])
                .map_err(|_| "AI 流式响应编码无效")?
                .trim_end_matches('\r')
                .to_owned();
            consumed = end + 1;
            self.line(&line)?;
        }
        self.pending.drain(..consumed);
        if self.pending.len() > super::MAX_AI_RESPONSE_BYTES as usize {
            return Err("AI 流式事件超过 2 MiB 安全上限".into());
        }
        Ok(())
    }

    fn line(&mut self, line: &str) -> Result<(), String> {
        if self.done {
            return Ok(());
        }
        if line.is_empty() {
            return self.dispatch();
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.event_bytes += data.len();
            if self.event_bytes > super::MAX_AI_RESPONSE_BYTES as usize {
                return Err("AI 流式事件超过 2 MiB 安全上限".into());
            }
            self.data
                .push(data.strip_prefix(' ').unwrap_or(data).to_string());
        }
        Ok(())
    }

    fn dispatch(&mut self) -> Result<(), String> {
        if self.data.is_empty() {
            return Ok(());
        }
        let text = std::mem::take(&mut self.data).join("\n");
        self.event_bytes = 0;
        if text.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let body: Value =
            serde_json::from_str(&text).map_err(|_| "AI 流式响应格式无效，已停止接收")?;
        if body.get("error").is_some() {
            return Err("AI 服务在生成过程中返回错误，请检查连接或稍后重试".into());
        }
        if let Some(model) = body["model"].as_str() {
            self.model = Some(model.to_string());
        }
        if body["usage"].is_object() {
            self.usage = body["usage"].clone();
        }
        if let Some(choices) = body["choices"].as_array() {
            for choice in choices
                .iter()
                .filter(|c| c["index"].as_u64().unwrap_or(0) == 0)
            {
                let delta = &choice["delta"];
                if let Some(content) = delta["content"].as_str() {
                    if self.content.len() + content.len() > super::MAX_AI_RESPONSE_BYTES as usize {
                        return Err("AI 正文超过 2 MiB 安全上限".into());
                    }
                    self.content.push_str(content);
                }
                self.thinking |= delta["reasoning_content"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty());
                self.refusal |= delta["refusal"].as_str().is_some_and(|s| !s.is_empty());
                self.tools |= delta["tool_calls"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty());
                if let Some(reason) = choice["finish_reason"].as_str() {
                    self.reason = Some(reason.to_string());
                }
            }
        }
        Ok(())
    }

    fn body(&self) -> Value {
        json!({"model":self.model,"choices":[{"finish_reason":self.reason,"message":{"content":self.content,"reasoning_content":if self.thinking {"present"} else {""},"refusal":if self.refusal {"present"} else {""},"tool_calls":if self.tools {json!([{}])} else {json!([])}}}],"usage":self.usage})
    }

    pub fn visible_content(&self) -> String {
        let text = self.content.trim();
        // Buffer a split opening tag; never flash reasoning as manuscript text.
        if "<think>".starts_with(text) {
            return String::new();
        }
        super::response_content(&self.body()).unwrap_or_default()
    }

    pub fn finish(mut self) -> Result<(Value, bool), String> {
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            let line = std::str::from_utf8(&pending).map_err(|_| "AI 流式响应编码无效")?;
            self.line(line.trim_end_matches('\r'))?;
        }
        self.dispatch()?;
        Ok((self.body(), self.done && !self.refusal && !self.tools))
    }
}
