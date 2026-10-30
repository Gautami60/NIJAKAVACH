/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        nijakavach: {
          50: "#fbf8f2",
          100: "#f5eee1",
          500: "#ea580c", // Deep saffron
          600: "#c2410c",
          900: "#090d16", // Midnight obsidian
          950: "#04070d",
        }
      },
    },
  },
  plugins: [],
};
