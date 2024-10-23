// script/build-html.js
const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

const templatesDir = path.join(__dirname, '../src/views');
const outputDir = path.join(__dirname, '../public');

const pages = ['index', 'play', 'how-its-works'];

pages.forEach(page => {
  const templatePath = path.join(templatesDir, `${page}.ejs`);
  const outputPath = path.join(outputDir, `${page}.html`);
  
  ejs.renderFile(templatePath, {}, (err, html) => {
    if (err) {
      console.error(`Erro ao renderizar ${page}:`, err);
      return;
    }
    
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`Arquivo ${page}.html gerado em ${outputPath}`);
  });
});
