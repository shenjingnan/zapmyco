use clap::Parser;
use zapmyco::cli::{self, Cli};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    // 将 -v 映射到 --version，因为 clap 默认使用 -V（大写）作为 version 的短标志
    let args: Vec<String> = std::env::args().collect();
    let adjusted_args: Vec<String> = args
        .iter()
        .map(|a| {
            if a == "-v" {
                "--version".into()
            } else {
                a.clone()
            }
        })
        .collect();

    let cli = Cli::parse_from(adjusted_args);
    let result = cli::run(cli).await;

    if let Err(err) = result {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}
