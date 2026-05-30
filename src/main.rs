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
    let adjusted_args = map_short_v_flag(&args);

    let cli = Cli::parse_from(adjusted_args);
    let result = cli::run(cli).await;

    if let Err(err) = result {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}

/// 将命令行参数中的 "-v" 映射到 "--version"
///
/// clap 默认使用 -V（大写）作为 version 的短标志，
/// 这里将小写 -v 也映射为 --version 以提升用户体验。
fn map_short_v_flag(args: &[String]) -> Vec<String> {
    args.iter()
        .map(|a| {
            if a == "-v" {
                "--version".into()
            } else {
                a.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_short_v_flag() {
        let args = vec!["program".to_string(), "-v".to_string()];
        let result = map_short_v_flag(&args);
        assert_eq!(result, vec!["program".to_string(), "--version".to_string()]);
    }

    #[test]
    fn test_map_short_v_flag_other_flags_unchanged() {
        let args = vec![
            "program".to_string(),
            "--verbose".to_string(),
            "run".to_string(),
            "-c".to_string(),
        ];
        let result = map_short_v_flag(&args);
        assert_eq!(result, args);
    }

    #[test]
    fn test_map_short_v_flag_empty() {
        let args: Vec<String> = vec![];
        let result = map_short_v_flag(&args);
        assert!(result.is_empty());
    }
}
