const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const expressLayouts = require("express-ejs-layouts");
app.use(expressLayouts);
app.set("layout", "layout"); // layout.ejs in /views

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: false }));

const DB_FILE = path.join(__dirname, "data.sqlite3");
const POKEDEX_FILE = path.join(__dirname, "pokedex.json");

const db = new sqlite3.Database(DB_FILE); // tworzenie bazxy

// uzupelnianie bazy bo nie insteniej
function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS pokemons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      type1 TEXT,
      type2 TEXT,
      evolution_stage INTEGER,
      total_evolutions INTEGER,
      color TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submitted_name TEXT,
      matched INTEGER,
      secret_name TEXT,
      created_at TEXT
    )`);

    db.get("SELECT COUNT(*) as c FROM pokemons", (err, row) => {
      if (err) return console.error(err);
      if (row.c === 0) {
        const data = JSON.parse(fs.readFileSync(POKEDEX_FILE));
        const stmt = db.prepare(
          "INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color) VALUES (?,?,?,?,?,?)"
        );
        data.forEach((p) => {
          stmt.run(
            p.name,
            p.type1,
            p.type2,
            p.evolution_stage,
            p.total_evolutions,
            p.color
          );
        });
        stmt.finalize(() => console.log("Seeded pokedex into database."));
      }
    });
  });
}

// wybieranie pokemona dnia bazujac na dacie
function pickDailyPokemon(callback) {
  const today = new Date().toISOString().slice(0, 10);
  db.all("SELECT * FROM pokemons ORDER BY id", (err, rows) => {
    if (err) return callback(err);
    if (!rows || rows.length === 0) return callback(new Error("No pokemons"));

    let s = 0;
    for (let i = 0; i < today.length; i++) s += today.charCodeAt(i);
    const idx = s % rows.length;
    callback(null, rows[idx]);
  });
}

initDb();

app.get("/", (req, res) => {
  res.render("index", { error: null });
});

app.post("/guess", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.render("index", { error: "Proszę podać nazwę Pokémona." });
  }
  db.get(
    "SELECT * FROM pokemons WHERE LOWER(name)=LOWER(?)",
    [name],
    (err, guessRow) => {
      if (err) return res.render("index", { error: "Błąd serwera." });
      if (!guessRow) {
        return res.render("index", {
          error: "Nie znaleziono Pokémona o takiej nazwie. Możesz go dodać.",
        });
      }
      pickDailyPokemon((err, secret) => {
        if (err) return res.render("index", { error: "Błąd losowania." });
        const matched =
          guessRow.name.toLowerCase() === secret.name.toLowerCase() ? 1 : 0;
        db.run(
          "INSERT INTO guesses (submitted_name, matched, secret_name, created_at) VALUES (?,?,?,?)",
          [guessRow.name, matched, secret.name, new Date().toISOString()]
        );
        // porownanie strzalu i odpowiedzi
        const comparison = [
          {
            label: "Typ 1",
            guess: guessRow.type1 || "-",
            secret: secret.type1 || "-",
            ok: guessRow.type1 === secret.type1,
          },
          {
            label: "Typ 2",
            guess: guessRow.type2 || "-",
            secret: secret.type2 || "-",
            ok: guessRow.type2 === secret.type2,
          },
          {
            label: "Etap ewolucji",
            guess: guessRow.evolution_stage,
            secret: secret.evolution_stage,
            ok: guessRow.evolution_stage === secret.evolution_stage,
          },
          {
            label: "Liczba poziomów ewolucji",
            guess: guessRow.total_evolutions,
            secret: secret.total_evolutions,
            ok: guessRow.total_evolutions === secret.total_evolutions,
          },
          {
            label: "Kolor",
            guess: guessRow.color || "-",
            secret: secret.color || "-",
            ok: guessRow.color === secret.color,
          },
        ];
        res.render("result", {
          guessName: guessRow.name,
          secretName: secret.name,
          comparison,
          matched,
        });
      });
    }
  );
});

app.get("/add", (req, res) => {
  res.render("add", { error: null, success: null });
});

app.post("/add", (req, res) => {
  const name = (req.body.name || "").trim();
  const type1 = (req.body.type1 || "").trim();
  const type2 = (req.body.type2 || "").trim() || null;
  const evolution_stage = parseInt(req.body.evolution_stage);
  const total_evolutions = parseInt(req.body.total_evolutions);
  const color = (req.body.color || "").trim();
  //wlidscja
  const errors = [];
  if (!name) errors.push("Nazwa jest wymagana.");
  if (!type1) errors.push("Typ 1 jest wymagany.");
  if (!Number.isInteger(evolution_stage) || evolution_stage < 1)
    errors.push("Etap ewolucji musi być liczbą całkowitą >=1.");
  if (!Number.isInteger(total_evolutions) || total_evolutions < 1)
    errors.push("Liczba poziomów ewolucji musi być liczbą całkowitą >=1.");
  if (!color) errors.push("Kolor jest wymagany.");
  if (errors.length > 0)
    return res.render("add", { error: errors.join(" "), success: null });
  db.run(
    "INSERT INTO pokemons (name,type1,type2,evolution_stage,total_evolutions,color) VALUES (?,?,?,?,?,?)",
    [name, type1, type2, evolution_stage, total_evolutions, color],
    function (err) {
      if (err) {
        if (err.message && err.message.includes("UNIQUE")) {
          return res.render("add", {
            error: "Pokémon o takiej nazwie już istnieje.",
            success: null,
          });
        }
        return res.render("add", {
          error: "Błąd zapisu do bazy.",
          success: null,
        });
      }
      res.render("add", {
        error: null,
        success: "Dodano Pokémona do Pokedexu.",
      });
    }
  );
});

app.get("/stats", (req, res) => {
  db.all(
    "SELECT * FROM guesses ORDER BY created_at DESC LIMIT 50",
    (err, rows) => {
      if (err) return res.render("index", { error: "Błąd odczytu statystyk." });
      res.render("stats", { rows });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Pokedle app listening on port ${PORT}`);
});
