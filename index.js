const express = require('express');
const app = express();
const path = require('path');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.use('/emulator', express.static(path.join(__dirname, 'public/emulator')));
app.use('/flyonui', express.static(path.join(__dirname, 'public/flyonui')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));


app.get(['/', '/play.html', '/how-its-works.html'], (req, res) => {
    const page = req.path === '/' ? 'index.html' : req.path.slice(1);
    res.sendFile(path.join(__dirname, 'public', page));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Servidor rodando na porta: ${port}`);
});
