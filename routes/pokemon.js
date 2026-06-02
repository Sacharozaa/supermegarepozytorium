const express = require('express');
const db = require('../db');
const { pickRandomPokemon } = require('../db');

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(403).send('Nie jestes adminem ');
  }
  next();
};

// Pamięć podręczna gier
let currentGames = {};
let globalGame = null;

// Strona Główna - Gra
router.get('/', (req, res) => {
  const userId = req.session ? req.session.userId : null;
  const username = req.session ? req.session.username : null;
  const isAdmin = req.session ? req.session.isAdmin : false;
  let activeGame = userId ? currentGames[userId] : globalGame;

  if (!activeGame) {
    pickRandomPokemon(userId, (secret) => {
      if (!secret) {
        console.error('Błąd losowania pokemona');
        return res.render('index', {
          game: null,
          username,
          isAdmin,
          error: 'Nie załadowało się '
        });
      }

      const newGame = { secret, guesses: [], status: 'playing' };
      if (userId) currentGames[userId] = newGame;
      else globalGame = newGame;
      res.render('index', { game: newGame, username, isAdmin, error: null });
    });
  } else {
    res.render('index', { game: activeGame, username, isAdmin, error: null });
  }
});

// Zgadywanie pokemona
router.post('/guess', (req, res) => {
  const userId = req.session.userId || null;
  const name = req.body.name.trim();
  const game = userId ? currentGames[userId] : globalGame;

  if (!game) {
    return res.redirect('/');
  }

  // Wyszukaj pokemona w bazie wszystkich pokemonów
  const query = 'SELECT * FROM pokemons WHERE LOWER(name)=LOWER(?)';
  const params = [name];

  db.get(query, params, (err, guess) => {
    if (!guess) {
      return res.render('index', {
        game,
        error: 'Nie ma takiego pokemon, wybierz cos innego',
        username: req.session.username,
        isAdmin: req.session.isAdmin
      });
    }

    const secret = game.secret;
    const correct = guess.name.toLowerCase() === secret.name.toLowerCase();

    const comparison = [
      { label: 'Typ 1', guess: guess.type1, ok: guess.type1 === secret.type1 },
      { label: 'Typ 2', guess: guess.type2 || '-', ok: guess.type2 === secret.type2 },
      { label: 'Etap', guess: guess.evolution_stage, ok: guess.evolution_stage === secret.evolution_stage },
      { label: 'Kolor', guess: guess.color, ok: guess.color === secret.color },
    ];

    game.guesses.push({ name: guess.name, comparison });

    // Zapisz strzał w bazie danych (tylko dla zalogowanych)
    if (userId) {
      db.run(
        'INSERT INTO guesses (user_id, secret_name, submitted_name, matched) VALUES (?, ?, ?, ?)',
        [userId, secret.name, guess.name, correct ? 1 : 0]
      );
    }

    if (correct) game.status = 'won';
    else if (game.guesses.length >= 5) game.status = 'lost';

    res.redirect('/');
  });
});

// Restart gry
router.post('/restart', (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    currentGames[userId] = null;
  } else {
    globalGame = null;
  }
  res.redirect('/');
});

// Pokédex - widok listy pokemonów
router.get('/pokedex', (req, res) => {
  const userId = req.session.userId || null;
  const username = req.session.username || null;
  const isAdmin = req.session.isAdmin || false;

  // Pokazuje wszystkie pokemony z bazy danych
  const query = 'SELECT * FROM pokemons';
  const params = [];

  db.all(query, params, (err, rows) => {
    res.render('pokedex', { pokemons: rows || [], username, isAdmin, userId, isGlobal: true });
  });
});

// Dodawanie pokemona
router.get('/add', requireLogin, (req, res) => {
  res.render('add', { error: null, success: null, username: req.session.username, isAdmin: req.session.isAdmin });
});

router.post('/add', requireLogin, (req, res) => {
  const { name, type1, type2, evolution_stage, total_evolutions, color } = req.body;
  const userId = req.session.userId;

  db.run(
    'INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color,user_id) VALUES (?,?,?,?,?,?,?)',
    [name, type1, type2 || null, evolution_stage, total_evolutions, color, userId],
    (err) => {
      if (err) {
        res.render('add', { error: 'Coś poszło nie tak (np. Pokemon o tej nazwie już istnieje)', success: null, username: req.session.username, isAdmin: req.session.isAdmin });
      } else {
        res.render('add', { error: null, success: 'Dodano Pokemona ദ്ദി◝ ⩊ ◜.ᐟ', username: req.session.username, isAdmin: req.session.isAdmin });
      }
    }
  );
});

// Moje dodane pokemony
router.get('/my-pokemons', requireLogin, (req, res) => {
  const userId = req.session.userId;
  db.all('SELECT * FROM pokemons WHERE user_id = ?', [userId], (err, rows) => {
    res.render('my-pokemons', { pokemons: rows || [], username: req.session.username, isAdmin: req.session.isAdmin });
  });
});

// Edycja pokemona
router.get('/edit/:id', requireLogin, (req, res) => {
  const pokemonId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;

  db.get('SELECT * FROM pokemons WHERE id = ?', [pokemonId], (err, pokemon) => {
    if (!pokemon) {
      return res.status(404).send('Pokemon nie znaleziony');
    }

    if (pokemon.user_id !== userId && !isAdmin) {
      return res.status(403).send('Nie dla psa kiełbasa (¬_ ´¬ )');
    }

    res.render('edit', { pokemon, error: null, username: req.session.username, isAdmin });
  });
});

router.post('/edit/:id', requireLogin, (req, res) => {
  const pokemonId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;
  const { name, type1, type2, evolution_stage, total_evolutions, color } = req.body;

  db.get('SELECT * FROM pokemons WHERE id = ?', [pokemonId], (err, pokemon) => {
    if (!pokemon) {
      return res.status(404).send('Pokemon nie znaleziony');
    }

    if (pokemon.user_id !== userId && !isAdmin) {
      return res.status(403).send('Nie możesz edytować tego Pokemona');
    }

    db.run(
      'UPDATE pokemons SET name=?, type1=?, type2=?, evolution_stage=?, total_evolutions=?, color=? WHERE id=?',
      [name, type1, type2 || null, evolution_stage, total_evolutions, color, pokemonId],
      (err) => {
        if (err) {
          return res.render('edit', { pokemon, error: 'Błąd przy edycji!', username: req.session.username, isAdmin });
        }
        res.redirect('/my-pokemons');
      }
    );
  });
});

// Usuwanie pokemona
router.post('/delete/:id', requireLogin, (req, res) => {
  const pokemonId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;

  db.get('SELECT * FROM pokemons WHERE id = ?', [pokemonId], (err, pokemon) => {
    if (!pokemon) {
      return res.status(404).send('Nie ma pokemon ૮(◞ ‸ ◟ )ა');
    }

    if (pokemon.user_id !== userId && !isAdmin) {
      return res.status(403).send('Nie możesz go usunąć ( ` ᴖ ´ )');
    }

    db.run('DELETE FROM pokemons WHERE id = ?', [pokemonId], (err) => {
      res.redirect('/my-pokemons');
    });
  });
});

// Panel Administratora
router.get('/admin', requireLogin, requireAdmin, (req, res) => {
  db.all(
    'SELECT u.id, u.username, u.is_admin, COUNT(p.id) as pokemon_count FROM users u LEFT JOIN pokemons p ON u.id = p.user_id GROUP BY u.id',
    (err, users) => {
      db.all('SELECT * FROM pokemons WHERE user_id IS NOT NULL', (err, customPokemons) => {
        res.render('admin', { users: users || [], customPokemons: customPokemons || [], username: req.session.username, isAdmin: req.session.isAdmin });
      });
    }
  );
});

// Statystyki
router.get('/stats', (req, res) => {
  const userId = req.session.userId || null;
  const username = req.session.username || null;
  const isAdmin = req.session.isAdmin || false;

  if (!userId) {
    return res.render('stats', { rows: [], username, isAdmin, error: 'Zaloguj się by zobaczyć swoje statystyki' });
  }

  db.all(
    'SELECT * FROM guesses WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
    (err, rows) => {
      res.render('stats', { rows: rows || [], username, isAdmin, error: null });
    }
  );
});

module.exports = router;
