/**
 * Config do Tailwind para a build offline do CSS (ver package.json / README).
 * Mantém os mesmos tokens do tema; `assets/js/theme.js` não é mais usado em produção.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
    content: ['./index.html', './assets/js/**/*.js'],
    theme: {
        extend: {
            colors: {
                'cartucho-dark': '#0a0a0c',
                'cartucho-sidebar': '#0f0f18',
                'cartucho-primary': '#4f46e5',
                'cartucho-accent': '#7c3aed',
                'cartucho-zinc': '#18181b',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                retro: ['Silkscreen', 'cursive'],
                orbitron: ['Orbitron', 'sans-serif'],
            },
            backgroundImage: {
                'gradient-border': 'linear-gradient(to bottom right, rgba(255,255,255,0.2), rgba(255,255,255,0.05))',
                'neon-glow': 'radial-gradient(circle at center, rgba(79, 70, 229, 0.15) 0%, transparent 70%)',
            },
            boxShadow: {
                neon: '0 0 20px rgba(79, 70, 229, 0.4)',
                'neon-glow': '0 0 40px rgba(79, 70, 229, 0.2)',
            },
            aspectRatio: {
                '4/3': '4 / 3',
            },
        },
    },
    plugins: [],
};
