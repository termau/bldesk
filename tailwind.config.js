/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware text colours, so dark mode keeps 4.5:1 contrast without a dark: variant on every use.
        fg: {
          muted: 'rgb(var(--fg-muted-rgb) / <alpha-value>)',
          link: 'rgb(var(--fg-link-rgb) / <alpha-value>)'
        },
        brand: {
          DEFAULT: '#017cb6',
          hover: '#016594',
          light: '#008fc5',
          gold: '#f1ca00',
          'gold-dark': '#d8aa00'
        },
        panel: {
          sidebar: '#343a40',
          'sidebar-hover': 'rgba(255, 255, 255, 0.08)',
          'sidebar-active': '#f1ca00',
          'sidebar-text': '#f8f9fa',
          'subnav-light': '#f1f1f1',
          'subnav-dark': '#2b3035',
          'page-light': '#f8f9fa',
          'page-dark': '#212529',
          'surface-light': '#ffffff',
          'surface-dark': '#2b3035',
          'border-light': '#ced4da',
          'border-dark': '#373b3e',
          'muted-light': '#6c757d',
          'muted-dark': '#adb5bd',
          'text-light': '#212529',
          'text-dark': '#f8f9fa'
        }
      }
    }
  },
  plugins: []
}
