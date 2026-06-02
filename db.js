const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const pokemonData = require('./pokedex.json');
const argon2 = require('argon2');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

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
    // laduje tylko za pierwszym raazem z pokedexa
    db.get('SELECT COUNT(*) as c FROM pokemons WHERE user_id IS NULL', (err, row) => {
      if (row && row.c === 0) {
        const stmt = db.prepare('INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color,user_id) VALUES (?,?,?,?,?,?,NULL)');
        pokemonData.forEach(p => stmt.run(p.name, p.type1, p.type2, p.evolution_stage, p.total_evolutions, p.color));
        stmt.finalize();
      }
    });
  });
});

// Tworzenie konta admina
db.serialize(() => {
  db.get('SELECT COUNT(*) as c FROM users WHERE is_admin=1', async (err, row) => {
    if (!row || row.c === 0) {
      try {
        const HASH_PARAMS = {
          secret: Buffer.from(process.env.PEPPER || '', 'hex'),
        };
        const hashedPassword = await argon2.hash('admin123', HASH_PARAMS);
        db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)', ['admin', hashedPassword]);
      } catch (e) {
        console.error('Błąd przy tworzeniu domyślnego konta admina:', e);
      }
    }
  });
});

function pickRandomPokemon(userId, callback) {
  const query = 'SELECT * FROM pokemons';

  db.all(query, [], (err, rows) => {
    if (err || !rows || rows.length === 0) return callback(null);
    callback(rows[Math.floor(Math.random() * rows.length)]);
  });
}

module.exports = db;
module.exports.pickRandomPokemon = pickRandomPokemon;
