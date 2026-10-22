const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Пул подключений к БД (чтобы не открывать новое соединение на каждый запрос)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 1. Эндпоинт РЕГИСТРАЦИИ
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введите ник и пароль' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email || null, hash]
    );
    res.json({ success: true, message: 'Успешная регистрация' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Этот ник уже занят' });
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// 2. Эндпоинт ВХОДА (ЛОГИН)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введите ник и пароль' });

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(401).json({ error: 'Неверный ник или пароль' });
    
    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Неверный ник или пароль' });

    // Создаем токен (действует 7 дней)
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Сохраняем сессию в БД
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, user.id, expiresAt]);

    res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// 3. Эндпоинт ПРОВЕРКИ ТОКЕНА (для игры)
app.get('/api/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ error: 'Нет токена' });

  try {
    const [sessions] = await pool.query(
      'SELECT s.*, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > NOW()',
      [token]
    );
    
    if (sessions.length === 0) return res.status(401).json({ error: 'Токен недействителен' });
    res.json({ success: true, username: sessions[0].username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер авторизации запущен на http://localhost:${PORT}`);
});