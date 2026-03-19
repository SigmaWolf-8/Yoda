{ pkgs }: {
  deps = [
    # Rust toolchain
    pkgs.rustc
    pkgs.cargo
    pkgs.rust-analyzer
    pkgs.clippy

    # Build essentials (needed for native crate compilation)
    pkgs.pkg-config
    pkgs.openssl
    pkgs.openssl.dev

    # Node.js (React frontend build)
    pkgs.nodejs_20
    pkgs.nodePackages.npm

    # PostgreSQL client tools (migrations, psql)
    pkgs.postgresql_16

    # sqlx-cli (compile-time SQL checking)
    pkgs.sqlx-cli

    # Utilities
    pkgs.git
    pkgs.curl
    pkgs.jq
  ];
}
