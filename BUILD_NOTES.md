# YODA — First Build Notes

## Before `cargo build --workspace`

### 1. Verify ternary-math crate location

The workspace Cargo.toml references:
```toml
ternary-math = { git = "https://github.com/SigmaWolf-8/Ternary" }
```

This assumes a crate named `ternary-math` at the repo root. If it's nested,
adjust to include the subdirectory path, for example:
```toml
ternary-math = { git = "https://github.com/SigmaWolf-8/Ternary", path = "ternary-math" }
```

Or if the crate has a different name in Cargo.toml, use:
```toml
ternary-math = { git = "https://github.com/SigmaWolf-8/Ternary", package = "actual-crate-name" }
```

Check your Ternary repo: look at the `[package] name` field in
`Ternary/ternary-math/Cargo.toml` (or wherever it lives).

### 2. Set up local path override (since you're actively editing Ternary)

```bash
cp .cargo/config.toml.example .cargo/config.toml
# Edit .cargo/config.toml — adjust the path to your local Ternary checkout
```

### 3. Build

```bash
cargo build --workspace
```

### 4. Expected behavior

All crates compile with `todo!()` stubs in the PlenumNET bridge functions.
No runtime functionality yet — that starts in Task B-5.

The `todo!()` calls will panic if executed, but they compile clean and
clearly mark every function that needs implementation with its task ID
(e.g., "B1.1.2: implement TIS-27 hash via ternary-math").
