use clap::Parser;
use zapmyco::cli::{self, Cli};
use zapmyco::output::{self, TerminalTarget};

#[tokio::main]
async fn main() {
    zapmyco::logging::init_logging();

    output::ROUTER.add_target(Box::new(TerminalTarget));

    // 将 -v 映射到 --version，因为 clap 默认使用 -V（大写）作为 version 的短标志
    let args: Vec<String> = std::env::args().collect();
    let adjusted_args = cli::map_short_v_flag(&args);

    let cli = Cli::parse_from(adjusted_args);
    let result = cli::run(cli).await;

    if let Err(err) = result {
        output::send(&output::Message::error(err.to_string()));
        std::process::exit(1);
    }
}
