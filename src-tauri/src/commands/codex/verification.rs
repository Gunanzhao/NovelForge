//! Exercises the installed CLI against a credential-free loopback Responses fixture.
use super::*;
use std::net::{TcpListener, TcpStream};

struct LocalServer {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
    result: mpsc::Receiver<Result<(), String>>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Drop for LocalServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn read_request(stream: &mut TcpStream, token: &str, stop: &AtomicBool) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| "模拟服务读取设置失败")?;
    let deadline = Instant::now() + CONTROL_TIMEOUT;
    let mut bytes = Vec::new();
    let read_byte = |stream: &mut TcpStream| -> Result<u8, String> {
        loop {
            if stop.load(Ordering::SeqCst) || Instant::now() >= deadline {
                return Err("模拟服务已停止或超时".into());
            }
            let mut byte = [0];
            match stream.read(&mut byte) {
                Ok(1) => return Ok(byte[0]),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue
                }
                _ => return Err("模拟请求中断".into()),
            }
        }
    };
    while !bytes.ends_with(b"\r\n\r\n") {
        bytes.push(read_byte(stream)?);
        if bytes.len() > 32768 {
            return Err("模拟请求头超限".into());
        }
    }
    let headers = String::from_utf8(bytes).map_err(|_| "模拟请求头无效")?;
    let target = format!("POST /{token}/v1/responses HTTP/1.1");
    if headers.lines().next() != Some(target.as_str()) {
        return Err("模拟请求访问标识无效".into());
    }
    let mut length = None;
    for line in headers.lines().skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("authorization")
                || name.eq_ignore_ascii_case("chatgpt-account-id")
            {
                return Err("模拟请求不允许携带账号凭据".into());
            }
            if name.eq_ignore_ascii_case("content-encoding") {
                return Err("模拟请求编码不受支持".into());
            }
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let length = length
        .filter(|n| *n <= MAX_FRAME)
        .ok_or("模拟请求长度无效")?;
    let mut body = Vec::with_capacity(length);
    for _ in 0..length {
        body.push(read_byte(stream)?);
    }
    let request: Value = serde_json::from_slice(&body).map_err(|_| "模拟请求不是有效 JSON")?;
    validate_request(&request)?;
    Ok(request)
}

fn validate_request(request: &Value) -> Result<(), String> {
    if !request["input"].is_array() {
        return Err("模拟服务未收到生成请求".into());
    }
    if request
        .get("tools")
        .is_some_and(|v| !v.as_array().is_some_and(Vec::is_empty))
    {
        return Err("CLI 仍向模型声明工具，生成已禁用".into());
    }
    Ok(())
}

fn event(stream: &mut TcpStream, kind: &str, data: Value) -> Result<(), String> {
    write!(stream, "event: {kind}\ndata: {data}\n\n")
        .and_then(|_| stream.flush())
        .map_err(|_| "模拟响应发送失败".into())
}
fn serve(mut stream: TcpStream, token: &str, mode: &str, stop: &AtomicBool) -> Result<(), String> {
    read_request(&mut stream, token, stop)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "模拟响应设置失败")?;
    if mode == "failure" {
        stream
            .write_all(
                b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .map_err(|_| "模拟错误发送失败")?;
        return Ok(());
    }
    stream
        .write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
        )
        .map_err(|_| "模拟响应发送失败")?;
    let item = json!({"id":"msg_fixture","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"兼容检查通过。","annotations":[]}]});
    event(
        &mut stream,
        "response.created",
        json!({"type":"response.created","response":{"id":"resp_fixture","object":"response","status":"in_progress","output":[]}}),
    )?;
    event(
        &mut stream,
        "response.output_item.added",
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"msg_fixture","type":"message","status":"in_progress","role":"assistant","content":[]}}),
    )?;
    event(
        &mut stream,
        "response.output_text.delta",
        json!({"type":"response.output_text.delta","item_id":"msg_fixture","output_index":0,"content_index":0,"delta":"兼容检查通过。"}),
    )?;
    if mode == "cancel" {
        let deadline = Instant::now() + CONTROL_TIMEOUT;
        while !stop.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        return Ok(());
    }
    event(
        &mut stream,
        "response.output_item.done",
        json!({"type":"response.output_item.done","output_index":0,"item":item}),
    )?;
    event(
        &mut stream,
        "response.completed",
        json!({"type":"response.completed","response":{"id":"resp_fixture","object":"response","status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}),
    )
}
impl LocalServer {
    fn start(mode: &'static str) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "无法启动本地兼容检查服务")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "无法设置模拟服务")?;
        let port = listener
            .local_addr()
            .map_err(|_| "无法读取模拟端口")?
            .port();
        let token = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker_token = token.clone();
        let (tx, result) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let deadline = Instant::now() + CONTROL_TIMEOUT;
            let outcome = loop {
                if worker_stop.load(Ordering::SeqCst) || Instant::now() >= deadline {
                    break Err("CLI 未连接本地检查服务".into());
                }
                match listener.accept() {
                    Ok((stream, _)) => break serve(stream, &worker_token, mode, &worker_stop),
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break Err("模拟服务连接失败".into()),
                }
            };
            let _ = tx.send(outcome);
        });
        Ok(Self {
            port,
            token,
            stop,
            result,
            worker: Some(worker),
        })
    }
}

pub(super) fn verify(
    path: &std::path::Path,
    parent: &std::path::Path,
    model: &Value,
    effort: &str,
    owner: &Client,
) -> Result<(), String> {
    let temp = compatibility::Scratch::new(parent)?;
    let home = temp.0.join("home");
    let cwd = temp.0.join("work");
    std::fs::create_dir(&home).map_err(|_| "无法创建独立检查配置目录")?;
    std::fs::create_dir(&cwd).map_err(|_| "无法创建独立检查工作目录")?;
    let catalog = save_catalog(&temp.0, std::slice::from_ref(model))?;
    for mode in ["success", "failure", "cancel"] {
        compatibility::check_stop(owner)?;
        let server = LocalServer::start(mode)?;
        let url = format!("http://127.0.0.1:{}/{}/v1", server.port, server.token);
        let extra = [
            "model_provider=\"novelforge_fixture\"".to_owned(),
            format!("model_providers.novelforge_fixture={{name=\"fixture\",base_url=\"{url}\",wire_api=\"responses\",requires_openai_auth=false,request_max_retries=0,stream_max_retries=0}}"),
            format!("model_catalog_json={}",serde_json::to_string(&catalog.0.to_string_lossy()).map_err(|_| "检查目录无效")?),
        ];
        let mut command = Rpc::command(path, &extra);
        command.env("CODEX_HOME", &home);
        let mut rpc = Rpc::spawn_command(command, path.to_owned(), cwd.clone())?;
        let config = rpc.initialize(owner)?;
        if config["model_provider"] != "novelforge_fixture"
            || config.pointer("/model_providers/novelforge_fixture/base_url") != Some(&json!(url))
        {
            return Err("CLI 未使用本地模拟服务，检查已中止".into());
        }
        // Validate the same isolation controls, with only the known local provider substituted.
        let mut isolation = config.clone();
        isolation["model_provider"] = json!("openai");
        check_config(&isolation, Some(&catalog.0))?;
        let account = rpc.call("account/read", json!({"refreshToken":false}), owner)?;
        if !account["account"].is_null() {
            return Err("检查进程意外继承登录，检查已中止".into());
        }
        let response = rpc.call(
            "thread/start",
            thread_params(
                model["model"].as_str().ok_or("模型标识无效")?,
                &cwd,
                "Only return text.",
                "novelforge_fixture",
            ),
            owner,
        )?;
        validate_permissions(&response, "novelforge_fixture")?;
        let thread = response["thread"]["id"].as_str().ok_or("模拟会话缺少 ID")?;
        let turn = rpc.call("turn/start", json!({"threadId":thread,"effort":effort,"input":[{"type":"text","text":"Synthetic compatibility check. Return one sentence without tools."}]}), owner)?;
        let turn_id = turn["turn"]["id"].as_str().ok_or("模拟任务缺少 ID")?;
        let deadline = Instant::now() + CONTROL_TIMEOUT;
        let mut text = String::new();
        let mut interrupted = false;
        loop {
            compatibility::check_stop(owner)?;
            if Instant::now() >= deadline {
                return Err("模拟任务验证超时".into());
            }
            let event = rpc.next(deadline, owner)?;
            let params = &event["params"];
            if params["threadId"] != thread {
                continue;
            }
            if params["turnId"].as_str().is_some_and(|id| id != turn_id) {
                continue;
            }
            match event["method"].as_str() {
                Some("item/started")
                    if !matches!(
                        params["item"]["type"].as_str(),
                        Some("userMessage" | "agentMessage" | "reasoning")
                    ) =>
                {
                    return Err("模拟任务出现非文本能力".into())
                }
                Some("item/agentMessage/delta") => {
                    text.push_str(params["delta"].as_str().ok_or("模拟文本增量无效")?);
                    if text.len() > 4096 {
                        return Err("模拟响应文本超限".into());
                    }
                    if mode == "cancel" && !interrupted {
                        rpc.send(
                            "turn/interrupt",
                            json!({"threadId":thread,"turnId":turn_id}),
                        )?;
                        interrupted = true;
                    }
                }
                Some("turn/completed") if params["turn"]["id"] == turn_id => {
                    let expected = match mode {
                        "failure" => "failed",
                        "cancel" => "interrupted",
                        _ => "completed",
                    };
                    if params["turn"]["status"] != expected
                        || (mode != "failure" && text != "兼容检查通过。")
                    {
                        return Err(format!("CLI {mode} 行为不兼容"));
                    }
                    break;
                }
                _ => (),
            }
        }
        server.stop.store(true, Ordering::SeqCst);
        server
            .result
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "模拟请求检查未完成")??;
        drop(rpc);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_declared_or_malformed_tools() {
        for request in [
            json!({"input":[],"tools":[{"type":"shell"}]}),
            json!({"input":[],"tools":null}),
            json!({"tools":[]}),
        ] {
            assert!(validate_request(&request).is_err());
        }
        assert!(validate_request(&json!({"input":[],"tools":[]})).is_ok());
        assert!(validate_request(&json!({"input":[]})).is_ok());
    }
    #[test]
    #[ignore = "Installed CLI, isolated local fixture only; no login or subscription usage"]
    fn installed_cli_compatibility_probe() {
        let owner = Client::default();
        *owner.check_deadline.lock().unwrap() = Some(Instant::now() + Duration::from_secs(90));
        let path = std::env::var("NOVELFORGE_TEST_CODEX")
            .map(PathBuf::from)
            .unwrap_or_else(|_| resolve_cli("").unwrap());
        let version = compatibility::version(&path, &owner).unwrap();
        let temp = compatibility::Scratch::new(&std::env::temp_dir()).unwrap();
        compatibility::verify_schema(&path, &version, &temp.0, &owner).unwrap();
        let model = json!({"model":"gpt-5.6-luna","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":"low"}]});
        verify(&path, &temp.0, &model, "low", &owner).unwrap();
        eprintln!(
            "CODEX_COMPATIBILITY_OK version={version} adapter={}",
            compatibility::ADAPTER
        );
    }
}
