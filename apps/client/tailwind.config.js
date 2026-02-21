/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arc: {
          bg: "#07090c",
          panel: "#0d1117",
          soft: "#131922",
          accent: "#22c55e",
          muted: "#8b94a3",
        },
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(34,197,94,.45), 0 0 30px rgba(34,197,94,.2)",
      },
      fontFamily: {
        display: ["'Rajdhani'", "sans-serif"],
        body: ["'Manrope'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
