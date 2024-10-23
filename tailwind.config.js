/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/views/*.ejs', "./node_modules/flyonui/dist/js/*.js"],
  theme: {
    extend: {},
    },
  plugins: [
    require("flyonui"),
    require("flyonui/plugin"),
  {
    tailwindcss: {},
    autoprefixer: {},
  },
  ],
  };