import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#f0a35f",
          hover: "#f5b67c",
          soft: "#4a2f24",
        },
        ink: {
          DEFAULT: "#f7f1e8",
          muted: "#b9aa9c",
        },
        canvas: "#18120f",
        surface: "#211914",
        line: "#49382e",
      },
    },
  },
  plugins: [],
} satisfies Config;
