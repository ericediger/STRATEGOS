import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette
        brand: {
          blue: '#4C7DF0',
          green: '#2DBE8C',
          magenta: '#C651C9',
          'dark-blue': '#1C2340',
          'dark-grey': '#3B3F4A',
          'blue-hover': '#3A69D8',
          'magenta-hover': '#A93FAC',
        },

        // Surface layer — deep indigo-slate foundation
        surface: {
          DEFAULT: '#0E1220',           // deepest background
          raised: '#161B2E',            // cards, panels, headers
          overlay: '#131827',           // hover overlays
          border: '#2A3352',            // visible borders
          'border-subtle': '#1F2740',   // subtle dividers
        },

        // Text hierarchy — high contrast on dark surfaces
        text: {
          DEFAULT: '#D9DEEA',           // body text
          muted: '#98A2BC',             // secondary text
          subtle: '#66708C',            // tertiary/disabled
          heading: '#F3F5FA',           // headings, emphasis
          inverted: '#0E1220',          // text on light backgrounds
        },

        // Status — mapped to brand colors
        status: {
          // Complete — Green (#2DBE8C)
          'complete-bg': '#123528',
          'complete-fg': '#2DBE8C',

          // Running — Blue (#4C7DF0)
          'running-bg': '#17254A',
          'running-fg': '#4C7DF0',
          'running-border': '#2A4590',

          // Attention — Magenta (#C651C9)
          'attention-bg': '#3A1A3D',
          'attention-fg': '#C651C9',
          'attention-surface': '#2A1330',
          'attention-border': '#5A2760',

          // Blocked — warm red
          'blocked-bg': '#3D1515',
          'blocked-fg': '#F08080',
          'blocked-surface': '#2D1010',
          'blocked-border': '#5C2020',

          // Pending / Paused
          'pending-border': '#3B3F4A',
          'paused-bg': '#3B3F4A',
          'paused-fg': '#98A2BC',
        },

        // Interactive — Blue (#4C7DF0) tinted
        interactive: {
          DEFAULT: '#22315E',           // button bg, user bubbles
          hover: '#2B3D73',             // hover state
          border: '#4C7DF0',            // focus rings, active borders
        },
      },

      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1' }],
        xs: ['0.6875rem', { lineHeight: '1.4' }],
        sm: ['0.75rem', { lineHeight: '1.5' }],
        base: ['0.8125rem', { lineHeight: '1.5' }],
        md: ['0.875rem', { lineHeight: '1.5' }],
        lg: ['1rem', { lineHeight: '1.4' }],
        xl: ['1.125rem', { lineHeight: '1.3' }],
        '2xl': ['1.625rem', { lineHeight: '1.2' }],
        '3xl': ['1.875rem', { lineHeight: '1.2' }],
      },

      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '5px',
        lg: '6px',
      },

      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'pulse-slow': 'pulse 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.25s ease',
        'fade-in': 'fadeIn 0.2s ease',
      },

      keyframes: {
        slideIn: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
