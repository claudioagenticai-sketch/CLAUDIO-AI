import type { Config } from "tailwindcss";

/** Theme colors are CSS variables; this lets opacity modifiers (`bg-brand/20`, `ring-line/50`) work via color-mix. */
const v = (name: string) =>
  (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue === "1"
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`) as unknown as string;

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      screens: {
        xs: "420px",
        "3xl": "1800px",
      },
      // v3 editorial: square-ish everywhere. The larger steps are capped so older `rounded-xl/2xl/3xl` call sites
      // read as hairline sections instead of soft cards.
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "var(--radius)",
        xl: "4px",
        "2xl": "6px",
        "3xl": "8px",
      },
      colors: {
        // Claudio tokens (CSS variables in client/src/index.css)
        bg: { DEFAULT: v("--bg"), elev: v("--bg-elev") },
        panel: { DEFAULT: v("--panel"), 2: v("--panel-2"), 3: v("--panel-3") },
        line: { DEFAULT: v("--line"), 2: v("--line-2") },
        text: { DEFAULT: v("--text"), 2: v("--text-2"), 3: v("--text-3") },
        buy: { DEFAULT: v("--buy"), bg: v("--buy-bg"), ink: v("--buy-ink") },
        sell: { DEFAULT: v("--sell"), bg: v("--sell-bg"), ink: v("--sell-ink") },
        warn: { DEFAULT: v("--warn"), bg: v("--warn-bg") },
        info: { DEFAULT: v("--info"), bg: v("--info-bg") },
        gold: { DEFAULT: v("--gold"), bg: v("--gold-bg") },
        brand: { DEFAULT: v("--brand"), 2: v("--brand-2"), ink: v("--brand-ink"), bg: v("--brand-bg"), fill: v("--brand-fill") },
        copper: { DEFAULT: v("--copper"), bg: v("--copper-bg") },
        chrome: v("--chrome"),
        // shadcn compat
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        serif: ["var(--font-serif)"],
        display: ["var(--font-display)"],
      },
      height: {
        topbar: "var(--topbar-h)",
        statusbar: "var(--statusbar-h)",
        tabbar: "var(--tabbar-h)",
      },
      width: {
        rail: "var(--rail-w)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
