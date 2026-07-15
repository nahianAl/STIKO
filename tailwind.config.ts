import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        stiko: {
          app: "#F6F8FE",
          surface: "#FFFFFF",
          subtle: "#F6F8FE",
          tint: "#F1F3FF",
          idle: "#EFEFF4",
          ink: "#1C2030",
          secondary: "#5A6076",
          muted: "#8A90A6",
          faint: "#A2A7B8",
          placeholder: "#C2C4CE",
          primary: "#5B60FF",
          border: "#F1F1F4",
          divider: "#E4E5EC",
          sheet: "#EAEDF6",
        },
      },
      fontFamily: {
        manrope: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        panel: "14px",
      },
      boxShadow: {
        "stiko-panel": "0 1px 3px rgba(28,32,48,0.05)",
        "stiko-primary": "0 6px 16px -5px rgba(91,96,255,0.6)",
        "stiko-sheet": "0 10px 34px -12px rgba(28,32,48,0.16)",
        "stiko-pin": "0 4px 10px -2px rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
};
export default config;
