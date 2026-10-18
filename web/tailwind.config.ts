import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#e4be35",
          hover: "#d5ae24",
          soft: "#faf1cf",
        },
        ink: {
          DEFAULT: "#34342d",
          muted: "#6b6b60",
        },
        canvas: "#f7f5ef",
        surface: "#fffefa",
        line: "#e5e2d7",
      },
    },
  },
  plugins: [],
} satisfies Config;
