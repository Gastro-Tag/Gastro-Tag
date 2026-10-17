/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f05a28', // GastroTag Orange
          600: '#ea580c', // Primary Accent
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },
        charcoal: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e232a', // Logo Chef Hat Charcoal
          900: '#11161e',
          950: '#0a0d12',
        },
        danger: { DEFAULT: '#ef4444', light: '#fef2f2' },
        warn:   { DEFAULT: '#f59e0b', light: '#fffbeb' },
        success:{ DEFAULT: '#10b981', light: '#ecfdf5' },
      },
      borderRadius: {
        '2xl': '16px',
        xl: '12px',
        lg: '10px',
        md: '8px',
        sm: '6px',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 6px 16px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -2px rgba(0, 0, 0, 0.04)',
        'card-lg': '0 12px 28px -4px rgba(0, 0, 0, 0.09), 0 4px 10px -3px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};
