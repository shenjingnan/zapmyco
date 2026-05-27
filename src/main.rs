mod cli;
mod models;
mod settings;

use clap::Parser;
use cli::Cli;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let cli = Cli::parse();
    let result = cli::run(cli).await;

    if let Err(err) = result {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}
