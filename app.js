const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Конфигурация
const YANDEX_GEOCODE_URL = "https://geocode-maps.yandex.ru/1.x/";
const YANDEX_SUGGEST_URL = "https://suggest-maps.yandex.ru/v1/suggest";
const GEOCODING_API_KEY = process.env.YANDEX_GEOCODING_API_KEY;
const SUGGEST_API_KEY = process.env.YANDEX_SUGGEST_API_KEY;
const DATABASE_NAME = path.join(__dirname, "geocache.db");

// Инициализация базы данных
const db = new sqlite3.Database(DATABASE_NAME, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Connected to SQLite database');
    initDb();
});

function initDb() {
    db.serialize(() => {
        // Создание основной таблицы
        db.run(`
            CREATE TABLE IF NOT EXISTS geocache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                service_type TEXT NOT NULL,
                response TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(query, service_type)
            )
        `);

        // Проверка существования столбца service_type (для миграции)
        db.get("PRAGMA table_info(geocache)", (err, rows) => {
            if (err) {
                console.error("Column check error:", err.message);
                return;
            }
            
            const hasServiceType = rows.some(column => column.name === 'service_type');
            if (!hasServiceType) {
                db.run(`
                    ALTER TABLE geocache 
                    ADD COLUMN service_type TEXT NOT NULL DEFAULT 'geocode'
                `, (err) => {
                    if (err) console.error("Error adding column:", err.message);
                });
            }
        });

        // Создание индекса
        db.run(`
            CREATE UNIQUE INDEX IF NOT EXISTS 
            idx_query_service ON geocache(query, service_type)
        `, (err) => {
            if (err) console.error("Index creation error:", err.message);
        });
    });
}

// Кэширование
function getCachedResult(query, serviceType) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT response FROM geocache WHERE query = ? AND service_type = ?",
            [query, serviceType],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? JSON.parse(row.response) : null);
            }
        );
    });
}

function saveToCache(query, serviceType, data) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO geocache (query, service_type, response) 
             VALUES (?, ?, ?)`,
            [query, serviceType, JSON.stringify(data)],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

// Валидация
function validateQuery(query) {
    if (!query || query.trim().length < 3) {
        return { error: "Query must be at least 3 characters" };
    }
    return null;
}

// Эндпоинты
app.get('/geocode', async (req, res) => {
    try {
        if (!GEOCODING_API_KEY) {
            return res.status(503).json({ error: "Geocoding service unavailable" });
        }

        const query = (req.query.query || "").trim();
        const validationError = validateQuery(query);
        if (validationError) {
            return res.status(400).json(validationError);
        }

        // Проверка кэша
        const cached = await getCachedResult(query, 'geocode');
        if (cached) {
            return res.json({ result: cached, source: "cache" });
        }

        // Запрос к Yandex
        const params = {
            apikey: GEOCODING_API_KEY,
            geocode: query,
            format: "json"
        };

        const response = await axios.get(YANDEX_GEOCODE_URL, { params });
        await saveToCache(query, 'geocode', response.data);
        
        res.json({ result: response.data, source: "yandex" });
    } catch (error) {
        console.error('Geocode error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ 
                error: `Yandex Geocode error: ${error.message}` 
            });
        } else if (error.request) {
            res.status(500).json({ 
                error: "No response from Yandex service" 
            });
        } else {
            res.status(500).json({ 
                error: `Internal server error: ${error.message}` 
            });
        }
    }
});

app.get('/suggest', async (req, res) => {
    try {
        if (!SUGGEST_API_KEY) {
            return res.status(503).json({ error: "Suggest service unavailable" });
        }

        const query = (req.query.query || "").trim();
        const validationError = validateQuery(query);
        if (validationError) {
            return res.status(400).json(validationError);
        }

        // Проверка кэша
        const cached = await getCachedResult(query, 'suggest');
        if (cached) {
            return res.json({ result: cached, source: "cache" });
        }

        // Запрос к Yandex Suggest
        const params = {
            apikey: SUGGEST_API_KEY,
            text: query,
            type: "geo",
            lang: "ru_RU",
            results: 10
        };

        const response = await axios.get(YANDEX_SUGGEST_URL, { params });
        await saveToCache(query, 'suggest', response.data);
        
        res.json({ result: response.data, source: "yandex" });
    } catch (error) {
        console.error('Suggest error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ 
                error: `Yandex Suggest error: ${error.message}` 
            });
        } else if (error.request) {
            res.status(500).json({ 
                error: "No response from Yandex service" 
            });
        } else {
            res.status(500).json({ 
                error: `Internal server error: ${error.message}` 
            });
        }
    }
});

// Обработка несуществующих роутов
app.use((req, res) => {
    res.status(404).json({ error: "Route not found" });
});

// Глобальная обработка ошибок
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

// Закрытие соединения с БД при завершении
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});
