/** @type {import('tailwindcss').Config} */
import { moduleColors } from './module.colors.js'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Palettes sémantiques par module — valeurs définies dans module.colors.js
        ...Object.fromEntries(
          Object.entries(moduleColors).map(([key, palette]) => [`module-${key}`, palette])
        ),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

