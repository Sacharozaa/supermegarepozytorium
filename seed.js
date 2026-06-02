const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// jesli .env nie ma, tworzy
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const pepper = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(envPath, `PORT=3000\nSESSION_SECRET=${sessionSecret}\nPEPPER=${pepper}\n`, 'utf-8');
  console.log('Stworzono plik .env na potrzeby seedowania.');
}

require('dotenv').config();
const db = require('./db');
const argon2 = require('argon2');

async function runSeed() {
  console.log('Rozpoczynam seedowanie bazy danych...');

  const HASH_PARAMS = {
    secret: Buffer.from(process.env.PEPPER || '', 'hex'),
  };

  //dodwanie admina
  const users = [
    { username: 'admin', password: 'admin123', is_admin: 1 }
  ];

  for (const u of users) {
    const hashed = await argon2.hash(u.password, HASH_PARAMS);
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO users (username, password, is_admin) VALUES (?, ?, ?)',
        [u.username, hashed, u.is_admin],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  console.log('Seedowanie użytkowników ukończone.');

  console.log('Seedowanie zakończone sukcesem!');
  db.close();
}

runSeed().catch(err => {
  console.error('Błąd podczas seedowania:', err);
  if (db && typeof db.close === 'function') db.close();
});
