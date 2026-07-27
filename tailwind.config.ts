import type { Config } from "tailwindcss";

// Every value here comes from stiko_handoff/02-design-system.md, which is exact
// and final. Keep this file as the single place those numbers live.
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
          // Surfaces
          app: "#F6F8FE",
          surface: "#FFFFFF",
          subtle: "#F6F8FE",
          tint: "#F1F3FF",
          idle: "#EFEFF4",

          // Text
          ink: "#1C2030",
          secondary: "#5A6076",
          muted: "#8A90A6",
          faint: "#A2A7B8",
          placeholder: "#C2C4CE",
          ghost: "#C2C4CE",

          // Primary
          primary: "#5B60FF",
          "primary-hover": "#4247d6",
          "primary-light": "#8094F5",

          // Borders
          border: "#F1F1F4",
          divider: "#E4E5EC",
          sheet: "#EAEDF6",
          "border-strong": "#D3D8E6",
          dashed: "#C6CDE8",
          crumb: "#C9CBD6",

          // Status-chip borders
          "chip-amber": "#EAD68A",
          "chip-red": "#F6B8C2",
          "chip-green": "#B9DC96",
          "chip-grey": "#DDDFE8",

          // Matrix "no access" em-dash
          "no-access": "#D8DCE8",
        },

        // The five sticky notes. Each pastel pairs with a dark text colour and
        // a saturated accent used for left-borders and pin outlines.
        note: {
          yellow: "#FFFCCE",
          "yellow-text": "#7A5E00",
          "yellow-accent": "#FFCF2E",
          red: "#FFE2E2",
          "red-text": "#B23A52",
          "red-accent": "#FF6B6B",
          blue: "#E2F2FF",
          "blue-text": "#2f7fc4",
          "blue-accent": "#4A9FE0",
          green: "#EDFFDA",
          "green-text": "#4B7A28",
          "green-accent": "#7BC24A",
          purple: "#EBE4FD",
          "purple-text": "#6b4fc4",
        },
      },
      fontFamily: {
        manrope: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        shell: "18px",
        panel: "14px",
        sheet: "16px",
        chip: "6px",
        pill: "20px",
        badge: "9px",
        inset: "12px",
      },
      boxShadow: {
        "stiko-panel": "0 1px 3px rgba(28,32,48,0.05)",
        "stiko-primary": "0 6px 16px -5px rgba(91,96,255,0.6)",
        "stiko-sheet": "0 10px 34px -12px rgba(28,32,48,0.16)",
        "stiko-pin": "0 4px 10px -2px rgba(0,0,0,0.2)",
        "stiko-popover": "0 16px 44px -12px rgba(28,32,48,0.35)",
        "stiko-modal": "0 20px 50px -14px rgba(28,32,48,0.4)",
        "stiko-drawer": "-12px 0 40px -12px rgba(28,32,48,0.3)",
        "stiko-palette": "0 24px 60px -16px rgba(28,32,48,0.45)",
        "stiko-note": "0 8px 20px -6px rgba(28,32,48,0.22)",
        "stiko-tab": "0 1px 3px rgba(28,32,48,0.08)",
        "stiko-focus": "0 0 0 3px rgba(91,96,255,0.12)",
      },
      backgroundImage: {
        "stiko-primary": "linear-gradient(135deg, #8094F5, #5B60FF)",
        // Canvas backdrop behind the document sheet.
        "stiko-hatch":
          "repeating-linear-gradient(45deg, #F6F8FE 0 16px, #FBFCFF 16px 32px)",
      },
      letterSpacing: {
        title: "-0.02em",
        heading: "-0.01em",
        label: "0.1em",
      },
    },
  },
  plugins: [],
};
export default config;
