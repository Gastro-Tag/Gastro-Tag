/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#edfaf3',
          100: '#d3f3e3',
          200: '#aae5cc',
          300: '#73d1af',
          400: '#3bb58e',
          500: '#1a9a75',
          600: '#0d7a5e',
          700: '#0d6b47',  // primary
          800: '#0b5438',
          900: '#094530',
          950: '#052a1e',
        },
        danger: { DEFAULT: '#dc2626', light: '#fef2f2' },
        warn:   { DEFAULT: '#d97706', light: '#fffbeb' },
      },
      borderRadius: {
        lg: '10px',
        md: '8px',
        sm: '6px',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04)',
        'card-lg': '0 8px 24px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.06)',
      },
    },
  },
  plugins: [],
};
