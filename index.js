const express = require('express');
const app = express();
const path = require('path');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.use('/src/EmulatorJS', express.static(path.join(__dirname, 'src/EmulatorJS')));
app.use('/node_modules/flyonui', express.static(path.join(__dirname, 'node_modules/flyonui')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));


app.get('/', (req, res) => {
    const data = { };
    res.render('index', data);
});

app.get('/how-its-works', (req, res) => {
    res.render('how-its-works');
});

app.get('/play', (req, res) => {
    const { platform, cid } = req.query;
    const data = { platform: platform, cid: cid};
    res.render('play', data);
});

const port = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta: ${PORT}`);
});
