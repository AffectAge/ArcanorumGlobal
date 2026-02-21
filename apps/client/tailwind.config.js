/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arc: {
          bg: "#030405",
          panel: "#06080c",
          soft: "#0b0e13",
          accent: "#4ade80",
          muted: "#8b94a3",
        },
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(74,222,128,.45), 0 0 30px rgba(74,222,128,.22)",
      },
      fontFamily: {
        display: ["'Rajdhani'", "sans-serif"],
        body: ["'Manrope'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
