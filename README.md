# yacacher
Yandex Geocoding and Suggest proxy and cache

# Install</br>
pip install -r requirements.txt</br>
chmod +x run.sh</br>

<b>edit run.sh and write your api key</br></b>
export YANDEX_GEOCODING_API_KEY="your_key"</br>
export YANDEX_SUGGEST_API_KEY="your_key"</br>

./run.sh</br>

# Default listen port 5000

# Example request
http://127.0.0.1:5000/geocode?query=минск,%20ленина%2013</br>
http://127.0.0.1:5000/suggest?query=минск,%20ленина%2013</br>
