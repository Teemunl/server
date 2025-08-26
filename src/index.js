const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fileRoutes = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Middleware-konfiguraatio
 * Käsittelee JSON- ja URL-encoded dataa sekä tiedostolatauksia
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Näyttömoottorin konfiguraatio
 * Asettaa EJS:n näyttömoottoriksi ja määrittää views-kansion sijainnin
 */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

/**
 * Reittien konfiguraatio
 * Käyttää tiedostojen hallintareittejä juuripolulla
 */
app.get('/', (req, res) => {
  res.render('index'); // Renders views/index.ejs
});
/**
 * Palvelimen käynnistys
 * Kuuntelee määriteltyä porttia ja tulostaa viestin kun palvelin on valmis
 */
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
