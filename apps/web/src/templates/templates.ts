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
    id: "funny-game",
    name: "Funny Game",
    description: "A fun mini-game with animations and effects",
    icon: "gamepad",
    suggestedPrompt:
      "Build a funny browser game using HTML/CSS/JS and PixiJS. Include sprite animations, particle effects, simple physics, sound effects, and a score counter. Make it colorful, playful, and satisfying to interact with. Single index.html file.",
    suggestedMode: "solo",
    suggestedRoles: ["Developer"],
    tags: ["frontend", "creative"],
  },
  {
    id: "landing-page",
    name: "Landing Page",
    description: "Stunning marketing or portfolio site",
    icon: "globe",
    suggestedPrompt:
      "Build a visually stunning single-page portfolio site with smooth scroll animations, a hero section with gradient background, 3 project cards with hover effects, testimonials carousel, and a contact form. Use modern CSS (grid, backdrop-filter, transitions). Single index.html file.",
    suggestedMode: "solo",
    suggestedRoles: ["Developer"],
    tags: ["frontend", "beginner"],
  },
  {
    id: "static-blog",
    name: "Static Blog",
    description: "Beautiful blog with dark mode and tags",
    icon: "file-text",
    suggestedPrompt:
      "Build a beautiful static blog with 3 sample posts, tag filtering, dark/light mode toggle with smooth transition, reading time estimates, and elegant typography. Use CSS custom properties for theming. Single index.html file.",
    suggestedMode: "solo",
    suggestedRoles: ["Developer"],
    tags: ["frontend", "beginner"],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Data dashboard with charts and metrics",
    icon: "bar-chart",
    suggestedPrompt:
      "Build a sleek data dashboard with animated charts (bar, line, donut), live-updating metric cards, a dark theme, and responsive grid layout. Use Chart.js or pure SVG/Canvas for charts. Include mock data that looks realistic. Single index.html file.",
    suggestedMode: "solo",
    suggestedRoles: ["Developer"],
    tags: ["frontend", "intermediate"],
  },
];
