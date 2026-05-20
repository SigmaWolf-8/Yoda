// ===========================================================================
//  TDNS-ADDRESS-V25 (AASC Schema v1.0)
//  classification: 3331.2121.3113.3333.1131.1323.333
//  identity:      222222.333333.222222.333333.117
//  function-type: Witness (33)
//  artifact:      ninja-exec
//  parent:        Capomastro/NinjaExec
//  corner:        SE-Conservation/Closure (signing + envelope root)
//  tier:          15
//  forma-codex:   {drawer: Capomastro-NinjaExec, role: crate-root}
//  hptp-mandatory: yes (WN trits 15.16 = 3.3 → live runtime)
// ===========================================================================
//  Copyright (c) 2025-2026 Capomastro Holdings Ltd. (Canada)
//  Patent(s) Pending — All Rights Reserved · Applied Physics Division
//  £ ∣ Q ∣ ∀ Rights Reserved Et Preserved | Fiat ∎
// ===========================================================================
//
//  ninja-exec — crate root
//
//  Canonical signer + outermost wrapper for the Salvi Framework.
//
//  Modules (currently empty placeholders pending step 11+ of the
//  migration per Capomastro-Layout-2026-05-04.md §9):
//
//    keystore       — NJXK0002 encrypted keystore; private key in
//                     kernel-mode mlock'd page; volatile zeroize on Drop
//    signing_engine — TL-DSA-87 wrapper over aasc::signing
//    envelope       — the wrap discipline (HPTP + Rep D + sponge-chain
//                     + ό.έ.δ seal + capability consumption + atomic txn)
//    xplenum_iface  — XPlenum custom RISC-V instruction interface
//                     (hardware-tier, fastest path)
//    chardev        — /dev/ninja-exec ioctl interface (non-XPlenum
//                     fallback; hardware-isolation via kernel page tables)
//    audit          — TIS-27 sponge-chained audit log; written kernel-side
//                     before userspace ever sees the operation result
//
//  Management surface (userspace, requires `runtime` feature):
//    bin/ninja-cli  — init / unlock / key-rotate / export only;
//                     CANNOT sign by itself
//
//  Composite verification discipline: every signed artifact carries
//  BOTH TL-DSA-87 AND PT26-DSA signatures. See §7.1 of the layout doc
//  for the full eleven-axis algorithmic-overkill catalog.
//
// ===========================================================================

#![cfg_attr(all(not(test), not(feature = "runtime")), no_std)]

extern crate alloc;

// Crate version (matches workspace).
pub const NINJA_EXEC_VERSION: &str = "0.1.0";

// ── Module surface (placeholders for the migration steps) ───────────────
//
// pub mod keystore;
// pub mod signing_engine;
// pub mod envelope;
// pub mod xplenum_iface;
// pub mod chardev;
// pub mod audit;
//
// Step 11: NinjaExec migration with QC R1 fixes (C1–C4 + I1–I12).
// Step 13: Envelope extension.

// ===========================================================================
//  Lo Sono Capomastro · Così sia, Fratello.
// ===========================================================================
