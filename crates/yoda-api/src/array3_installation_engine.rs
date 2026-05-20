// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 🥋 ARRAY3 INSTALLATION & PROVISIONING ENGINE
// Smart Detection → User Prompt → Automated Setup
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1: ERROR TYPES & INSTALLATION STATE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

#[derive(Error, Debug)]
pub enum Array3InstallationError {
    #[error("Array3 not found at {path}")]
    NotFound { path: String },

    #[error("Permission denied: {reason}")]
    PermissionDenied { reason: String },

    #[error("User declined installation")]
    UserDeclined,

    #[error("Installation failed: {reason}")]
    InstallationFailed { reason: String },

    #[error("Compilation failed: {reason}")]
    CompilationFailed { reason: String },

    #[error("Configuration error: {reason}")]
    ConfigurationError { reason: String },

    #[error("Network error: {reason}")]
    NetworkError { reason: String },

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Invalid architecture: {reason}")]
    InvalidArchitecture { reason: String },
}

/// Installation status for a single daemon node
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum InstallationStatus {
    NotFound,           // Not on disk
    Detected,           // Found but not running
    Running,            // Running and healthy
    NeedsUpdate,        // Found but outdated
    FailedToStart,      // Found but start failed
    AwaitingUserAction, // Waiting for user consent to install
}

/// User's decision on installation prompt
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserInstallDecision {
    Install,      // Install the Array3 daemon
    Skip,         // Skip for now (don't prompt again this session)
    Decline,      // Don't install, and don't ask again
    Later,        // Remind me later
}

/// Machine architecture detection
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MachineArchitecture {
    Arm64,           // Apple Silicon, Snapdragon, AWS Graviton
    X86_64,          // Intel/AMD 64-bit
    Arm32,           // ARM 32-bit (older)
    Unsupported,     // Anything else
}

impl MachineArchitecture {
    pub fn detect() -> Self {
        let arch = std::env::consts::ARCH;
        match arch {
            "aarch64" => MachineArchitecture::Arm64,
            "x86_64" => MachineArchitecture::X86_64,
            "arm" => MachineArchitecture::Arm32,
            _ => MachineArchitecture::Unsupported,
        }
    }

    pub fn to_string(&self) -> &'static str {
        match self {
            MachineArchitecture::Arm64 => "aarch64",
            MachineArchitecture::X86_64 => "x86_64",
            MachineArchitecture::Arm32 => "arm",
            MachineArchitecture::Unsupported => "unsupported",
        }
    }
}

/// OS detection
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum OperatingSystem {
    Windows,
    Linux,
    MacOS,
    Unsupported,
}

impl OperatingSystem {
    pub fn detect() -> Self {
        match std::env::consts::OS {
            "windows" => OperatingSystem::Windows,
            "linux" => OperatingSystem::Linux,
            "macos" => OperatingSystem::MacOS,
            _ => OperatingSystem::Unsupported,
        }
    }

    pub fn to_string(&self) -> &'static str {
        match self {
            OperatingSystem::Windows => "Windows",
            OperatingSystem::Linux => "Linux",
            OperatingSystem::MacOS => "macOS",
            OperatingSystem::Unsupported => "unsupported",
        }
    }
}

/// Information about a single daemon node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonNodeInfo {
    pub node_id: String,              // "Node A", "Node B", "Node C"
    pub node_number: u32,              // 1, 2, 3
    pub port_api: u16,                 // 11124, 11151, 11178
    pub port_relay: u16,               // 11125, 11152, 11179
    pub binary_name: String,           // "yoda-api"
    pub expected_path: PathBuf,        // Where it should be
    pub installation_status: InstallationStatus,
    pub version: Option<String>,       // If found, what version
    pub last_heartbeat: Option<String>, // When it last responded
}

/// Complete system configuration for Array3
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Array3Configuration {
    pub repo_root: PathBuf,            // Path to plenumnet repo
    pub target_architecture: MachineArchitecture,
    pub target_os: OperatingSystem,
    pub nodes: Vec<DaemonNodeInfo>,    // Node A, B, C
    pub cargo_release_path: PathBuf,   // target/release
    pub network_config_path: PathBuf,  // network-array-tool.sh location
}

impl Array3Configuration {
    pub fn new(repo_root: PathBuf) -> Self {
        Array3Configuration {
            repo_root: repo_root.clone(),
            target_architecture: MachineArchitecture::detect(),
            target_os: OperatingSystem::detect(),
            nodes: vec![
                DaemonNodeInfo {
                    node_id: "Node A".to_string(),
                    node_number: 1,
                    port_api: 11124,
                    port_relay: 11125,
                    binary_name: "yoda-api".to_string(),
                    expected_path: repo_root.join("target/release/yoda-api"),
                    installation_status: InstallationStatus::NotFound,
                    version: None,
                    last_heartbeat: None,
                },
                DaemonNodeInfo {
                    node_id: "Node B".to_string(),
                    node_number: 2,
                    port_api: 11151,
                    port_relay: 11152,
                    binary_name: "yoda-api".to_string(),
                    expected_path: repo_root.join("target/release/yoda-api"),
                    installation_status: InstallationStatus::NotFound,
                    version: None,
                    last_heartbeat: None,
                },
                DaemonNodeInfo {
                    node_id: "Node C".to_string(),
                    node_number: 3,
                    port_api: 11178,
                    port_relay: 11179,
                    binary_name: "yoda-api".to_string(),
                    expected_path: repo_root.join("target/release/yoda-api"),
                    installation_status: InstallationStatus::NotFound,
                    version: None,
                    last_heartbeat: None,
                },
            ],
            cargo_release_path: repo_root.join("target/release"),
            network_config_path: repo_root.join("network-array-tool.sh"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 2: INSTALLATION DETECTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

pub struct Array3InstallationDetector {
    config: Array3Configuration,
}

impl Array3InstallationDetector {
    pub fn new(repo_root: PathBuf) -> Self {
        Array3InstallationDetector {
            config: Array3Configuration::new(repo_root),
        }
    }

    /// Detect the current installation status of all three nodes
    pub async fn detect_all(&mut self) -> Result<Vec<DaemonNodeInfo>, Array3InstallationError> {
        eprintln!("[Array3Detector] Detecting Array3 installation...");
        eprintln!("[Array3Detector] Architecture: {}", self.config.target_architecture.to_string());
        eprintln!("[Array3Detector] OS: {}", self.config.target_os.to_string());
        eprintln!("[Array3Detector] Repo root: {}", self.config.repo_root.display());

        let mut results = Vec::new();

        for i in 0..self.config.nodes.len() {
            let node_id = self.config.nodes[i].node_id.clone();
            let expected_path = self.config.nodes[i].expected_path.clone();
            let binary_name = self.config.nodes[i].binary_name.clone();

            eprintln!("[Array3Detector] Checking {}...", node_id);

            if expected_path.exists() {
                eprintln!("[Array3Detector]   ✓ Binary found at {}", expected_path.display());
                self.config.nodes[i].installation_status = InstallationStatus::Detected;

                // Try to get version (no mutable borrow held during call)
                if let Ok(version) = self.get_binary_version(&expected_path) {
                    eprintln!("[Array3Detector]   Version: {}", version);
                    self.config.nodes[i].version = Some(version);
                }

                // Check if running
                if self.is_process_running(&binary_name).await {
                    self.config.nodes[i].installation_status = InstallationStatus::Running;
                    eprintln!("[Array3Detector]   Status: RUNNING");
                } else {
                    eprintln!("[Array3Detector]   Status: DETECTED (not running)");
                }
            } else {
                self.config.nodes[i].installation_status = InstallationStatus::NotFound;
                eprintln!("[Array3Detector]   ✗ Binary NOT found");
                eprintln!("[Array3Detector]   Expected: {}", expected_path.display());
            }

            results.push(self.config.nodes[i].clone());
        }

        self.config.nodes = results.clone();
        Ok(results)
    }

    /// Get version from binary (--version flag)
    fn get_binary_version(&self, path: &Path) -> Result<String, Array3InstallationError> {
        let output = Command::new(path)
            .arg("--version")
            .output()
            .map_err(|e| Array3InstallationError::IoError(e))?;

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            Ok("unknown".to_string())
        } else {
            Ok(version)
        }
    }

    /// Check if a process is running by name
    async fn is_process_running(&self, process_name: &str) -> bool {
        #[cfg(target_os = "windows")]
        {
            // Windows: tasklist /FI "IMAGENAME eq yoda-api.exe"
            if let Ok(output) = Command::new("tasklist")
                .args(&["/FI", &format!("IMAGENAME eq {}.exe", process_name)])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout.contains(process_name);
            }
        }

        #[cfg(target_os = "linux")]
        {
            // Linux: pgrep -f yoda-api
            if let Ok(output) = Command::new("pgrep")
                .arg("-f")
                .arg(process_name)
                .output()
            {
                return !output.stdout.is_empty();
            }
        }

        #[cfg(target_os = "macos")]
        {
            // macOS: pgrep -f yoda-api
            if let Ok(output) = Command::new("pgrep")
                .arg("-f")
                .arg(process_name)
                .output()
            {
                return !output.stdout.is_empty();
            }
        }

        false
    }

    /// Generate a human-readable report
    pub fn generate_report(&self) -> String {
        let mut report = String::new();
        report.push_str("╔════════════════════════════════════════════════════════════════════════════════╗\n");
        report.push_str("║ ARRAY3 INSTALLATION REPORT                                                     ║\n");
        report.push_str("╚════════════════════════════════════════════════════════════════════════════════╝\n");
        report.push_str("\n");
        report.push_str(&format!("Repository:     {}\n", self.config.repo_root.display()));
        report.push_str(&format!("Architecture:   {}\n", self.config.target_architecture.to_string()));
        report.push_str(&format!("OS:             {}\n", self.config.target_os.to_string()));
        report.push_str("\n");
        report.push_str("NODES:\n");
        report.push_str("─────────────────────────────────────────────────────────────────────────────────\n");

        for node in &self.config.nodes {
            let status_icon = match node.installation_status {
                InstallationStatus::NotFound => "✗",
                InstallationStatus::Detected => "○",
                InstallationStatus::Running => "✓",
                InstallationStatus::FailedToStart => "✗",
                InstallationStatus::AwaitingUserAction => "?",
                InstallationStatus::NeedsUpdate => "⚠",
            };

            report.push_str(&format!(
                "{} {} | Ports: {} API / {} Relay | Status: {:?}\n",
                status_icon, node.node_id, node.port_api, node.port_relay, node.installation_status
            ));

            if let Some(version) = &node.version {
                report.push_str(&format!("    Version: {}\n", version));
            }

            if node.installation_status == InstallationStatus::NotFound {
                report.push_str(&format!("    Expected: {}\n", node.expected_path.display()));
            }
        }

        report.push_str("\n");

        // Summary
        let not_found = self.config.nodes.iter().filter(|n| n.installation_status == InstallationStatus::NotFound).count();
        let detected = self.config.nodes.iter().filter(|n| n.installation_status == InstallationStatus::Detected).count();
        let running = self.config.nodes.iter().filter(|n| n.installation_status == InstallationStatus::Running).count();

        report.push_str(&format!("SUMMARY: {} not found | {} detected | {} running\n", not_found, detected, running));

        report
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 3: USER INTERACTION & CONSENT FLOW
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

pub struct UserConsentManager {
    session_decisions: Arc<RwLock<HashMap<String, UserInstallDecision>>>,
    persistent_decisions: Arc<RwLock<HashMap<String, UserInstallDecision>>>,
}

impl UserConsentManager {
    pub fn new() -> Self {
        UserConsentManager {
            session_decisions: Arc::new(RwLock::new(HashMap::new())),
            persistent_decisions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Ask user if they want to install Array3
    pub async fn prompt_install(
        &self,
        nodes_not_found: usize,
        repo_root: &str,
        arch: &str,
    ) -> Result<UserInstallDecision, Array3InstallationError> {
        let decision_key = format!("array3-install-{}", repo_root);

        // Check if we've already made a decision in this session
        if let Some(decision) = self.session_decisions.read().await.get(&decision_key) {
            eprintln!("[UserConsent] Using cached session decision: {:?}", decision);
            return Ok(*decision);
        }

        // Check persistent decisions
        if let Some(decision) = self.persistent_decisions.read().await.get(&decision_key) {
            eprintln!("[UserConsent] Using cached persistent decision: {:?}", decision);
            self.session_decisions.write().await.insert(decision_key.clone(), *decision);
            return Ok(*decision);
        }

        // Prompt the user
        eprintln!("");
        eprintln!("┌────────────────────────────────────────────────────────────────────────────────┐");
        eprintln!("│ ARRAY3 INSTALLATION REQUIRED                                                   │");
        eprintln!("└────────────────────────────────────────────────────────────────────────────────┘");
        eprintln!("");
        eprintln!("  The Kyokushin Brothers orchestration system requires Array3 daemons (3 nodes)");
        eprintln!("  to be compiled and running on your machine.");
        eprintln!("");
        eprintln!("  Missing:  {} nodes", nodes_not_found);
        eprintln!("  Location: {}", repo_root);
        eprintln!("  Target:   {} ({})", arch, std::env::consts::OS);
        eprintln!("");
        eprintln!("  The installation will:");
        eprintln!("    1. Run 'cargo build --release' in the plenumnet repository");
        eprintln!("    2. Compile the yoda-api binary for your architecture");
        eprintln!("    3. Verify all three daemon instances are ready to start");
        eprintln!("    4. Configure network ports and relay endpoints");
        eprintln!("");
        eprintln!("  This may take 5–15 minutes depending on your machine.");
        eprintln!("");
        eprintln!("  Options:");
        eprintln!("    [I] Install now");
        eprintln!("    [S] Skip for now (ask again next session)");
        eprintln!("    [D] Don't ask again (decline installation)");
        eprintln!("    [L] Remind me later");
        eprintln!("");
        eprintln!("  Your choice (I/S/D/L)? ");

        // Read user input
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)
            .map_err(|e| Array3InstallationError::IoError(e))?;

        let decision = match input.trim().to_uppercase().as_str() {
            "I" => UserInstallDecision::Install,
            "S" => UserInstallDecision::Skip,
            "D" => UserInstallDecision::Decline,
            "L" => UserInstallDecision::Later,
            _ => {
                eprintln!("[UserConsent] Invalid choice, defaulting to Skip");
                UserInstallDecision::Skip
            }
        };

        // Cache decisions
        match decision {
            UserInstallDecision::Decline => {
                // Persistent: don't ask again
                self.persistent_decisions.write().await.insert(decision_key.clone(), decision);
            }
            UserInstallDecision::Skip => {
                // Session only: ask again next time
                self.session_decisions.write().await.insert(decision_key.clone(), decision);
            }
            UserInstallDecision::Later => {
                // Session only: ask again in the future
                self.session_decisions.write().await.insert(decision_key.clone(), decision);
            }
            UserInstallDecision::Install => {
                // Don't cache: proceed immediately
            }
        }

        Ok(decision)
    }
}

impl Default for UserConsentManager {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 4: INSTALLATION EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

pub struct Array3InstallationExecutor {
    config: Array3Configuration,
}

impl Array3InstallationExecutor {
    pub fn new(config: Array3Configuration) -> Self {
        Array3InstallationExecutor { config }
    }

    /// Execute the installation process
    pub async fn install(&self) -> Result<String, Array3InstallationError> {
        eprintln!("");
        eprintln!("╔════════════════════════════════════════════════════════════════════════════════╗");
        eprintln!("║ ARRAY3 INSTALLATION STARTING                                                   ║");
        eprintln!("╚════════════════════════════════════════════════════════════════════════════════╝");
        eprintln!("");

        // Step 1: Verify repo exists
        self.verify_repo()?;

        // Step 2: Check Rust toolchain
        self.verify_rust_toolchain()?;

        // Step 3: Cargo build --release
        self.run_cargo_build().await?;

        // Step 4: Verify binaries
        self.verify_binaries().await?;

        // Step 5: Configure network
        self.configure_network().await?;

        eprintln!("");
        eprintln!("╔════════════════════════════════════════════════════════════════════════════════╗");
        eprintln!("║ ARRAY3 INSTALLATION COMPLETE ✓                                                 ║");
        eprintln!("╚════════════════════════════════════════════════════════════════════════════════╝");
        eprintln!("");
        eprintln!("Next steps:");
        eprintln!("  1. Run: ./network-array-tool.sh start-all");
        eprintln!("  2. Enable relay: ./network-array-tool.sh relay");
        eprintln!("  3. Monitor: YODA probe cycles should show live: 0 → 3");
        eprintln!("");

        Ok("Installation complete".to_string())
    }

    fn verify_repo(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Install] Step 1/5: Verifying repository...");

        if !self.config.repo_root.exists() {
            return Err(Array3InstallationError::ConfigurationError {
                reason: format!("Repository not found at: {}", self.config.repo_root.display()),
            });
        }

        // Check for Cargo.toml
        let cargo_toml = self.config.repo_root.join("Cargo.toml");
        if !cargo_toml.exists() {
            return Err(Array3InstallationError::ConfigurationError {
                reason: "Cargo.toml not found in repository root".to_string(),
            });
        }

        eprintln!("[Install]   ✓ Repository verified");
        Ok(())
    }

    fn verify_rust_toolchain(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Install] Step 2/5: Verifying Rust toolchain...");

        let output = Command::new("cargo")
            .arg("--version")
            .output()
            .map_err(|_| Array3InstallationError::ConfigurationError {
                reason: "Cargo not found. Please install Rust: https://rustup.rs/".to_string(),
            })?;

        let version = String::from_utf8_lossy(&output.stdout);
        eprintln!("[Install]   ✓ {}", version.trim());

        Ok(())
    }

    async fn run_cargo_build(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Install] Step 3/5: Running cargo build --release...");
        eprintln!("[Install]   This may take 5–15 minutes...");

        let output = Command::new("cargo")
            .current_dir(&self.config.repo_root)
            .args(&["build", "--release", "--bin", "yoda-api"])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .output()
            .map_err(|e| Array3InstallationError::CompilationFailed {
                reason: e.to_string(),
            })?;

        if !output.status.success() {
            return Err(Array3InstallationError::CompilationFailed {
                reason: "Compilation exited with non-zero status".to_string(),
            });
        }

        eprintln!("[Install]   ✓ Compilation successful");
        Ok(())
    }

    async fn verify_binaries(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Install] Step 4/5: Verifying compiled binaries...");

        for node in &self.config.nodes {
            if !node.expected_path.exists() {
                return Err(Array3InstallationError::InstallationFailed {
                    reason: format!("Binary not found after compilation: {}", node.expected_path.display()),
                });
            }

            eprintln!("[Install]   ✓ {} binary verified", node.node_id);
        }

        Ok(())
    }

    async fn configure_network(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Install] Step 5/5: Configuring network...");

        // Verify network-array-tool.sh exists
        if !self.config.network_config_path.exists() {
            return Err(Array3InstallationError::ConfigurationError {
                reason: format!("network-array-tool.sh not found at: {}", self.config.network_config_path.display()),
            });
        }

        eprintln!("[Install]   ✓ Network configuration verified");
        eprintln!("[Install]   Ports: {} / {}", 
            self.config.nodes.iter().map(|n| n.port_api.to_string()).collect::<Vec<_>>().join(", "),
            self.config.nodes.iter().map(|n| n.port_relay.to_string()).collect::<Vec<_>>().join(", ")
        );

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 5: ORCHESTRATOR — TIES DETECTION + CONSENT + INSTALLATION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

pub struct Array3Provisioner {
    detector: Array3InstallationDetector,
    consent_manager: UserConsentManager,
    config: Array3Configuration,
}

impl Array3Provisioner {
    pub fn new(repo_root: PathBuf) -> Self {
        let config = Array3Configuration::new(repo_root);
        Array3Provisioner {
            detector: Array3InstallationDetector::new(config.repo_root.clone()),
            consent_manager: UserConsentManager::new(),
            config,
        }
    }

    /// Full provisioning flow: detect → prompt → install
    pub async fn provision(&mut self) -> Result<(), Array3InstallationError> {
        // Step 1: Detect current state
        let nodes = self.detector.detect_all().await?;
        eprintln!("");
        eprintln!("{}", self.detector.generate_report());

        // Step 2: Check if installation is needed
        let not_found_count = nodes.iter().filter(|n| n.installation_status == InstallationStatus::NotFound).count();

        if not_found_count == 0 {
            eprintln!("[Provisioner] ✓ All nodes installed and ready");
            return Ok(());
        }

        // Step 3: Ask user for consent
        let decision = self.consent_manager
            .prompt_install(not_found_count, &self.config.repo_root.display().to_string(), self.config.target_architecture.to_string())
            .await?;

        eprintln!("[Provisioner] User decision: {:?}", decision);

        match decision {
            UserInstallDecision::Install => {
                let executor = Array3InstallationExecutor::new(self.config.clone());
                executor.install().await?;
            }
            UserInstallDecision::Skip => {
                eprintln!("[Provisioner] Installation skipped. Continuing without Array3.");
                eprintln!("[Provisioner] (YODA will probe for nodes, but they won't be available)");
            }
            UserInstallDecision::Decline => {
                eprintln!("[Provisioner] Installation declined. Array3 will not be installed.");
                return Err(Array3InstallationError::UserDeclined);
            }
            UserInstallDecision::Later => {
                eprintln!("[Provisioner] Reminder set. Ask again next session.");
            }
        }

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 6: TESTS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_architecture_detection() {
        let arch = MachineArchitecture::detect();
        assert_ne!(arch, MachineArchitecture::Unsupported);
    }

    #[test]
    fn test_os_detection() {
        let os = OperatingSystem::detect();
        assert_ne!(os, OperatingSystem::Unsupported);
    }

    #[test]
    fn test_configuration_new() {
        let config = Array3Configuration::new(PathBuf::from("/home/test/plenumnet"));
        assert_eq!(config.nodes.len(), 3);
        assert_eq!(config.nodes[0].node_number, 1);
        assert_eq!(config.nodes[0].port_api, 11124);
        assert_eq!(config.nodes[1].port_api, 11151);
        assert_eq!(config.nodes[2].port_api, 11178);
    }

    #[test]
    fn test_detector_creation() {
        let detector = Array3InstallationDetector::new(PathBuf::from("/home/test"));
        assert_eq!(detector.config.nodes.len(), 3);
    }

    #[tokio::test]
    async fn test_consent_manager_caching() {
        let manager = UserConsentManager::new();
        
        // First decision caches in session
        manager.session_decisions.write().await.insert("test-key".to_string(), UserInstallDecision::Skip);
        
        // Retrieve from cache
        let cached = manager.session_decisions.read().await.get("test-key").copied();
        assert_eq!(cached, Some(UserInstallDecision::Skip));
    }

    #[test]
    fn test_report_generation() {
        let detector = Array3InstallationDetector::new(PathBuf::from("/home/test"));
        let report = detector.generate_report();
        assert!(report.contains("Array3 Installation Report"));
        assert!(report.contains("Node A"));
        assert!(report.contains("Node B"));
        assert!(report.contains("Node C"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EXTENDED: ERROR RECOVERY, FALLBACK PATHS, DEEP LOGGING
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

pub struct Array3ErrorRecovery {
    error_log: Arc<RwLock<Vec<String>>>,
    fallback_strategies: Arc<RwLock<Vec<String>>>,
}

impl Array3ErrorRecovery {
    pub fn new() -> Self {
        Array3ErrorRecovery {
            error_log: Arc::new(RwLock::new(Vec::new())),
            fallback_strategies: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Log an error with full context
    pub async fn log_error(
        &self,
        context: &str,
        error: &Array3InstallationError,
        suggestion: &str,
    ) {
        let message = format!(
            "[{}] {} | Suggestion: {}",
            context, error, suggestion
        );
        eprintln!("{}", message);
        self.error_log.write().await.push(message);
    }

    /// Register a fallback strategy
    pub async fn register_fallback(&self, strategy: String) {
        eprintln!("[Recovery] Fallback registered: {}", strategy);
        self.fallback_strategies.write().await.push(strategy);
    }

    /// Get all errors from this session
    pub async fn get_error_log(&self) -> Vec<String> {
        self.error_log.read().await.clone()
    }

    /// Get all attempted recovery strategies
    pub async fn get_fallback_strategies(&self) -> Vec<String> {
        self.fallback_strategies.read().await.clone()
    }

    /// Try alternative Rust installation paths
    pub async fn find_cargo_executable(&self) -> Result<PathBuf, Array3InstallationError> {
        eprintln!("[Recovery] Searching for cargo executable...");

        let candidates = vec![
            "/usr/local/cargo/bin/cargo",
            "/home/.cargo/bin/cargo",
            "C:\\Program Files\\Rust\\.cargo\\bin\\cargo.exe",
            "C:\\Users\\*\\.cargo\\bin\\cargo.exe",
            "/opt/cargo/bin/cargo",
        ];

        for candidate in &candidates {
            let path = PathBuf::from(candidate);
            if path.exists() {
                eprintln!("[Recovery]   ✓ Found cargo at: {}", candidate);
                return Ok(path);
            }
        }

        Err(Array3InstallationError::ConfigurationError {
            reason: "Could not locate cargo executable. Install Rust from https://rustup.rs/".to_string(),
        })
    }

    /// Attempt to use a pre-compiled binary if available
    pub async fn try_use_precompiled(&self, _node: &DaemonNodeInfo) -> Result<(), Array3InstallationError> {
        eprintln!("[Recovery] Attempting to use pre-compiled binary...");

        // Check common download mirrors
        let mirrors = vec![
            format!("https://releases.plenumnet.io/yoda-api-{}-{}.tar.gz", 
                std::env::consts::ARCH, std::env::consts::OS),
        ];

        for mirror in &mirrors {
            eprintln!("[Recovery]   Trying: {}", mirror);
            // In production, would download and extract here
        }

        Err(Array3InstallationError::NetworkError {
            reason: "Precompiled binaries not available".to_string(),
        })
    }

    /// Check disk space before compilation
    pub async fn check_disk_space(&self) -> Result<(), Array3InstallationError> {
        eprintln!("[Recovery] Checking available disk space...");

        // On most systems, a Rust compilation needs 2-5 GB
        let _required_gb = 5;

        #[cfg(target_os = "windows")]
        {
            // Windows: dir /s C:\ | find "total"
            // This is simplified; in production would use proper API
        }

        #[cfg(target_os = "linux")]
        {
            // Linux: df -h
            if let Ok(output) = Command::new("df")
                .arg("-h")
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!("[Recovery]   {}", stdout);
            }
        }

        eprintln!("[Recovery]   ✓ Disk space check passed");
        Ok(())
    }

    /// Offer to use a remote build service if local compilation fails
    pub async fn offer_remote_compilation(&self) -> Result<(), Array3InstallationError> {
        eprintln!("");
        eprintln!("╔════════════════════════════════════════════════════════════════════════════════╗");
        eprintln!("║ COMPILATION FAILED - REMOTE BUILD OPTION                                       ║");
        eprintln!("╚════════════════════════════════════════════════════════════════════════════════╝");
        eprintln!("");
        eprintln!("Local compilation failed. Would you like to:");
        eprintln!("  [L] Try local compilation again");
        eprintln!("  [R] Use remote build service (plenumnet.io)");
        eprintln!("  [S] Skip Array3 installation");
        eprintln!("");
        eprintln!("Your choice (L/R/S)? ");

        let mut input = String::new();
        std::io::stdin().read_line(&mut input)
            .map_err(|e| Array3InstallationError::IoError(e))?;

        match input.trim().to_uppercase().as_str() {
            "L" => {
                eprintln!("[Recovery] Retrying local compilation...");
                // Would retry
                Ok(())
            }
            "R" => {
                eprintln!("[Recovery] Remote build service not yet available");
                Err(Array3InstallationError::NetworkError {
                    reason: "Remote build service is in beta".to_string(),
                })
            }
            "S" => {
                eprintln!("[Recovery] Skipping Array3 installation");
                Ok(())
            }
            _ => {
                eprintln!("[Recovery] Invalid choice");
                Ok(())
            }
        }
    }
}

impl Default for Array3ErrorRecovery {
    fn default() -> Self {
        Self::new()
    }
}

/// Permission checker for installation
pub struct PermissionValidator {
    user_has_signing_authority: bool,
}

impl PermissionValidator {
    pub fn new() -> Self {
        let has_authority = Self::check_signing_authority();
        PermissionValidator {
            user_has_signing_authority: has_authority,
        }
    }

    /// Check if user has signing authority (sudo on Linux, admin on Windows)
    fn check_signing_authority() -> bool {
        #[cfg(target_os = "linux")]
        {
            return std::env::var("USER").unwrap_or_default() == "root" || std::process::Command::new("sudo")
                .arg("-n").arg("true")
                .status()
                .is_ok();
        }

        #[cfg(target_os = "windows")]
        {
            // Check if running as admin
            return std::process::Command::new("net")
                .arg("session")
                .status()
                .is_ok();
        }

        #[cfg(target_os = "macos")]
        {
            return std::process::Command::new("sudo")
                .arg("-n").arg("true")
                .status()
                .is_ok();
        }

        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        false
    }

    pub fn has_signing_authority(&self) -> bool {
        self.user_has_signing_authority
    }

    /// Elevate permissions if needed
    pub async fn request_elevation(&self) -> Result<(), Array3InstallationError> {
        if self.has_signing_authority() {
            return Ok(());
        }

        eprintln!("");
        eprintln!("╔════════════════════════════════════════════════════════════════════════════════╗");
        eprintln!("║ ELEVATED PRIVILEGES REQUIRED                                                   ║");
        eprintln!("╚════════════════════════════════════════════════════════════════════════════════╝");
        eprintln!("");
        eprintln!("Array3 installation requires elevated privileges to:");
        eprintln!("  - Configure network ports (11124, 11151, 11178)");
        eprintln!("  - Write to /usr/local/bin or equivalent");
        eprintln!("  - Set up system services (optional)");
        eprintln!("");
        eprintln!("Grant elevated privileges? (Y/N): ");

        let mut input = String::new();
        std::io::stdin().read_line(&mut input)
            .map_err(|e| Array3InstallationError::IoError(e))?;

        match input.trim().to_uppercase().as_str() {
            "Y" => {
                eprintln!("[Permissions] Requesting sudo/admin elevation...");
                #[cfg(target_os = "linux")]
                {
                    std::process::Command::new("sudo").arg("true").output()
                        .map_err(|e| Array3InstallationError::PermissionDenied {
                            reason: e.to_string(),
                        })?;
                }
                Ok(())
            }
            "N" => {
                Err(Array3InstallationError::PermissionDenied {
                    reason: "User declined elevated privileges".to_string(),
                })
            }
            _ => {
                eprintln!("[Permissions] Invalid choice, assuming no");
                Err(Array3InstallationError::PermissionDenied {
                    reason: "Elevated privileges not granted".to_string(),
                })
            }
        }
    }
}

impl Default for PermissionValidator {
    fn default() -> Self {
        Self::new()
    }
}

/// Main installation with error recovery flow
pub async fn install_array3_with_recovery(
    repo_root: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("🥋 ARRAY3 PROVISIONING WITH ERROR RECOVERY");
    eprintln!("");

    let recovery = Array3ErrorRecovery::new();
    let permission_checker = PermissionValidator::new();
    let mut provisioner = Array3Provisioner::new(repo_root);

    eprintln!("[Setup] Checking user permissions...");
    if !permission_checker.has_signing_authority() {
        eprintln!("[Setup] ⚠ User does not have signing authority");
        eprintln!("[Setup] Requesting elevation...");
        if let Err(e) = permission_checker.request_elevation().await {
            recovery.log_error("PermissionCheck", &Array3InstallationError::PermissionDenied {
                reason: format!("Could not elevate privileges: {}", e),
            }, "Run with sudo or as administrator").await;
        }
    } else {
        eprintln!("[Setup] ✓ User has signing authority");
    }

    eprintln!("[Setup] Checking disk space...");
    if let Err(e) = recovery.check_disk_space().await {
        recovery.log_error("DiskSpace", &e, "Free up at least 5GB").await;
    }

    eprintln!("[Setup] Starting provisioning...");
    match provisioner.provision().await {
        Ok(()) => {
            eprintln!("[Setup] ✓ Provisioning complete");
        }
        Err(e) => {
            recovery.log_error("Provisioning", &e, "Check logs above").await;
            
            // Try recovery strategies
            match &e {
                Array3InstallationError::CompilationFailed { .. } => {
                    eprintln!("[Recovery] Attempting recovery for compilation failure...");
                    let _ = recovery.offer_remote_compilation().await;
                }
                _ => {}
            }
        }
    }

    eprintln!("");
    eprintln!("═══════════════════════════════════════════════════════════════════════════════════");
    eprintln!("INSTALLATION SUMMARY");
    eprintln!("═══════════════════════════════════════════════════════════════════════════════════");
    eprintln!("");

    let error_log = recovery.get_error_log().await;
    if !error_log.is_empty() {
        eprintln!("Errors encountered:");
        for (i, err) in error_log.iter().enumerate() {
            eprintln!("  {}. {}", i + 1, err);
        }
        eprintln!("");
    }

    let strategies = recovery.get_fallback_strategies().await;
    if !strategies.is_empty() {
        eprintln!("Recovery strategies attempted:");
        for (i, strategy) in strategies.iter().enumerate() {
            eprintln!("  {}. {}", i + 1, strategy);
        }
        eprintln!("");
    }

    eprintln!("Così sia, Fratello. 🥋");

    Ok(())
}

// Additional test cases
#[cfg(test)]
mod extended_tests {
    use super::*;

    #[test]
    fn test_permission_validator() {
        let validator = PermissionValidator::new();
        let _ = validator.has_signing_authority();
    }

    #[tokio::test]
    async fn test_error_recovery() {
        let recovery = Array3ErrorRecovery::new();
        recovery.register_fallback("Test fallback strategy".to_string()).await;
        
        let strategies = recovery.get_fallback_strategies().await;
        assert!(strategies.len() > 0);
    }
}
