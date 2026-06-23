use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::modules::{atomic_write, logger};

const BRIDGE_CONFIG_FILE_NAME: &str = ".codex-chat-bridge.json";
const LOCAL_BRIDGE_HOST: &str = "127.0.0.1";
const LOCAL_BRIDGE_PORT_BASE: u16 = 29100;
const LOCAL_BRIDGE_PORT_SPAN: u16 = 900;

static STARTED_BRIDGES: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatBridgeConfig {
    pub enabled: bool,
    pub upstream_base_url: String,
}

pub fn should_bridge_api_base_url(base_url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };
    match parsed
        .host_str()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "api.openai.com" | "127.0.0.1" | "localhost" => false,
        _ => true,
    }
}

pub fn bridge_port_for_home(codex_home: &Path) -> u16 {
    let mut hasher = DefaultHasher::new();
    codex_home
        .to_string_lossy()
        .to_ascii_lowercase()
        .hash(&mut hasher);
    LOCAL_BRIDGE_PORT_BASE + (hasher.finish() as u16 % LOCAL_BRIDGE_PORT_SPAN)
}

pub fn local_bridge_base_url(codex_home: &Path) -> String {
    format!(
        "http://{}:{}/v1",
        LOCAL_BRIDGE_HOST,
        bridge_port_for_home(codex_home)
    )
}

pub fn write_bridge_config(codex_home: &Path, upstream_base_url: &str) -> Result<String, String> {
    let config = CodexChatBridgeConfig {
        enabled: true,
        upstream_base_url: upstream_base_url.trim().trim_end_matches('/').to_string(),
    };
    let content = serde_json::to_string_pretty(&config)
        .map(|value| format!("{}\n", value))
        .map_err(|error| format!("serialize chat bridge config failed: {}", error))?;
    fs::create_dir_all(codex_home)
        .map_err(|error| format!("create chat bridge config dir failed: {}", error))?;
    atomic_write::write_string_atomic(&codex_home.join(BRIDGE_CONFIG_FILE_NAME), &content)
        .map_err(|error| format!("write chat bridge config failed: {}", error))?;
    Ok(local_bridge_base_url(codex_home))
}

pub fn remove_bridge_config(codex_home: &Path) -> Result<(), String> {
    let path = codex_home.join(BRIDGE_CONFIG_FILE_NAME);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove chat bridge config failed: {}", error)),
    }
}

fn read_bridge_config(codex_home: &Path) -> Result<Option<CodexChatBridgeConfig>, String> {
    let path = codex_home.join(BRIDGE_CONFIG_FILE_NAME);
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("read chat bridge config failed: {}", error))?;
    let config = serde_json::from_str::<CodexChatBridgeConfig>(&content)
        .map_err(|error| format!("parse chat bridge config failed: {}", error))?;
    if config.enabled && !config.upstream_base_url.trim().is_empty() {
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

pub fn ensure_started(codex_home: &Path) -> Result<Option<String>, String> {
    let Some(config) = read_bridge_config(codex_home)? else {
        return Ok(None);
    };
    let canonical_key = codex_home.to_path_buf();
    let mut started = STARTED_BRIDGES
        .lock()
        .map_err(|_| "chat bridge state lock poisoned".to_string())?;
    if started.contains(&canonical_key) {
        return Ok(Some(local_bridge_base_url(codex_home)));
    }

    let port = bridge_port_for_home(codex_home);
    let server = Server::http((LOCAL_BRIDGE_HOST, port))
        .map_err(|error| format!("start chat bridge failed on {}: {}", port, error))?;
    let upstream = config.upstream_base_url.clone();
    thread::Builder::new()
        .name(format!("codex-chat-bridge-{}", port))
        .spawn(move || serve_bridge(server, upstream))
        .map_err(|error| format!("spawn chat bridge failed: {}", error))?;
    started.insert(canonical_key);
    let local = local_bridge_base_url(codex_home);
    logger::log_info(&format!(
        "[Codex Chat Bridge] started local={} upstream={}",
        local, config.upstream_base_url
    ));
    Ok(Some(local))
}

fn serve_bridge(server: Server, upstream_base_url: String) {
    for request in server.incoming_requests() {
        if let Err(error) = handle_request(request, &upstream_base_url) {
            logger::log_warn(&format!("[Codex Chat Bridge] request failed: {}", error));
        }
    }
}

fn handle_request(mut request: tiny_http::Request, upstream_base_url: &str) -> Result<(), String> {
    let method = request.method().clone();
    let url = request.url().to_string();
    let authorization = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("authorization"))
        .map(|header| header.value.as_str().to_string());

    if method == Method::Post && request_path(&url).ends_with("/responses") {
        let mut body = String::new();
        request
            .as_reader()
            .read_to_string(&mut body)
            .map_err(|error| format!("read bridge request body failed: {}", error))?;
        let request_body = serde_json::from_str::<Value>(&body)
            .map_err(|error| format!("parse responses body failed: {}", error))?;
        if request_body
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let response_body =
                call_chat_completions_stream(upstream_base_url, authorization, request_body)?;
            return request
                .respond(response_with_content_type(
                    200,
                    response_body.into_bytes(),
                    "text/event-stream; charset=utf-8",
                ))
                .map_err(|error| format!("respond bridge stream request failed: {}", error));
        }
        let response_body =
            call_chat_completions(upstream_base_url, authorization, request_body, false)?;
        return request
            .respond(json_response(200, response_body))
            .map_err(|error| format!("respond bridge request failed: {}", error));
    }

    let response = forward_plain_request(method, &url, authorization, upstream_base_url)?;
    request
        .respond(response)
        .map_err(|error| format!("respond forwarded request failed: {}", error))
}

fn request_path(url: &str) -> &str {
    url.split('?').next().unwrap_or(url)
}

fn endpoint_url(upstream_base_url: &str, suffix: &str) -> String {
    format!(
        "{}/{}",
        upstream_base_url.trim().trim_end_matches('/'),
        suffix.trim_start_matches('/')
    )
}

fn call_chat_completions(
    upstream_base_url: &str,
    authorization: Option<String>,
    responses_body: Value,
    stream: bool,
) -> Result<Value, String> {
    let mut chat_body = responses_body_to_chat_completions(responses_body)?;
    chat_body["stream"] = Value::Bool(stream);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("create chat bridge client failed: {}", error))?;
    let mut request = client
        .post(endpoint_url(upstream_base_url, "/chat/completions"))
        .json(&chat_body);
    if let Some(auth) = authorization {
        request = request.header(reqwest::header::AUTHORIZATION, auth);
    }
    let response = request
        .send()
        .map_err(|error| format!("chat completions request failed: {}", error))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .map_err(|error| format!("read chat completions response failed: {}", error))?;
    if !status.is_success() {
        return Ok(json!({
            "error": value.get("error").cloned().unwrap_or(value),
        }));
    }
    Ok(chat_completion_to_responses(value))
}

fn call_chat_completions_stream(
    upstream_base_url: &str,
    authorization: Option<String>,
    responses_body: Value,
) -> Result<String, String> {
    let mut chat_body = responses_body_to_chat_completions(responses_body)?;
    chat_body["stream"] = Value::Bool(true);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("create chat bridge stream client failed: {}", error))?;
    let mut request = client
        .post(endpoint_url(upstream_base_url, "/chat/completions"))
        .json(&chat_body);
    if let Some(auth) = authorization {
        request = request.header(reqwest::header::AUTHORIZATION, auth);
    }
    let response = request
        .send()
        .map_err(|error| format!("chat completions stream request failed: {}", error))?;
    let status = response.status();
    if !status.is_success() {
        let value = response
            .json::<Value>()
            .unwrap_or_else(|_| json!({ "error": format!("upstream HTTP {}", status.as_u16()) }));
        return Ok(build_error_sse(value));
    }

    let mut reader = BufReader::new(response);
    let mut line = String::new();
    let mut output = String::new();
    let id = format!("chatcmpl_bridge_{}", now_unix_seconds());
    let model = chat_body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let item_id = format!("msg_{}", id);
    let response_id = format!("resp_{}", id);
    let mut text = String::new();

    push_response_sse(
        &mut output,
        "response.created",
        response_base(&response_id, &item_id, &model, "in_progress", ""),
    );
    push_response_sse(
        &mut output,
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        }),
    );
    push_response_sse(
        &mut output,
        "response.content_part.added",
        json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": "",
                "annotations": []
            }
        }),
    );

    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| format!("read chat stream failed: {}", error))?;
        if bytes_read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }
        let value = match serde_json::from_str::<Value>(data) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(delta) = value
            .pointer("/choices/0/delta/content")
            .or_else(|| value.pointer("/choices/0/message/content"))
            .and_then(Value::as_str)
        {
            if !delta.is_empty() {
                text.push_str(delta);
                push_response_sse(
                    &mut output,
                    "response.output_text.delta",
                    json!({
                        "type": "response.output_text.delta",
                        "item_id": item_id,
                        "output_index": 0,
                        "content_index": 0,
                        "delta": delta
                    }),
                );
            }
        }
    }

    push_response_sse(
        &mut output,
        "response.output_text.done",
        json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "text": text
        }),
    );
    push_response_sse(
        &mut output,
        "response.content_part.done",
        json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": text,
                "annotations": []
            }
        }),
    );
    push_response_sse(
        &mut output,
        "response.output_item.done",
        json!({
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": text,
                    "annotations": []
                }]
            }
        }),
    );
    push_response_sse(
        &mut output,
        "response.completed",
        response_base(&response_id, &item_id, &model, "completed", &text),
    );
    output.push_str("data: [DONE]\n\n");
    Ok(output)
}

fn forward_plain_request(
    method: Method,
    url: &str,
    authorization: Option<String>,
    upstream_base_url: &str,
) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    let path = request_path(url);
    let suffix = path.strip_prefix("/v1").unwrap_or(path);
    let endpoint = endpoint_url(upstream_base_url, suffix);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| format!("create forward client failed: {}", error))?;
    let mut request = match method {
        Method::Get => client.get(endpoint),
        _ => client.get(endpoint_url(upstream_base_url, "/models")),
    };
    if let Some(auth) = authorization {
        request = request.header(reqwest::header::AUTHORIZATION, auth);
    }
    let response = request
        .send()
        .map_err(|error| format!("forward request failed: {}", error))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .map_err(|error| format!("read forward response failed: {}", error))?
        .to_vec();
    Ok(response_with_content_type(
        status,
        bytes,
        "application/json; charset=utf-8",
    ))
}

fn responses_body_to_chat_completions(body: Value) -> Result<Value, String> {
    let obj = body
        .as_object()
        .ok_or_else(|| "responses body must be a JSON object".to_string())?;
    let model = obj
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| "responses body missing model".to_string())?;
    let mut messages = Vec::new();
    if let Some(instructions) = obj.get("instructions").and_then(Value::as_str) {
        if !instructions.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }
    if let Some(input) = obj.get("input") {
        append_input_messages(input, &mut messages);
    }
    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": "" }));
    }

    let mut chat = Map::new();
    chat.insert("model".to_string(), Value::String(model.to_string()));
    chat.insert("messages".to_string(), Value::Array(messages));
    chat.insert("stream".to_string(), Value::Bool(false));
    if let Some(tokens) = obj
        .get("max_output_tokens")
        .or_else(|| obj.get("max_tokens"))
    {
        chat.insert("max_tokens".to_string(), tokens.clone());
    }
    for key in [
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
    ] {
        if let Some(value) = obj.get(key) {
            chat.insert(key.to_string(), value.clone());
        }
    }
    Ok(Value::Object(chat))
}

fn append_input_messages(input: &Value, messages: &mut Vec<Value>) {
    match input {
        Value::String(text) => messages.push(json!({ "role": "user", "content": text })),
        Value::Array(items) => {
            for item in items {
                append_input_messages(item, messages);
            }
        }
        Value::Object(obj) => {
            let role = obj
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user")
                .to_ascii_lowercase();
            let chat_role = match role.as_str() {
                "assistant" => "assistant",
                "system" | "developer" => "system",
                _ => "user",
            };
            let content = obj
                .get("content")
                .map(extract_text_content)
                .filter(|text| !text.trim().is_empty())
                .unwrap_or_default();
            if !content.is_empty() {
                messages.push(json!({ "role": chat_role, "content": content }));
            }
        }
        _ => {}
    }
}

fn extract_text_content(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(extract_text_content)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(obj) => obj
            .get("text")
            .or_else(|| obj.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

fn chat_completion_to_responses(chat: Value) -> Value {
    let id = chat
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("chatcmpl_bridge");
    let model = chat
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let text = chat
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let usage = chat.get("usage").cloned().unwrap_or_else(|| json!({}));
    let mut response = response_base(
        &format!("resp_{}", id),
        &format!("msg_{}", id),
        model,
        "completed",
        text,
    );
    response["usage"] = usage;
    response
}

fn response_base(response_id: &str, item_id: &str, model: &str, status: &str, text: &str) -> Value {
    json!({
        "id": response_id,
        "object": "response",
        "created_at": now_unix_seconds(),
        "status": status,
        "model": model,
        "output": [{
            "id": item_id,
            "type": "message",
            "status": status,
            "role": "assistant",
            "content": [{
                "type": "output_text",
                "text": text,
                "annotations": []
            }]
        }],
        "output_text": text,
    })
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn push_response_sse(output: &mut String, event: &str, mut value: Value) {
    if let Some(obj) = value.as_object_mut() {
        obj.entry("type".to_string())
            .or_insert_with(|| Value::String(event.to_string()));
    }
    output.push_str("event: ");
    output.push_str(event);
    output.push('\n');
    output.push_str("data: ");
    output.push_str(&serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string()));
    output.push_str("\n\n");
}

fn build_error_sse(error: Value) -> String {
    let mut output = String::new();
    push_response_sse(
        &mut output,
        "response.failed",
        json!({
            "type": "response.failed",
            "response": {
                "id": format!("resp_chatcmpl_bridge_error_{}", now_unix_seconds()),
                "object": "response",
                "created_at": now_unix_seconds(),
                "status": "failed",
                "error": error.get("error").cloned().unwrap_or(error)
            }
        }),
    );
    output.push_str("data: [DONE]\n\n");
    output
}

fn json_response(status: u16, value: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"error\":\"encode\"}".to_vec());
    response_with_content_type(status, bytes, "application/json; charset=utf-8")
}

fn response_with_content_type(
    status: u16,
    bytes: Vec<u8>,
    content_type: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(bytes).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes(b"Content-Type".as_slice(), content_type.as_bytes()) {
        response.add_header(header);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_responses_input_to_chat_messages() {
        let body = json!({
            "model": "gemini-3.1-pro-preview",
            "instructions": "be concise",
            "input": [{
                "role": "user",
                "content": [{ "type": "input_text", "text": "hello" }]
            }],
            "stream": true,
            "max_output_tokens": 64
        });

        let chat = responses_body_to_chat_completions(body).expect("convert");
        assert_eq!(
            chat.get("model").and_then(Value::as_str),
            Some("gemini-3.1-pro-preview")
        );
        assert_eq!(chat.get("stream").and_then(Value::as_bool), Some(false));
        assert_eq!(chat.get("max_tokens").and_then(Value::as_i64), Some(64));
        assert_eq!(
            chat.pointer("/messages/0/role").and_then(Value::as_str),
            Some("system")
        );
        assert_eq!(
            chat.pointer("/messages/1/content").and_then(Value::as_str),
            Some("hello")
        );
    }

    #[test]
    fn maps_chat_completion_to_response_shape() {
        let response = chat_completion_to_responses(json!({
            "id": "chatcmpl_1",
            "model": "claude-sonnet",
            "choices": [{ "message": { "content": "done" } }],
            "usage": { "total_tokens": 12 }
        }));

        assert_eq!(
            response.get("object").and_then(Value::as_str),
            Some("response")
        );
        assert_eq!(
            response
                .pointer("/output/0/content/0/text")
                .and_then(Value::as_str),
            Some("done")
        );
        assert_eq!(
            response.get("output_text").and_then(Value::as_str),
            Some("done")
        );
    }

    #[test]
    fn emits_responses_sse_events() {
        let mut output = String::new();
        push_response_sse(
            &mut output,
            "response.output_text.delta",
            json!({
                "item_id": "msg_1",
                "delta": "hi"
            }),
        );

        assert!(output.contains("event: response.output_text.delta"));
        assert!(output.contains("\"type\":\"response.output_text.delta\""));
        assert!(output.contains("\"delta\":\"hi\""));
    }
}
