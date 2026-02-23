/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#184B44',
        'primary-light': '#1f5c53',
        accent: '#e8b730',
        'accent-hover': '#d4a52a',
        surface: '#faf7f2',
        card: '#ffffff',
        border: '#e8e2d8',
      },
      fontFamily: {
        body: ['DM Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        heading: ['DM Serif Display', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
