/** Agency-agents catalog: category > subcategory > agents */
export type AgencyCatalogAgent = { name: string; desc: string };
export type AgencyCatalogSubcategory = { name: string; label: string; agents: AgencyCatalogAgent[] };
export type AgencyCatalogCategory = { category: string; label: string; subcategories: AgencyCatalogSubcategory[] };

import { TERM_DIM, TERM_SEM_BLUE, TERM_SEM_YELLOW, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme";

/** Status colors are derived from the active theme's semantic palette */
export function getStatusConfig(): Record<string, { color: string; label: string }> {
  return {
    idle: { color: TERM_DIM, label: "Idle" },
    working: { color: TERM_SEM_BLUE, label: "Working..." },
    waiting_approval: { color: TERM_SEM_YELLOW, label: "Needs Approval" },
    done: { color: TERM_SEM_GREEN, label: "Done" },
    error: { color: TERM_SEM_RED, label: "Error" },
  };
}
// Keep a static default for backward compat (components should prefer getStatusConfig())
export const STATUS_CONFIG = getStatusConfig();

export const RATING_DIMENSIONS = [
  { key: "creativity", label: "Creativity", icon: "✦" },
  { key: "visual", label: "Visual", icon: "◈" },
  { key: "interaction", label: "Interaction", icon: "⚡" },
  { key: "completeness", label: "Completeness", icon: "●" },
  { key: "engagement", label: "Engagement", icon: "♥" },
] as const;

export type RatingKey = (typeof RATING_DIMENSIONS)[number]["key"];
export type Ratings = Partial<Record<RatingKey, number>>;

export const BACKEND_OPTIONS = [
  { id: "claude", name: "Claude", color: "#d97706" },
  { id: "codex", name: "Codex", color: "#a855f7" },
  { id: "gemini", name: "Gemini", color: "#3b82f6" },
  { id: "aider", name: "Aider", color: "#22c55e" },
  { id: "opencode", name: "OpenCode", color: "#06b6d4" },
];

export const PERSONALITY_PRESETS = [
  { label: "Friendly & Casual", value: "You speak in a friendly, casual, encouraging, and natural tone." },
  { label: "Professional & Concise", value: "You speak formally, professionally, in an organized and concise manner." },
  { label: "Aggressive & Fast", value: "You are aggressive, action-first, always pursuing speed and efficiency." },
  { label: "Patient Mentor", value: "You teach patiently, explain the reasoning, and guide like a mentor." },
];

export const AGENCY_CATALOG: AgencyCatalogCategory[] = [
  { category: "academic", label: "Academic", subcategories: [
    { name: "_root", label: "Academic", agents: [
      { name: "Anthropologist", desc: "Expert in cultural systems, rituals, kinship, belief systems, and ethnographic method" },
      { name: "Geographer", desc: "Expert in physical and human geography, climate systems, cartography, and spatial analysis" },
      { name: "Historian", desc: "Expert in historical analysis, periodization, material culture, and historiography" },
      { name: "Narratologist", desc: "Expert in narrative theory, story structure, character arcs, and literary analysis" },
      { name: "Psychologist", desc: "Expert in human behavior, personality theory, motivation, and cognitive patterns" },
    ]},
  ]},
  { category: "design", label: "Design", subcategories: [
    { name: "_root", label: "Design", agents: [
      { name: "Brand Guardian", desc: "Expert brand strategist specializing in brand identity development, consistency" },
      { name: "Image Prompt Engineer", desc: "Expert photography prompt engineer for crafting detailed AI image generation prompts" },
      { name: "Inclusive Visuals Specialist", desc: "Representation expert defeating systemic AI biases for culturally accurate visuals" },
      { name: "UI Designer", desc: "Expert UI designer specializing in visual design systems, component libraries" },
      { name: "UX Architect", desc: "Technical architecture and UX specialist providing developers with solid foundations" },
      { name: "UX Researcher", desc: "Expert user experience researcher in user behavior analysis, usability testing" },
      { name: "Visual Storyteller", desc: "Expert visual communication specialist creating compelling visual narratives" },
      { name: "Whimsy Injector", desc: "Expert creative specialist adding personality, delight, and playful elements to brands" },
    ]},
  ]},
  { category: "engineering", label: "Engineering", subcategories: [
    { name: "_root", label: "Engineering", agents: [
      { name: "AI Data Remediation Engineer", desc: "Specialist in self-healing data pipelines using air-gapped local SLMs and semantic clustering" },
      { name: "AI Engineer", desc: "Expert AI/ML engineer in machine learning model development, deployment, integration" },
      { name: "Autonomous Optimization Architect", desc: "Intelligent system governor that shadow-tests APIs for performance optimization" },
      { name: "Backend Architect", desc: "Senior backend architect in scalable system design, database architecture, APIs" },
      { name: "Data Engineer", desc: "Expert data engineer building reliable data pipelines, lakehouse architectures" },
      { name: "Database Optimizer", desc: "Expert database specialist in schema design, query optimization, indexing strategies" },
      { name: "DevOps Automator", desc: "Expert DevOps engineer in infrastructure automation, CI/CD pipeline development" },
      { name: "Embedded Firmware Engineer", desc: "Specialist in bare-metal and RTOS firmware - ESP32/ESP-IDF, PlatformIO, Arduino, ARM" },
      { name: "Feishu Integration Developer", desc: "Full-stack integration expert for the Feishu (Lark) Open Platform" },
      { name: "Frontend Developer", desc: "Expert frontend developer in modern web technologies, React/Vue/Angular frameworks" },
      { name: "Git Workflow Master", desc: "Expert in Git workflows, branching strategies, and version control best practices" },
      { name: "Incident Response Commander", desc: "Expert incident commander in production incident management, structured response" },
      { name: "Mobile App Builder", desc: "Specialized mobile app developer with native iOS/Android and cross-platform expertise" },
      { name: "Rapid Prototyper", desc: "Specialized in ultra-fast proof-of-concept development and MVP creation" },
      { name: "Security Engineer", desc: "Expert application security engineer in threat modeling, vulnerability assessment" },
      { name: "Senior Developer", desc: "Premium implementation specialist - Laravel/Livewire/FluxUI, advanced CSS, Three.js" },
      { name: "Software Architect", desc: "Expert software architect in system design, domain-driven design, architectural patterns" },
      { name: "Solidity Smart Contract Engineer", desc: "Expert Solidity developer in EVM smart contract architecture, gas optimization" },
      { name: "SRE (Site Reliability Engineer)", desc: "Expert site reliability engineer in SLOs, error budgets, observability, chaos engineering" },
      { name: "Technical Writer", desc: "Expert technical writer in developer documentation, API references, README files" },
      { name: "Threat Detection Engineer", desc: "Expert detection engineer in SIEM rule development, MITRE ATT&CK coverage mapping" },
      { name: "WeChat Mini Program Developer", desc: "Expert WeChat Mini Program developer in WXML/WXSS/WXS, WeChat API integration" },
    ]},
  ]},
  { category: "game-development", label: "Game Dev", subcategories: [
    { name: "_root", label: "Cross-Engine", agents: [
      { name: "Game Audio Engineer", desc: "Interactive audio specialist - FMOD/Wwise integration, adaptive music, spatial audio" },
      { name: "Game Designer", desc: "Systems and mechanics architect - GDD authorship, player psychology, economy balancing" },
      { name: "Level Designer", desc: "Spatial storytelling and flow specialist - layout theory, pacing, encounter design" },
      { name: "Narrative Designer", desc: "Story systems and dialogue architect - branching dialogue, lore, environmental storytelling" },
      { name: "Technical Artist", desc: "Art-to-engine pipeline specialist - shaders, VFX systems, LOD pipelines, performance" },
    ]},
    { name: "blender", label: "Blender", agents: [
      { name: "Blender Add-on Engineer", desc: "Blender tooling specialist - Python add-ons, asset validators, exporters, pipeline automation" },
    ]},
    { name: "godot", label: "Godot", agents: [
      { name: "Godot Gameplay Scripter", desc: "Composition and signal integrity specialist - GDScript 2.0, C# integration, node-based arch" },
      { name: "Godot Multiplayer Engineer", desc: "Godot 4 networking specialist - MultiplayerAPI, scene replication, ENet/WebRTC transport" },
      { name: "Godot Shader Developer", desc: "Godot 4 visual effects specialist - Godot Shading Language (GLSL-like), VisualShader editor" },
    ]},
    { name: "roblox-studio", label: "Roblox Studio", agents: [
      { name: "Roblox Avatar Creator", desc: "Roblox UGC and avatar pipeline specialist - avatar system, UGC item creation, accessories" },
      { name: "Roblox Experience Designer", desc: "Roblox platform UX and monetization specialist - engagement loops, DataStore-driven progress" },
      { name: "Roblox Systems Scripter", desc: "Roblox platform engineering specialist - Luau, client-server security, RemoteEvents" },
    ]},
    { name: "unity", label: "Unity", agents: [
      { name: "Unity Architect", desc: "Data-driven modularity specialist - ScriptableObjects, decoupled systems, clean architecture" },
      { name: "Unity Editor Tool Developer", desc: "Unity editor automation specialist - custom EditorWindows, PropertyDrawers, AssetPostprocess" },
      { name: "Unity Multiplayer Engineer", desc: "Networked gameplay specialist - Netcode for GameObjects, Unity Gaming Services (Relay/Lobby)" },
      { name: "Unity Shader Graph Artist", desc: "Visual effects and material specialist - Unity Shader Graph, HLSL, URP/HDRP rendering" },
    ]},
    { name: "unreal-engine", label: "Unreal Engine", agents: [
      { name: "Unreal Multiplayer Architect", desc: "Unreal Engine networking specialist - Actor replication, GameMode/GameState architecture" },
      { name: "Unreal Systems Engineer", desc: "Performance and hybrid architecture specialist - C++/Blueprint continuum, Nanite, Lumen" },
      { name: "Unreal Technical Artist", desc: "Unreal Engine visual pipeline specialist - Material Editor, Niagara VFX, Procedural Content" },
      { name: "Unreal World Builder", desc: "Open-world and environment specialist - UE5 World Partition, Landscape, procedural foliage" },
    ]},
  ]},
  { category: "marketing", label: "Marketing", subcategories: [
    { name: "_root", label: "Marketing", agents: [
      { name: "AI Citation Strategist", desc: "Expert in AI recommendation engine optimization (AEO/GEO) — audits brand visibility" },
      { name: "App Store Optimizer", desc: "Expert app store marketing specialist focused on ASO, conversion rate optimization" },
      { name: "Baidu SEO Specialist", desc: "Expert Baidu search optimization specialist for Chinese search engine ranking" },
      { name: "Bilibili Content Strategist", desc: "Expert Bilibili marketing specialist focused on UP主 growth, danmaku culture mastery" },
      { name: "Book Co-Author", desc: "Strategic thought-leadership book collaborator for founders, experts, and operators" },
      { name: "Carousel Growth Engine", desc: "Autonomous TikTok and Instagram carousel generation specialist via URL analysis" },
      { name: "China E-Commerce Operator", desc: "Expert China e-commerce specialist covering Taobao, Tmall, Pinduoduo, JD ecosystems" },
      { name: "Content Creator", desc: "Expert content strategist and creator for multi-platform campaigns, editorial calendars" },
      { name: "Cross-Border E-Commerce Specialist", desc: "Full-funnel cross-border e-commerce strategist covering Amazon, Shopee, Lazada, AliExpress" },
      { name: "Douyin Strategist", desc: "Short-video marketing expert specializing in the Douyin platform, recommendation algo" },
      { name: "Growth Hacker", desc: "Expert growth strategist in rapid user acquisition through data-driven experimentation" },
      { name: "Instagram Curator", desc: "Expert Instagram marketing specialist in visual storytelling, community building" },
      { name: "Kuaishou Strategist", desc: "Expert Kuaishou marketing strategist for short-video content in China's lower-tier cities" },
      { name: "LinkedIn Content Creator", desc: "Expert LinkedIn content strategist focused on thought leadership, personal brand building" },
      { name: "Livestream Commerce Coach", desc: "Veteran livestream e-commerce coach specializing in host training, live room operations" },
      { name: "Podcast Strategist", desc: "Content strategy and operations expert for the Chinese podcast market" },
      { name: "Private Domain Operator", desc: "Expert in building enterprise WeChat (WeCom) private domain ecosystems, SCRM" },
      { name: "Reddit Community Builder", desc: "Expert Reddit marketing specialist in authentic community engagement, value-driven content" },
      { name: "SEO Specialist", desc: "Expert search engine optimization strategist in technical SEO, content optimization" },
      { name: "Short-Video Editing Coach", desc: "Hands-on short-video editing coach covering full post-production pipeline, CapCut mastery" },
      { name: "Social Media Strategist", desc: "Expert social media strategist for LinkedIn, Twitter, and professional platforms" },
      { name: "TikTok Strategist", desc: "Expert TikTok marketing specialist in viral content creation, algorithm optimization" },
      { name: "Twitter Engager", desc: "Expert Twitter marketing specialist in real-time engagement, thought leadership" },
      { name: "WeChat Official Account Manager", desc: "Expert WeChat Official Account strategist in content marketing, subscriber engagement" },
      { name: "Weibo Strategist", desc: "Full-spectrum operations expert for Sina Weibo, trending topic mechanics, SuperFans" },
      { name: "Xiaohongshu Specialist", desc: "Expert Xiaohongshu marketing specialist in lifestyle content, trend-driven strategies" },
      { name: "Zhihu Strategist", desc: "Expert Zhihu marketing specialist in thought leadership, community credibility" },
    ]},
  ]},
  { category: "paid-media", label: "Paid Media", subcategories: [
    { name: "_root", label: "Paid Media", agents: [
      { name: "Paid Media Auditor", desc: "Comprehensive paid media auditor evaluating Google Ads, Microsoft Ads, Meta accounts" },
      { name: "Ad Creative Strategist", desc: "Paid media creative specialist in ad copywriting, RSA optimization, asset group design" },
      { name: "Paid Social Strategist", desc: "Cross-platform paid social advertising specialist covering Meta, LinkedIn, TikTok" },
      { name: "PPC Campaign Strategist", desc: "Senior paid media strategist in large-scale search, shopping, and performance max campaigns" },
      { name: "Programmatic & Display Buyer", desc: "Display advertising and programmatic media buying specialist covering managed placements" },
      { name: "Search Query Analyst", desc: "Specialist in search term analysis, negative keyword architecture, query-to-intent mapping" },
      { name: "Tracking & Measurement Specialist", desc: "Expert in conversion tracking architecture, tag management, attribution modeling" },
    ]},
  ]},
  { category: "product", label: "Product", subcategories: [
    { name: "_root", label: "Product", agents: [
      { name: "Behavioral Nudge Engine", desc: "Behavioral psychology specialist adapting software interaction cadences for user engagement" },
      { name: "Feedback Synthesizer", desc: "Expert in collecting, analyzing, and synthesizing user feedback from multiple channels" },
      { name: "Product Manager", desc: "Holistic product leader owning full product lifecycle — discovery through go-to-market" },
      { name: "Sprint Prioritizer", desc: "Expert product manager in agile sprint planning, feature prioritization, resource allocation" },
      { name: "Trend Researcher", desc: "Expert market intelligence analyst in emerging trends, competitive analysis" },
    ]},
  ]},
  { category: "project-management", label: "Project Mgmt", subcategories: [
    { name: "_root", label: "Project Mgmt", agents: [
      { name: "Experiment Tracker", desc: "Expert project manager in experiment design, execution tracking, data-driven decisions" },
      { name: "Jira Workflow Steward", desc: "Expert delivery operations specialist enforcing Jira-linked Git workflows, traceable commits" },
      { name: "Project Shepherd", desc: "Expert project manager in cross-functional project coordination, timeline management" },
      { name: "Studio Operations", desc: "Expert operations manager in day-to-day studio efficiency, process optimization" },
      { name: "Studio Producer", desc: "Senior strategic leader in high-level creative and technical project orchestration" },
      { name: "Senior Project Manager", desc: "Converts specs to tasks, remembers previous projects. Focused on realistic scope" },
    ]},
  ]},
  { category: "sales", label: "Sales", subcategories: [
    { name: "_root", label: "Sales", agents: [
      { name: "Account Strategist", desc: "Expert post-sale account strategist in land-and-expand execution, stakeholder mapping" },
      { name: "Sales Coach", desc: "Expert sales coaching specialist in rep development, pipeline review, call coaching" },
      { name: "Deal Strategist", desc: "Senior deal strategist in MEDDPICC qualification, competitive positioning, win planning" },
      { name: "Discovery Coach", desc: "Coaches sales teams on elite discovery methodology — question design, gap quantification" },
      { name: "Sales Engineer", desc: "Senior pre-sales engineer in technical discovery, demo engineering, POC scoping" },
      { name: "Outbound Strategist", desc: "Signal-based outbound specialist designing multi-channel prospecting sequences, ICP" },
      { name: "Pipeline Analyst", desc: "Revenue operations analyst in pipeline health diagnostics, deal velocity analysis" },
      { name: "Proposal Strategist", desc: "Strategic proposal architect transforming RFPs into compelling win narratives" },
    ]},
  ]},
  { category: "spatial-computing", label: "Spatial Computing", subcategories: [
    { name: "_root", label: "Spatial Computing", agents: [
      { name: "macOS Spatial/Metal Engineer", desc: "Native Swift and Metal specialist building high-performance 3D rendering systems" },
      { name: "Terminal Integration Specialist", desc: "Terminal emulation, text rendering optimization, SwiftTerm integration for modern Swift" },
      { name: "visionOS Spatial Engineer", desc: "Native visionOS spatial computing, SwiftUI volumetric interfaces, Liquid Glass design" },
      { name: "XR Cockpit Interaction Specialist", desc: "Specialist in designing immersive cockpit-based control systems for XR environments" },
      { name: "XR Immersive Developer", desc: "Expert WebXR and immersive technology developer in browser-based AR/VR/XR applications" },
      { name: "XR Interface Architect", desc: "Spatial interaction designer and interface strategist for immersive AR/VR/XR environments" },
    ]},
  ]},
  { category: "specialized", label: "Specialized", subcategories: [
    { name: "_root", label: "Specialized", agents: [
      { name: "Accounts Payable Agent", desc: "Autonomous payment processing specialist executing vendor payments, contractor invoices" },
      { name: "Agentic Identity & Trust Architect", desc: "Designs identity, authentication, and trust verification systems for autonomous AI agents" },
      { name: "Agents Orchestrator", desc: "Autonomous pipeline manager orchestrating the entire development workflow" },
      { name: "Automation Governance Architect", desc: "Governance-first architect for business automations (n8n-first) auditing value and risk" },
      { name: "Blockchain Security Auditor", desc: "Expert smart contract security auditor in vulnerability detection, formal verification" },
      { name: "Compliance Auditor", desc: "Expert technical compliance auditor in SOC 2, ISO 27001, HIPAA, PCI-DSS audits" },
      { name: "Corporate Training Designer", desc: "Expert in enterprise training system design and curriculum development" },
      { name: "Cultural Intelligence Strategist", desc: "CQ specialist detecting invisible exclusion, researching global context for inclusive software" },
      { name: "Data Consolidation Agent", desc: "AI agent consolidating extracted sales data into live reporting dashboards" },
      { name: "Developer Advocate", desc: "Expert developer advocate building developer communities, creating technical content" },
      { name: "Document Generator", desc: "Expert document creation specialist generating professional PDF, PPTX, DOCX, XLSX files" },
      { name: "French Consulting Market Navigator", desc: "Navigate the French ESN/SI freelance ecosystem — margin models, platform mechanics" },
      { name: "Government Digital Presales Consultant", desc: "Presales expert for China's government digital transformation market (ToG)" },
      { name: "Healthcare Marketing Compliance Specialist", desc: "Expert in healthcare marketing compliance in China, Advertising Law, Medical Advertising" },
      { name: "Identity Graph Operator", desc: "Operates a shared identity graph that multiple AI agents resolve against" },
      { name: "Korean Business Navigator", desc: "Korean business culture for foreign professionals — decision process, nunchi reading" },
      { name: "LSP/Index Engineer", desc: "Language Server Protocol specialist building unified code intelligence systems" },
      { name: "MCP Builder", desc: "Expert Model Context Protocol developer who designs, builds, and tests MCP servers" },
      { name: "Model QA Specialist", desc: "Independent model QA expert auditing ML and statistical models end-to-end" },
      { name: "Recruitment Specialist", desc: "Expert recruitment operations and talent acquisition specialist" },
      { name: "Report Distribution Agent", desc: "AI agent automating distribution of consolidated sales reports to representatives" },
      { name: "Sales Data Extraction Agent", desc: "AI agent specialized in monitoring Excel files and extracting key sales metrics" },
      { name: "Salesforce Architect", desc: "Solution architecture for Salesforce platform — multi-cloud design, integration patterns" },
      { name: "Study Abroad Advisor", desc: "Full-spectrum study abroad planning expert covering US, UK, Canada, Australia, Europe" },
      { name: "Supply Chain Strategist", desc: "Expert supply chain management and procurement strategy specialist" },
      { name: "Workflow Architect", desc: "Workflow design specialist mapping complete workflow trees for every system and journey" },
      { name: "ZK Steward", desc: "Knowledge-base steward in the spirit of Niklas Luhmann's Zettelkasten" },
    ]},
  ]},
  { category: "support", label: "Support & Ops", subcategories: [
    { name: "_root", label: "Support & Ops", agents: [
      { name: "Analytics Reporter", desc: "Expert data analyst transforming raw data into actionable business insights, dashboards" },
      { name: "Executive Summary Generator", desc: "Consultant-grade AI specialist communicating like a senior strategy consultant" },
      { name: "Finance Tracker", desc: "Expert financial analyst in financial planning, budget management, cash flow optimization" },
      { name: "Infrastructure Maintainer", desc: "Expert infrastructure specialist in system reliability, performance optimization" },
      { name: "Legal Compliance Checker", desc: "Expert legal and compliance specialist ensuring business operations meet regulations" },
      { name: "Support Responder", desc: "Expert customer support specialist delivering exceptional service, issue resolution" },
    ]},
  ]},
  { category: "testing", label: "Testing & QA", subcategories: [
    { name: "_root", label: "Testing & QA", agents: [
      { name: "Accessibility Auditor", desc: "Expert accessibility specialist auditing interfaces against WCAG standards" },
      { name: "API Tester", desc: "Expert API testing specialist in comprehensive API validation, performance testing" },
      { name: "Evidence Collector", desc: "Screenshot-obsessed, fantasy-allergic QA specialist - finds 3-5 issues, requires visual proof" },
      { name: "Performance Benchmarker", desc: "Expert performance testing specialist in measuring, analyzing, and improving systems" },
      { name: "Reality Checker", desc: "Stops fantasy approvals, evidence-based certification - defaults to NEEDS WORK" },
      { name: "Test Results Analyzer", desc: "Expert test analysis specialist in comprehensive test result evaluation, quality metrics" },
      { name: "Tool Evaluator", desc: "Expert technology assessment specialist evaluating, testing, and recommending tools" },
      { name: "Workflow Optimizer", desc: "Expert process improvement specialist analyzing, optimizing, and automating workflows" },
    ]},
  ]},
];

/** Flat lookup: agent name -> description */
export const AGENCY_AGENT_MAP = new Map<string, string>();
for (const cat of AGENCY_CATALOG) {
  for (const sub of cat.subcategories) {
    for (const a of sub.agents) {
      AGENCY_AGENT_MAP.set(a.name, a.desc);
    }
  }
}

/** Legacy compatibility: flat list of all role names */
export const ROLE_PRESETS = AGENCY_CATALOG.flatMap((c) => c.subcategories.flatMap((s) => s.agents.map((a) => a.name)));

/** Skills are now derived from the agent description keywords */
export const SKILLS_MAP: Record<string, string[]> = {};
for (const cat of AGENCY_CATALOG) {
  for (const sub of cat.subcategories) {
    for (const a of sub.agents) {
      SKILLS_MAP[a.name] = a.desc.split(/[,/]/).map((s) => s.trim()).filter((s) => s.length > 2 && s.length < 30).slice(0, 8);
    }
  }
}
