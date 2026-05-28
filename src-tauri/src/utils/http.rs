use reqwest::Client;

/// 创建统一配置的 HTTP 客户端
pub fn create_client(timeout_secs: u64) -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_else(|_| Client::new())
}
