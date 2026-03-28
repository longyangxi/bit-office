// Project Templates — data only, no React dependencies.

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  suggestedPrompt: string;
  suggestedMode: "solo" | "team";
  suggestedRoles: string[];
  tags: string[];
}

export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  {
    id: "landing-page",
    name: "Landing Page",
    description: "Single-page marketing or portfolio site",
    icon: "globe",
    suggestedPrompt:
      "Build a portfolio landing page with hero section, 3 project cards, and contact form",
    suggestedMode: "team",
    suggestedRoles: ["Developer", "Code Reviewer"],
    tags: ["frontend", "beginner"],
  },
  {
    id: "cli-tool",
    name: "CLI Tool",
    description: "Command-line utility with argument parsing",
    icon: "terminal",
    suggestedPrompt:
      "Build a CLI tool that converts CSV files to JSON with --input and --output flags",
    suggestedMode: "team",
    suggestedRoles: ["Developer", "Code Reviewer"],
    tags: ["backend", "beginner"],
  },
  {
    id: "rest-api",
    name: "REST API",
    description: "Express/Fastify API with CRUD endpoints",
    icon: "server",
    suggestedPrompt:
      "Build a REST API with /users CRUD endpoints, input validation, and error handling",
    suggestedMode: "team",
    suggestedRoles: ["Developer", "Code Reviewer"],
    tags: ["backend", "intermediate"],
  },
  {
    id: "chrome-extension",
    name: "Chrome Extension",
    description: "Browser extension with popup UI",
    icon: "puzzle",
    suggestedPrompt:
      "Build a Chrome extension that shows word count and reading time for any webpage",
    suggestedMode: "team",
    suggestedRoles: ["Developer", "Code Reviewer"],
    tags: ["frontend", "intermediate"],
  },
  {
    id: "static-blog",
    name: "Static Blog",
    description: "Markdown-based static site",
    icon: "file-text",
    suggestedPrompt:
      "Build a static blog with 3 sample posts, tag filtering, and dark mode toggle",
    suggestedMode: "solo",
    suggestedRoles: ["Developer"],
    tags: ["frontend", "beginner"],
  },
];
