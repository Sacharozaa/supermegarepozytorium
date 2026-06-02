const express = require('express');
const argon2 = require('argon2');
const db = require('../db');

const router = express.Router();

// Rejestracja
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null, success: null, usernameInput: '' });
});

router.post('/register', async (req, res) => {
  const { username, password, password2 } = req.body;

  if (!username || !password || !password2) {
    return res.render('register', { error: 'uzupelnij wsyztsko', success: null, usernameInput: username || '' });
  }

  if (password !== password2) {
    return res.render('register', { error: 'Hasla sie roznia', success: null, usernameInput: username });
  }

  try {
    const HASH_PARAMS = {
      secret: Buffer.from(process.env.PEPPER || '', 'hex'),
    };
    const hashedPassword = await argon2.hash(password, HASH_PARAMS);

    db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword],
      (err) => {
        if (err) {
          return res.render('register', { error: 'Ta nazwa użytkownika już istnieje!', success: null, usernameInput: username });
        }
        res.render('register', { error: null, success: 'Konto utworzone! Zaloguj się teraz.', usernameInput: '' });
      }
    );
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Błąd serwera!', success: null, usernameInput: username });
  }
});

// Logowanie
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, usernameInput: '' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'Podaj login i hasło!', usernameInput: username || '' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.render('login', { error: 'Błąd serwera!', usernameInput: username });
    }
    if (!user) {
      return res.render('login', { error: 'zmyslasz', usernameInput: username });
    }

    try {
      const HASH_PARAMS = {
        secret: Buffer.from(process.env.PEPPER || '', 'hex'),
      };
      const isValidPassword = await argon2.verify(user.password, password, HASH_PARAMS);
      if (!isValidPassword) {
        return res.render('login', { error: 'zle haslo', usernameInput: username });
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.is_admin === 1;
      res.redirect('/');
    } catch (e) {
      console.error(e);
      res.render('login', { error: 'Błąd logowania!', usernameInput: username });
    }
  });
});

// Wylogowanie
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
