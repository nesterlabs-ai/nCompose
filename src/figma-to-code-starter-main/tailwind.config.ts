import type { Config } from "tailwindcss";

// TODO: Customize theme (colors, fonts, radius) to match your design system.
// With Tailwind v4 + @tailwindcss/vite, most config is in src/index.css; this file is for optional overrides.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
