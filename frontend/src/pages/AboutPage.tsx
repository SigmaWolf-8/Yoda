import { useState } from 'react';
import {
  Info,
  Zap,
  GitBranch,
  BookOpen,
  Database,
  Shield,
  Users,
  Cpu,
  Globe,
  Code2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mail,
  Lock,
  Server,
  Activity,
  Brain,
} from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';
import { BevelBox } from '../components/ui/BevelBox';

function SectionHeading({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <Icon className="w-5 h-5 text-[var(--color-gold-400)] flex-shrink-0" />
      <h2 className="text-lg font-bold text-[var(--color-text-primary)] tracking-wide">{title}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <BevelBox className={`bg-[var(--color-surface-primary)] p-5 ${className}`}>
      {children}
    </BevelBox>
  );
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is the difference between Yoda Mode and Ronin Mode?',
    a: 'Yoda Mode produces analysis, architecture, and recommendations — the thinking phase. Ronin Mode produces implementation-ready code with the analysis baked in — the building phase. You can start in Yoda Mode and promote to Ronin Mode when ready. All context carries forward.',
  },
  {
    q: 'How does the adversarial review protocol improve output quality?',
    a: "Every task is produced by one engine and independently reviewed by two or three others from different model families. Reviewers don't know which engine produced the output. This eliminates confirmation bias and catches errors that a single model would miss — the same principle behind peer review in academia and code review in engineering.",
  },
  {
    q: 'What are the three engines and why do they need to be different?',
    a: 'YODA requires three AI processing engines (any OpenAI-compatible endpoint — self-hosted, commercial API, or free-tier). They must come from three distinct model families (for example, Qwen, Claude, and DeepSeek). This diversity is enforced by the platform — it prevents echo chamber effects where similar models agree on the same mistakes.',
  },
  {
    q: 'What is the Task Bible?',
    a: 'A permanent, cryptographically signed record of every completed task. It contains the original request, all intermediate versions, every reviewer verdict, the final output, extracted code blocks, and a TL-DSA signature chain. You can export it as JSON and independently verify that nothing was tampered with.',
  },
  {
    q: "How does PlenumNET's post-quantum cryptography relate to NIST standards?",
    a: "PlenumNET's TL-DSA-87 signature scheme is an independent construction designed to meet or exceed the security guarantees of NIST PQC Level 5 (192-bit quantum resistance). It is built on the TLSponge-385 sponge construction — a ternary-native design, not a submission to the NIST PQC competition. The security target is equivalent; the mathematical foundation is distinct.",
  },
  {
    q: 'Can I use my own self-hosted models?',
    a: 'Yes. YODA works with any OpenAI-compatible endpoint — llama-server, vLLM, Ollama, or any custom server that speaks the standard chat completions API. Mix self-hosted and commercial engines freely across the three slots.',
  },
  {
    q: 'How many agents are available?',
    a: '154 role-based agents across 13 divisions (Engineering, Design, Sales, Marketing, Paid Media, Product, Project Management, Testing, Support, Game Development, Spatial Computing, Specialized, and Strategy), plus 5 proprietary Capomastro agents for the PlenumNET ecosystem. The roster grows continuously through the open-source upstream sync.',
  },
];

const CRATES = [
  { name: 'yoda-api', desc: '46 API routes, WebSocket, SaaS authentication' },
  { name: 'yoda-orchestrator', desc: 'DAG engine, four-step protocol, task assembly' },
  { name: 'yoda-inference-router', desc: 'Engine dispatch, diversity enforcement, health monitoring' },
  { name: 'yoda-knowledge-base', desc: 'Hybrid search, embeddings, retention policies' },
  { name: 'yoda-plenumnet-bridge', desc: 'Post-quantum cryptographic primitives' },
  { name: 'yoda-task-bible', desc: 'Permanent signed records' },
  { name: 'yoda-agent-compiler', desc: 'Markdown-to-JSON agent configuration pipeline' },
];

export function AboutPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  usePageHeader({
    icon: Info,
    title: 'About',
    subtitle: 'YODA — Auditable Multi-Agent AI Platform with Verified Outputs & Post-Quantum Signatures',
  });

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in space-y-8">

      {/* ── Hero ── */}
      <Card>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
          YODA: Secure Multi-Agent AI Platform with Adversarial Review and Post-Quantum Signatures
        </h1>
        <p className="text-base font-semibold text-[var(--color-plex-400)] mb-3">
          Build Smarter. Every Output Verified. Nothing Trusted by Default.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          YODA is the first development intelligence platform that forces every AI output to be independently
          reviewed, revised, and cryptographically signed — giving engineering teams, architects, and compliance
          officers an irrefutable audit trail for every deliverable.
        </p>
        <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-5">
          No single model. No unchecked outputs. No blind trust.
        </p>
        <div className="border-t border-[var(--color-border-subtle)] pt-4">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">TL;DR — What YODA does in five points</p>
          <ul className="space-y-2">
            {[
              'Decomposes complex requests into task graphs and assigns specialized agents from a roster of 154 experts across 13 divisions',
              'Runs every task through a mandatory adversarial review protocol across three independent engine families',
              'Signs every final output with post-quantum cryptography (TL-DSA) — creating a tamper-proof audit trail',
              'Stores knowledge automatically and compounds it across projects via hybrid search',
              'Ships SaaS-ready with multi-org auth, real-time WebSocket pipeline, and self-hosted engine support',
            ].map((point, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-[var(--color-text-secondary)]">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-[var(--color-plex-500)]/15 border border-[var(--color-plex-500)]/25 text-[var(--color-plex-400)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* ── What YODA Does ── */}
      <Card>
        <SectionHeading icon={Zap} title="What Does YODA Do?" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          YODA is a recursive multi-agent, multi-engine development intelligence platform. You describe what you
          want built. YODA decomposes it into tasks, assigns specialized agents from a roster of 154 role-based
          experts across 13 divisions, runs every task through an adversarial review protocol across multiple
          independent engines, and assembles the results into a verified, signed deliverable.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">Two modes serve different needs:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BevelBox className="bg-[var(--color-surface-secondary)] p-4">
            <p className="text-sm font-semibold text-[var(--color-plex-400)] mb-1">Yoda Mode</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Produces architecture documents, technical analyses, security reviews, and strategic recommendations.
              It answers the question <em>"What should we build and why?"</em>
            </p>
          </BevelBox>
          <BevelBox className="bg-[var(--color-surface-secondary)] p-4">
            <p className="text-sm font-semibold text-[var(--color-plex-400)] mb-1">Ronin Mode</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Produces implementation-ready code with the analysis baked in. Architecture decisions, code blocks,
              test cases, and deployment instructions — all generated through the same adversarial process.
              It answers <em>"Build it."</em>
            </p>
          </BevelBox>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] mt-3">
          Start in Yoda Mode to explore a problem space. Promote to Ronin Mode when you're ready to implement.
          Context carries forward. Nothing is lost.
        </p>
      </Card>

      {/* ── What Makes YODA Different ── */}
      <Card>
        <SectionHeading icon={Brain} title="What Makes YODA Different?" />

        {/* Three Independent Engines */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-[var(--color-plex-400)] flex-shrink-0" />
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Three Independent Engines — No Echo Chambers</p>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            Most AI platforms send your prompt to one model and return whatever it says. YODA requires three
            engines from three different model families. Engine A produces. Engine B reviews. Engine C provides
            a second opinion. No engine ever reviews its own work.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This is enforced architecturally. The diversity validator rejects configurations where two engines
            share a model lineage. Mix freely — one self-hosted open-source model, one Anthropic API, one
            DeepSeek API. The result is every output examined by genuinely independent perspectives, not three
            copies of the same weights with different names.
          </p>
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="w-4 h-4 text-[var(--color-plex-400)] flex-shrink-0" />
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">DAG Task Decomposition with Budget Preview</p>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            Complex queries are decomposed into a directed acyclic graph of interdependent tasks, each with
            specific competency requirements and dependency chains.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            A request like <em>"Build a payment processing microservice with Stripe integration"</em> might
            decompose into twelve tasks across architecture, API design, security review, implementation,
            testing, and deployment — with the security review blocking implementation, and the API design
            feeding both.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            If the decomposition exceeds your configured budget, YODA shows you the proposed task tree and
            waits for your approval before spending a single API call.
          </p>
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4 text-[var(--color-plex-400)] flex-shrink-0" />
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">The Task Bible — A Tamper-Proof Audit Trail</p>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            Every completed task produces a Task Bible entry — a permanent, signed record containing the
            original request, all intermediate results, every reviewer verdict, the final output, extracted
            code blocks, and a TL-DSA signature chain that cryptographically proves the entire sequence.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Export any Task Bible entry as a signed JSON document. Verify independently that no output was
            tampered with after completion.
          </p>
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-5">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-[var(--color-plex-400)] flex-shrink-0" />
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Knowledge That Compounds Across Projects</p>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            If a query was complex enough to decompose, every result is automatically stored in the Knowledge
            Base. Simple queries produce no storage — no clutter.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            New tasks search your Knowledge Base using hybrid retrieval (keyword matching plus semantic
            similarity) and inject relevant prior work into the agent's context. Your third project in the
            same domain benefits from everything the first two produced.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Tags are hierarchical and auto-suggested. Pin critical entries. Archive old work without deleting
            it. The system adapts to how you work.
          </p>
        </div>
      </Card>

      {/* ── 4-Step Review Protocol ── */}
      <Card>
        <SectionHeading icon={Activity} title="How Does the Four-Step Review Protocol Work?" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-5">
          Every task — whether it's a database schema review or a complete API implementation — passes through
          the same adversarial refinement:
        </p>
        <div className="space-y-3 mb-4">
          {[
            {
              label: 'Step 1: Production.',
              body: "A specialized agent (one of 154 role-based experts) generates the initial output using the best-matched engine for the task's competency requirements.",
            },
            {
              label: 'Step 2: Independent Review.',
              body: "Two or three reviewer agents (configurable per project) on different engines evaluate the output against role-specific review criteria. They don't know which engine produced it. They issue verdicts: approve, revise, or reject.",
            },
            {
              label: 'Step 3: Revision.',
              body: 'If reviewers request changes, the producer incorporates their feedback and generates a revised version. The cycle can repeat up to the configured limit.',
            },
            {
              label: 'Step 4: Assembly.',
              body: 'The final approved output is assembled with its complete audit trail — every version, every review, every verdict — signed with TL-DSA and recorded in the Task Bible.',
            },
          ].map(({ label, body }) => (
            <BevelBox key={label} className="bg-[var(--color-surface-secondary)] px-4 py-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">{label}</strong>{' '}{body}
              </p>
            </BevelBox>
          ))}
        </div>
        <p className="text-sm font-semibold text-[var(--color-plex-400)] text-center">
          This isn't optional. It's the protocol. Every task, every time.
        </p>
      </Card>

      {/* ── Agent Roster ── */}
      <Card>
        <SectionHeading icon={Users} title="The Agent Roster: 154 Specialized Experts Across 13 Divisions" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          YODA ships with 154 specialized agents organized across 13 divisions — plus 5 proprietary Capomastro
          agents purpose-built for the PlenumNET ecosystem.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          The upstream roster draws from{' '}
          <a href="https://github.com/msitarzewski/agency-agents" target="_blank" rel="noreferrer"
            className="text-[var(--color-plex-400)] hover:text-[var(--color-plex-300)] underline underline-offset-2 transition-colors">
            The Agency
          </a>
          , an open-source collection of battle-tested AI agent personalities (MIT licensed, 31,000+ GitHub
          stars), covering:
        </p>
        <div className="space-y-2 mb-4">
          {[
            { heading: 'Engineering (15+ agents)', body: 'Frontend Developer, Backend Architect, Mobile App Builder, AI Engineer, DevOps Automator, Rapid Prototyper, Senior Developer, Security Engineer, Embedded Firmware Engineer, Incident Response Commander, Solidity Smart Contract Engineer, Technical Writer, Threat Detection Engineer, WeChat Mini Program Developer, and more.' },
            { heading: 'Design (8 agents)', body: 'UI Designer, UX Researcher, UX Architect, Brand Guardian, Visual Storyteller, Whimsy Injector, Image Prompt Engineer, Inclusive Visuals Specialist.' },
            { heading: 'Sales (8 agents)', body: 'Outbound Strategist, Discovery Coach, Deal Strategist, Sales Engineer, Proposal Strategist, Pipeline Analyst, Account Strategist, Sales Coach.' },
            { heading: 'Marketing (18+ agents)', body: 'Growth Hacker, Content Creator, SEO Specialist, LinkedIn Content Creator, and social platform specialists for Twitter, TikTok, Instagram, Reddit, plus regional experts for Xiaohongshu, WeChat, Zhihu, Baidu, Bilibili, and Kuaishou.' },
            { heading: 'Paid Media (7 agents)', body: 'PPC Campaign Strategist, Search Query Analyst, Paid Media Auditor, Tracking Specialist, Ad Creative Strategist, Programmatic Buyer, Paid Social Strategist.' },
            { heading: 'Product (4 agents)', body: 'Sprint Prioritizer, Trend Researcher, Feedback Synthesizer, Behavioral Nudge Engine.' },
            { heading: 'Project Management (6 agents)', body: 'Studio Producer, Project Shepherd, Studio Operations, Experiment Tracker, Senior Project Manager, Jira Workflow Steward.' },
            { heading: 'Testing (8 agents)', body: 'Evidence Collector, Reality Checker, Test Results Analyzer, Performance Benchmarker, API Tester, Tool Evaluator, Workflow Optimizer, Accessibility Auditor.' },
            { heading: 'Support (6 agents)', body: 'Support Responder, Analytics Reporter, Finance Tracker, Infrastructure Maintainer, Legal Compliance Checker, Executive Summary Generator.' },
            { heading: 'Game Development (19+ agents)', body: 'Cross-engine designers (Game Designer, Level Designer, Technical Artist, Audio Engineer, Narrative Designer) plus engine-specific specialists for Unity, Unreal Engine, Godot, and Roblox Studio.' },
            { heading: 'Spatial Computing (6 agents)', body: 'XR Interface Architect, visionOS Spatial Engineer, macOS Metal Engineer, WebXR Developer, Cockpit Interaction Specialist, Terminal Integration Specialist.' },
            { heading: 'Specialized (14+ agents)', body: 'Agents Orchestrator, LSP/Index Engineer, Blockchain Security Auditor, Compliance Auditor, Cultural Intelligence Strategist, Developer Advocate, Model QA Specialist, ZK Steward, and domain-specific data, identity, and payments agents.' },
            { heading: 'Strategy', body: 'Strategic planning and advisory agents for business direction, competitive positioning, and organizational alignment.' },
          ].map(({ heading, body }) => (
            <BevelBox key={heading} className="bg-[var(--color-surface-secondary)] px-4 py-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">{heading}</strong>{' — '}{body}
              </p>
            </BevelBox>
          ))}
        </div>
        <BevelBox className="bg-[var(--color-plex-600)]/5 p-4 mb-3" wrapperClassName="border border-[var(--color-plex-600)]/25">
          <p className="text-sm text-[var(--color-text-secondary)]">
            <strong className="text-[var(--color-plex-400)]">Capomastro Proprietary (5 agents)</strong>{' — '}
            YODA Orchestrator, Ternary Crypto Reviewer, PlenumNET Integration Specialist, Knowledge Base
            Curator, and Maestro Task Bible Manager. Authored and maintained exclusively by Capomastro Holdings
            for the PlenumNET ecosystem and YODA orchestration protocol.
          </p>
        </BevelBox>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          Every agent is fully editable — modify system prompts, competencies, review criteria, and compatible
          reviewers directly from the platform. Creating a new agent is a single click: define it in markdown,
          and the agent compiler handles the rest. No code changes, no redeployment.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          New agents from the upstream repository are detected when you visit the Agents page. YODA presents
          them for your review before they enter the roster. Nothing auto-imports without your approval.
          Capomastro agents are never touched by the sync.
        </p>
      </Card>

      {/* ── Built for Real Teams ── */}
      <Card>
        <SectionHeading icon={Globe} title="Built for Real Teams" />
        <div className="space-y-3">
          {[
            {
              icon: Globe,
              heading: 'SaaS-Ready from Day One.',
              body: 'Multi-organization, multi-user, JWT authentication with refresh tokens, API key management for CI/CD integration. Every project is scoped to an organization. Every action is attributed to a user.',
            },
            {
              icon: Server,
              heading: 'Self-Hosted Engine Support.',
              body: "Run your own models with llama-server, vLLM, or any OpenAI-compatible endpoint. Mix self-hosted and commercial engines freely. YODA doesn't care where the processing comes from as long as the families are distinct.",
            },
            {
              icon: Activity,
              heading: 'Real-Time Pipeline Visibility.',
              body: 'WebSocket-driven live updates show which engine is producing, which reviewers are active, what step each task is on, and estimated completion. No polling, no page refreshes.',
            },
            {
              icon: Brain,
              heading: 'Capability Learning.',
              body: 'YODA tracks which engines perform best for which agent roles and domains. Over time, it routes tasks to the engines that have proven strongest for that type of work. Recent performance matters more than historical.',
            },
          ].map(({ icon: Icon, heading, body }) => (
            <BevelBox key={heading} className="bg-[var(--color-surface-secondary)] px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-[var(--color-plex-400)] flex-shrink-0" />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">{heading}</strong>{' '}{body}
              </p>
            </BevelBox>
          ))}
        </div>
      </Card>

      {/* ── Architecture ── */}
      <Card>
        <SectionHeading icon={Code2} title="Architecture" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          The platform is a Rust/Axum backend serving a React frontend, with PostgreSQL (including pgvector for
          semantic search) as the data layer. Seven Rust crates handle distinct responsibilities:
        </p>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--color-surface-secondary)]">
                <th className="text-left px-4 py-2.5 font-semibold text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Crate</th>
                <th className="text-left px-4 py-2.5 font-semibold text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Responsibility</th>
              </tr>
            </thead>
            <tbody>
              {CRATES.map(({ name, desc }) => (
                <tr key={name} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-secondary)]/60 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-plex-400)] whitespace-nowrap">{name}</td>
                  <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The frontend is React 19 with TypeScript, Tailwind CSS, React Query, Monaco Editor for code display,
          and Recharts for monitoring dashboards.
        </p>
      </Card>

      {/* ── PlenumNET ── */}
      <Card>
        <SectionHeading icon={Shield} title="Secured by PlenumNET: Post-Quantum Cryptography" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Every cryptographic operation in YODA is powered by PlenumNET — the post-quantum ternary cryptographic
          framework developed by Capomastro Holdings.
        </p>
        <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">What Does PlenumNET Protect?</p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          PlenumNET provides five primitives used throughout the stack:
        </p>
        <div className="space-y-3 mb-5">
          {[
            {
              name: 'TIS-27 Integrity Hashing.',
              body: 'Every response from every engine is hashed on arrival. Every encrypted blob is integrity-verified before decryption. 2.52 GB/s throughput, 191 ns latency per hash — fast enough to verify every API call with zero measurable overhead.',
            },
            {
              name: 'TL-DSA Digital Signatures.',
              body: 'Every Task Bible entry and audit record is signed with TL-DSA-87, a post-quantum signature scheme designed to meet or exceed NIST PQC Level 5 equivalent security (192-bit quantum resistance). TL-DSA is an independent construction built on the TLSponge-385 sponge — it is not a NIST submission, but targets the same security guarantees. Per-project keypairs are generated automatically. Old keys are preserved after rotation so historical signatures remain verifiable indefinitely.',
            },
            {
              name: 'Phase Encryption.',
              body: 'Credentials, private keys, and sensitive data are encrypted at rest using Adaptive Dual-Phase Quantum Encryption. Four modes (High Security, Balanced, Performance, Adaptive) match protection level to data classification. Guardian phase tamper detection verifies ciphertext integrity before any decryption attempt.',
            },
            {
              name: 'TLSponge-385 Key Derivation.',
              body: 'All encryption keys are derived through the TLSponge-385 sponge construction with domain separation. Project keys, credential keys, and session keys produce cryptographically independent outputs from the same primitive.',
            },
            {
              name: 'TL-KEM Key Encapsulation.',
              body: 'Three security levels (512, 768, 1024) for post-quantum key exchange. Shared secrets feed directly into Phase Encryption key derivation.',
            },
          ].map(({ name, body }) => (
            <BevelBox key={name} className="bg-[var(--color-surface-secondary)] px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-3.5 h-3.5 text-[var(--color-plex-400)] flex-shrink-0" />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">{name}</strong>{' '}{body}
              </p>
            </BevelBox>
          ))}
        </div>
        <div className="border-t border-[var(--color-border-subtle)] pt-4">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Why Does This Matter?</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            Remove PlenumNET and YODA has no signatures, no encryption at rest, no integrity verification, and
            no audit trail. The security model is the platform — not a feature you can toggle off.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            PlenumNET is developed as part of the{' '}
            <a href="https://github.com/SigmaWolf-8/Ternary" target="_blank" rel="noreferrer"
              className="text-[var(--color-plex-400)] hover:text-[var(--color-plex-300)] underline underline-offset-2 transition-colors">
              Salvi Framework
            </a>
            {' '}— a comprehensive ternary computing platform spanning cryptography, networking, and formal
            mathematics.
          </p>
        </div>
      </Card>

      {/* ── Open Source Foundation, Proprietary Edge ── */}
      <Card>
        <SectionHeading icon={GitBranch} title="Open Source Foundation, Proprietary Edge" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          YODA's agent ecosystem builds on{' '}
          <a href="https://github.com/msitarzewski/agency-agents" target="_blank" rel="noreferrer"
            className="text-[var(--color-plex-400)] hover:text-[var(--color-plex-300)] underline underline-offset-2 transition-colors">
            The Agency
          </a>
          {' '}(MIT licensed, 31,000+ stars), extending it with five proprietary Capomastro agents specialized
          for PlenumNET integration, ternary cryptography review, and the YODA orchestration protocol.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The upstream sync mechanism keeps you current with community contributions. You control what enters
          your roster. Proprietary agents are never exposed to the sync.
        </p>
      </Card>

      {/* ── Who Built This ── */}
      <Card>
        <SectionHeading icon={Users} title="Who Built This" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          YODA is a product of{' '}
          <strong className="text-[var(--color-text-primary)]">Capomastro Holdings Ltd., Applied Physics Division</strong>
          , based in Sherwood Park, Alberta, Canada.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The platform, the PlenumNET cryptographic framework, and the Salvi Framework are designed and engineered
          by the Applied Physics Division — bridging theoretical foundations in ternary mathematics with
          production-grade software systems.
        </p>
      </Card>

      {/* ── Get Started ── */}
      <Card>
        <SectionHeading icon={ExternalLink} title="Get Started" />
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/SigmaWolf-8/Yoda"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-plex-500)]/30 bg-[var(--color-plex-500)]/8 text-sm font-medium text-[var(--color-plex-400)] hover:bg-[var(--color-plex-500)]/15 hover:border-[var(--color-plex-500)]/50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Explore the code — github.com/SigmaWolf-8/Yoda
          </a>
          <a
            href="https://github.com/SigmaWolf-8/Ternary"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-plex-500)]/30 bg-[var(--color-plex-500)]/8 text-sm font-medium text-[var(--color-plex-400)] hover:bg-[var(--color-plex-500)]/15 hover:border-[var(--color-plex-500)]/50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Read the Salvi Framework — github.com/SigmaWolf-8/Ternary
          </a>
          <a
            href="mailto:RSalvi@Salvigroup.com"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            RSalvi@Salvigroup.com
          </a>
        </div>
      </Card>

      {/* ── FAQ ── */}
      <Card>
        <SectionHeading icon={BookOpen} title="Frequently Asked Questions" />
        <div className="space-y-2">
          {FAQS.map(({ q, a }, i) => (
            <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
              <button
                className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-[var(--color-surface-secondary)] transition-colors"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{q}</span>
                {openFaq === i
                  ? <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                }
              </button>
              {openFaq === i && (
                <div className="px-4 pb-4 pt-1 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border-subtle)]">
                  <p className="text-sm text-[var(--color-text-secondary)]">{a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Footer tagline ── */}
      <div className="text-center pb-4 space-y-1">
        <p className="text-sm text-[var(--color-text-muted)] italic">
          The name YODA reflects the platform's core philosophy: wisdom comes not from trusting a single source,
          but from structured challenge and verification. In Yoda Mode, it thinks before it builds. In Ronin Mode,
          it builds with the discipline of having thought first.
        </p>
        <p className="text-sm font-semibold text-[var(--color-plex-400)] italic">Every output earned its signature.</p>
      </div>

    </div>
  );
}
