import json
import sqlite3
from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# Конфигурация
YANDEX_GEOCODE_URL = "https://geocode-maps.yandex.ru/1.x/"
YANDEX_SUGGEST_URL = "https://suggest-maps.yandex.ru/v1/suggest"
GEOCODING_API_KEY = os.getenv("YANDEX_GEOCODING_API_KEY")
SUGGEST_API_KEY = os.getenv("YANDEX_SUGGEST_API_KEY")
DATABASE_NAME = "geocache.db"

def init_db():
    conn = sqlite3.connect(DATABASE_NAME)
    c = conn.cursor()
    
    # Создание основной таблицы
    c.execute("""
        CREATE TABLE IF NOT EXISTS geocache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            service_type TEXT NOT NULL,
            response TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(query, service_type)
        )
    """)
    
    # Проверка и добавление столбца service_type для миграции
    try:
        c.execute("PRAGMA table_info(geocache)")
        columns = [column[1] for column in c.fetchall()]
        if 'service_type' not in columns:
            c.execute("""
                ALTER TABLE geocache 
                ADD COLUMN service_type TEXT NOT NULL DEFAULT 'geocode'
            """)
    except sqlite3.OperationalError as e:
        print(f"Column check error: {e}")
    
    # Создание индекса
    try:
        c.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS 
            idx_query_service ON geocache(query, service_type)
        """)
    except sqlite3.OperationalError as e:
        print(f"Index creation error: {e}")
    
    conn.commit()
    conn.close()

init_db()

def get_cached_result(query, service_type):
    conn = sqlite3.connect(DATABASE_NAME)
    c = conn.cursor()
    c.execute("""
        SELECT response FROM geocache 
        WHERE query = ? AND service_type = ?
    """, (query, service_type))
    result = c.fetchone()
    conn.close()
    return json.loads(result[0]) if result else None

def save_to_cache(query, service_type, data):
    conn = sqlite3.connect(DATABASE_NAME)
    c = conn.cursor()
    try:
        c.execute("""
            INSERT INTO geocache (query, service_type, response)
            VALUES (?, ?, ?)
        """, (query, service_type, json.dumps(data, ensure_ascii=False)))
        conn.commit()
    except sqlite3.IntegrityError:
        pass  # Запись уже существует
    finally:
        conn.close()

def validate_query(query):
    if len(query.strip()) < 3:
        return jsonify({"error": "Query must be at least 3 characters"}), 400
    return None

@app.route("/geocode")
def geocode():
    if not GEOCODING_API_KEY:
        return jsonify({"error": "Geocoding service unavailable"}), 503
    
    query = request.args.get("query", "").strip()
    
    if error := validate_query(query):
        return error
    
    if cached := get_cached_result(query, 'geocode'):
        return jsonify({"result": cached, "source": "cache"})
    
    params = {
        "apikey": GEOCODING_API_KEY,
        "geocode": query,
        "format": "json"
    }
    
    try:
        response = requests.get(YANDEX_GEOCODE_URL, params=params)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Yandex Geocode error: {str(e)}"}), 500
    
    data = response.json()
    save_to_cache(query, 'geocode', data)
    
    return jsonify({"result": data, "source": "yandex"})

@app.route("/suggest")
def suggest():
    if not SUGGEST_API_KEY:
        return jsonify({"error": "Suggest service unavailable"}), 503
    
    query = request.args.get("query", "").strip()
    
    if error := validate_query(query):
        return error
    
    if cached := get_cached_result(query, 'suggest'):
        return jsonify({"result": cached, "source": "cache"})
    
    params = {
        "apikey": SUGGEST_API_KEY,
        "text": query,
        "type": "geo",
        "lang": "ru_RU",
        "results": 10
    }
    
    try:
        response = requests.get(YANDEX_SUGGEST_URL, params=params)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Yandex Suggest error: {str(e)}"}), 500
    
    data = response.json()
    save_to_cache(query, 'suggest', data)
    
    return jsonify({"result": data, "source": "yandex"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
