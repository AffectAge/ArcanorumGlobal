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
