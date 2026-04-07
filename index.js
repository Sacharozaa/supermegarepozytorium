const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const expressLayouts = require('express-ejs-layouts');
const pokemonData = require('./pokedex.json');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);

app.use(session({
  secret: 'super-secret-key',
  resave: false,
  saveUninitialized: true
}));

const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
};

app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

//baza danych
const db = new sqlite3.Database(path.join(__dirname, "database.sqlite"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pokemons (
    id INTEGER PRIMARY KEY,
    name TEXT,
    type1 TEXT,
    type2 TEXT,
    evolution_stage INTEGER,
    total_evolutions INTEGER,
    color TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(name, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS guesses (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    secret_name TEXT,
    submitted_name TEXT,
    matched INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`, () => {
    //laduje tylko za pierwszym razem
    db.get("SELECT COUNT(*) as c FROM pokemons WHERE user_id IS NULL", (err, row) => {
      if (row && row.c === 0) {
        const stmt = db.prepare("INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color,user_id) VALUES (?,?,?,?,?,?,NULL)");
        pokemonData.forEach(p => stmt.run(p.name, p.type1, p.type2, p.evolution_stage, p.total_evolutions, p.color));
        stmt.finalize();
      }
    });
  });
});

// konto admina
db.get("SELECT COUNT(*) as c FROM users WHERE is_admin=1", async (err, row) => {
  if (!row || row.c === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)", ["admin", hashedPassword]);
  }
});

// Losowy Pokemon
function pickRandomPokemon(callback) {
  db.all("SELECT * FROM pokemons", (err, rows) => {
    if (err || !rows || rows.length === 0) return callback(null);
    callback(rows[Math.floor(Math.random() * rows.length)]);
  });
}

const requireAdmin = (req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(403).send("Nie jestes adminem ");
  }
  next();
};

// Rejestracja (nie dziala)
app.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("register");
});
app.post("/register", async (req, res) => {
  const { username, password, password2 } = req.body;

  if (!username || !password || !password2) {
    return res.render("register", { error: "uzupelnij wsyztsko" });
  }

  if (password !== password2) {
    return res.render("register", { error: "Hasla sie roznia" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (username, password) VALUES (?, ?)",
      [username, hashedPassword],
      (err) => {
        if (err) {
          return res.render("register", { error: "Ta nazwa użytkownika już istnieje!" });
        }
        res.render("register", { success: "Konto utworzone! Zaloguj się teraz." });
      }
    );
  } catch (err) {
    res.render("register", { error: "Błąd serwera!" });
  }
});

// Logowanie
app.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("login", { error: null });
});
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { error: "Podaj login i hasło!" });
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (!user) {
      return res.render("login", { error: "zmyslasz" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.render("login", { error: "zle haslo" });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin === 1;
    res.redirect("/");
  });
});
// Wylogowanie
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

//GRA--------

//GRA
let currentGames = {};
let globalGame = null;

app.get("/", (req, res) => {
  const userId = req.session ? req.session.userId : null;
  const username = req.session ? req.session.username : null;
  const isAdmin = req.session ? req.session.isAdmin : false;
  let activeGame = userId ? currentGames[userId] : globalGame;

  if (!activeGame) {
    pickRandomPokemon((secret) => {
      if (!secret) {
        console.error("dupa");
        return res.render("index", {
          game: null,
          username,
          isAdmin,
          error: "NIe zaladowalo sie "
        });
      }

      const newGame = { secret, guesses: [], status: "playing" };
      if (userId) currentGames[userId] = newGame;
      else globalGame = newGame;
      res.render("index", { game: newGame, username, isAdmin, error: null });
    });
  } else {
    res.render("index", { game: activeGame, username, isAdmin, error: null });
  }
});

//??? Zgadnij Pokemona
app.post("/guess", (req, res) => {
  const userId = req.session.userId;
  const name = req.body.name.trim();
  const game = userId ? currentGames[userId] : globalGame;

  if (!game) {
    return res.redirect("/");
  }

  //znajdz czt pokemon jest w pokedexie 
  db.get("SELECT * FROM pokemons WHERE LOWER(name)=LOWER(?) AND user_id IS NULL", [name], (err, guess) => {
    if (!guess) {
      return res.render("index", { game, error: "Nie ma takiego pokemon, wybierz cos innego", username: req.session.username, isAdmin: req.session.isAdmin });
    }
    const secret = game.secret;
    const correct = guess.name.toLowerCase() === secret.name.toLowerCase();

    const comparison = [
      { label: "Typ 1", guess: guess.type1, ok: guess.type1 === secret.type1 },
      { label: "Typ 2", guess: guess.type2 || "-", ok: guess.type2 === secret.type2 },
      { label: "Etap", guess: guess.evolution_stage, ok: guess.evolution_stage === secret.evolution_stage },
      { label: "Kolor", guess: guess.color, ok: guess.color === secret.color },
    ];

    game.guesses.push({ name: guess.name, comparison });

    //dodanie strzalu do tabeli
    db.run(
      "INSERT INTO guesses (user_id, secret_name, submitted_name, matched) VALUES (?, ?, ?, ?)",
      [userId, secret.name, guess.name, correct ? 1 : 0]
    );

    if (correct) game.status = "won";
    else if (game.guesses.length >= 5) game.status = "lost";

    res.redirect("/");
  });
});

//nowa gra
app.post("/restart", (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    currentGames[userId] = null;
  } else {
    globalGame = null;
  }
  res.redirect("/");
});

//Pokedex
app.get("/pokedex", (req, res) => {
  const userId = req.session.userId || null;
  const username = req.session.username || null;
  const isAdmin = req.session.isAdmin || false;

  db.all("SELECT * FROM pokemons WHERE user_id IS NULL", (err, rows) => {
    res.render("pokedex", { pokemons: rows, username, isAdmin, userId, isGlobal: true });
  });
});

//Dodwanie pokemonow
app.get("/add", requireLogin, (req, res) => {
  res.render("add", { username: req.session.username, isAdmin: req.session.isAdmin });
});
app.post("/add", requireLogin, (req, res) => {
  const { name, type1, type2, evolution_stage, total_evolutions, color } = req.body;
  const userId = req.session.userId;

  db.run(
    "INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color,user_id) VALUES (?,?,?,?,?,?,?)",
    [name, type1, type2 || null, evolution_stage, total_evolutions, color, userId],
    (err) => {// czy wywali blad
      if (err) {
        res.render("add", { error: "Cos poszlo nie tak", username: req.session.username, isAdmin: req.session.isAdmin });
      } else {
        res.render("add", { success: "Dodano Pokemonaദ്ദി◝ ⩊ ◜.ᐟ", username: req.session.username, isAdmin: req.session.isAdmin });
      }
    }
  );
});

//dodane pokemony
app.get("/my-pokemons", requireLogin, (req, res) => {
  const userId = req.session.userId;
  db.all("SELECT * FROM pokemons WHERE user_id = ?", [userId], (err, rows) => {
    res.render("my-pokemons", { pokemons: rows || [], username: req.session.username, isAdmin: req.session.isAdmin });
  });
});

//edytowanie pokemonow
app.get("/edit/:id", requireLogin, (req, res) => {
  const pokemonId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;

  db.get("SELECT * FROM pokemons WHERE id = ?", [pokemonId], (err, pokemon) => {
    if (!pokemon) {
      return res.status(404).send("Pokemon nie znaleziony");
    }
    app.post("/edit/:id", requireLogin, (req, res) => {
      const pokemonId = req.params.id;
      const userId = req.session.userId;
      const isAdmin = req.session.isAdmin;
      const { name, type1, type2, evolution_stage, total_evolutions, color } = req.body;

      db.get("SELECT * FROM pokemons WHERE id = ?", [pokemonId], (err, pokemon) => {
        if (!pokemon) {
          return res.status(404).send("Pokemon nie znaleziony");
        }

        if (pokemon.user_id !== userId && !isAdmin) {
          return res.status(403).send("Nie możesz edytować tego Pokemona");
        }

        db.run(
          "UPDATE pokemons SET name=?, type1=?, type2=?, evolution_stage=?, total_evolutions=?, color=? WHERE id=?",
          [name, type1, type2 || null, evolution_stage, total_evolutions, color, pokemonId],
          (err) => {
            if (err) {
              return res.render("edit", { pokemon, error: "Błąd przy edycji!", username: req.session.username, isAdmin });
            }
            res.redirect("/my-pokemons");
          }
        );
      });
    });

    //Czy jest adminem
    if (pokemon.user_id !== userId && !isAdmin) {
      return res.status(403).send("Nie dla psa kielbasa (¬_ ´¬ )");
    }
    res.render("edit", { pokemon, username: req.session.username, isAdmin });
  });
});



//Usuwanie pokemonow
app.post("/delete/:id", requireLogin, (req, res) => {
  const pokemonId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.isAdmin;

  db.get("SELECT * FROM pokemons WHERE id = ?", [pokemonId], (err, pokemon) => {
    if (!pokemon) {
      return res.status(404).send("Nie ma pokemon ૮(◞ ‸ ◟ )ა");
    }

    if (pokemon.user_id !== userId && !isAdmin) {
      return res.status(403).send("Nie mozesz go usunac ( ` ᴖ ´ )");
    }

    db.run("DELETE FROM pokemons WHERE id = ?", [pokemonId], (err) => {
      res.redirect("/my-pokemons");
    });
  });
});

//Pudlo admina
app.get("/admin", requireLogin, requireAdmin, (req, res) => {
  db.all("SELECT u.id, u.username, u.is_admin, COUNT(p.id) as pokemon_count FROM users u LEFT JOIN pokemons p ON u.id = p.user_id GROUP BY u.id",
    (err, users) => {
      db.all("SELECT * FROM pokemons WHERE user_id IS NOT NULL", (err, customPokemons) => {
        res.render("admin", { users, customPokemons, username: req.session.username, isAdmin: req.session.isAdmin });
      });
    }
  );
});

//Statystyki
app.get("/stats", (req, res) => {
  let userId = req.session.userId || null;
  const username = req.session.username || null;
  const isAdmin = req.session.isAdmin || false;

  if (!userId) {
    return res.render("stats", { rows: [], username, isAdmin, error: "Zaloguj się by zobaczyć swoje statystyki" });
  }

  db.all(
    "SELECT * FROM guesses WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
    (err, rows) => {
      res.render("stats", { rows: rows || [], username, isAdmin });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Gra na porcie ${PORT}`);
});
