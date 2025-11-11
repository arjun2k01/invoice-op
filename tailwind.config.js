/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: { extend: { boxShadow: { soft: '0 1px 2px rgba(0,0,0,.04)' } } },
  plugins: [],
};
