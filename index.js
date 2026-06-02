const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ggenerowanie pliku .env jesli nie ma
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const pepper = crypto.randomBytes(32).toString('hex');
  const envContent = `PORT=3000\nSESSION_SECRET=${sessionSecret}\nPEPPER=${pepper}\n`;
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log('Utworzono nowy plik .env z losowo wygenerowanymi sekretami.');
}

//wczytywanie zmienncyh
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

const authRouter = require('./routes/auth');
const pokemonRouter = require('./routes/pokemon');

app.use('/', authRouter);
app.use('/', pokemonRouter);

app.listen(PORT, () => {
  console.log(`Gra na porcie: http://localhost:${PORT}`);
});
