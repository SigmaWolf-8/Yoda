---
name: Publishing and workspace size
description: Why a publish dies during "Pushing repl layer", and the rule about where build artefacts must live for a Rust app on Replit.
---

# Publishing and workspace size

## The failure signature

A publish that fails with

```
failed to push layers: failed to push repl layer:
io.Copy(".../target/debug/deps/<crate>-<hash>.rcgu.o"): io: read/write on closed pipe
```

is not a code or configuration error. Publishing uploads the **whole workspace** as
the repl layer, and this one is ~20 GB with a 15 GB Rust `target/`. The upload dies
partway through and names whatever file it was copying when the pipe closed — the file
is incidental, the size is the cause.

**How to apply:** check `du -sh` of the workspace before blaming the build. Anything
large and regenerable (`target`, `node_modules`, archives, `attached_assets`) belongs in
`.replitignore`.

## Artefacts must live outside every ignored directory

`.replitignore` filters the push, and the push happens *after* the build step. So a
binary left in `target/release/` is built and then thrown away — the image ships without
it and the run command fails on a missing file. Copy the artefact to an unignored
directory (here `deploy-bin/`) as the last step of the build.

**Why:** the two facts are only contradictory if you assume the ignore list applies to
the build context alone. It applies to what gets shipped.

## The development run script is not the production run command

This project's dev startup script compiles on boot on purpose, so a restart always picks
up the latest source. That behaviour is wrong in production twice over: `cargo` and
`target/` are excluded from the image, and on autoscale a container starts to answer a
request, so compiling blows the startup probe on every cold start. Production compiles
in the build step and the run command only `exec`s the finished binary.

**Also:** autoscale hands the port in `$PORT`. Honour it and fall back to the dev
default, rather than hardcoding either.

## Verifying a Rust build before publishing

`cargo build` cannot be timed from the shell tool — it is SIGTERM'd, sometimes before it
writes a single line, and `pgrep -f "<the same command string>"` then matches the tool's
own shell and reports it as still running. Do not trust that as evidence of progress;
check for the output binary or a non-empty log instead.
