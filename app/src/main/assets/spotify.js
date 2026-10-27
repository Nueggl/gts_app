// --- EINSTELLUNGEN (über Android JavascriptInterface) ---
const clientId = (typeof Android !== 'undefined' && typeof Android.getSpotifyClientId === 'function')
    ? Android.getSpotifyClientId()
    : '';
const redirectUri = 'https://guessthesong.local/';

// --- VARIABLEN ---
let token;
let deviceId;
let spotifyPlayer;
let isExchangingCode = false;

// --- 1. PKCE & LOKALER SPEICHER HILFSFUNKTIONEN ---
function generateRandomString(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Reiner JS SHA-256 Fallback (falls window.crypto.subtle nicht bereitsteht)
function sha256Fallback(ascii) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = sha256Fallback.h = sha256Fallback.h || [];
    const k = sha256Fallback.k = sha256Fallback.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (let i = 0; i < 313; i += candidate) {
                isComposite[i] = candidate;
            }
            hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
        const j = ascii.charCodeAt(i);
        if (j >> 8) return;
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (let j = 0; j < words.length;) {
        const w = words.slice(j, (j += 16));
        const oldHash = hash;
        hash = hash.slice(0, 8);
        for (let i = 0; i < 64; i++) {
            const w15 = w[i - 15], w2 = w[i - 2];
            const a = hash[0], e = hash[4];
            const temp1 = hash[7]
                + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
                + ((e & hash[5]) ^ (~e & hash[6]))
                + k[i]
                + (w[i] = (i < 16) ? w[i] : (
                    w[i - 16]
                    + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
                    + w[i - 7]
                    + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
                ) | 0);
            const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
                + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
            hash = [(temp1 + temp2) | 0].concat(hash);
            hash[4] = (hash[4] + temp1) | 0;
        }
        for (let i = 0; i < 8; i++) {
            hash[i] = (hash[i] + oldHash[i]) | 0;
        }
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
        bytes[i * 4] = (hash[i] >>> 24) & 0xff;
        bytes[i * 4 + 1] = (hash[i] >>> 16) & 0xff;
        bytes[i * 4 + 2] = (hash[i] >>> 8) & 0xff;
        bytes[i * 4 + 3] = hash[i] & 0xff;
    }
    return bytes.buffer;
}

async function generateCodeChallenge(codeVerifier) {
    function base64encode(string) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(string)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
    if (window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return base64encode(digest);
    } else {
        const digest = sha256Fallback(codeVerifier);
        return base64encode(digest);
    }
}

// Speichert den Token mit einem Zeitstempel (Ablauf in 60 Min)
function setTokenWithExpiry(accessToken) {
    const now = new Date();
    const item = {
        token: accessToken,
        expiry: now.getTime() + 3600000, // 3.600.000 ms = 1 Stunde
    };
    localStorage.setItem("spotify_access_token", JSON.stringify(item));
}

// Prüft, ob ein gültiger (nicht abgelaufener) Token existiert
function getValidToken() {
    const itemStr = localStorage.getItem("spotify_access_token");
    if (!itemStr) return null;
    
    const item = JSON.parse(itemStr);
    const now = new Date();
    
    if (now.getTime() > item.expiry) {
        localStorage.removeItem("spotify_access_token");
        return null;
    }
    return item.token;
}

// --- 2. LOGIN STARTEN ---
async function loginWithSpotify() {
    let codeVerifier = generateRandomString(128);
    // Wir speichern den Verifier kurz im Browser
    localStorage.setItem('code_verifier', codeVerifier);

    let codeChallenge = await generateCodeChallenge(codeVerifier);
    let scope = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
    
    let args = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
    });

    window.location = 'https://accounts.spotify.com/authorize?' + args;
}

// --- 3. PKCE CODE-AUSTAUSCH (Wird auch direkt vom Android WebViewClient aufgerufen) ---
function handleSpotifyRedirectCode(authCode) {
    if (!authCode || isExchangingCode) return;
    isExchangingCode = true;

    // Falls der Login-Button noch sichtbar ist, entfernen
    const existingBtn = document.getElementById('spotify-login-btn');
    if (existingBtn) {
        existingBtn.remove();
    }

    let codeVerifier = localStorage.getItem('code_verifier');

    let body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier
    });

    fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
    })
    .then(response => {
        if (!response.ok) throw new Error('HTTP status ' + response.status);
        return response.json();
    })
    .then(data => {
        token = data.access_token;
        console.log("✅ Spotify Token erfolgreich über PKCE erhalten!");
        
        // Den frischen Token abspeichern
        setTokenWithExpiry(token);

        // URL wieder sauber machen (falls Parameter in der URL vorhanden waren)
        try {
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {}
        
        // Wenn wir den Token haben, bauen wir den Player auf
        if (window.Spotify) {
            initSpotifyPlayer();
        }
    })
    .catch(error => {
        isExchangingCode = false;
        console.error('Fehler beim Token-Abruf:', error);
    });
}

// --- TOKEN ABRUFEN ODER AUS DEM CACHE LADEN ---
const urlParams = new URLSearchParams(window.location.search);
let code = urlParams.get('code');
let cachedToken = getValidToken();

if (cachedToken) {
    // FALL 1: Wir haben einen gültigen Token gespeichert!
    token = cachedToken;
    console.log("♻️ Nutze gespeicherten Token aus dem Browser (gültig für < 60 Min)");
    
    // Falls das SDK schon da ist, direkt starten
    if (window.Spotify) {
        initSpotifyPlayer();
    }
} else if (code) {
    // FALL 2: Wir haben den Code aus der URL! Jetzt tauschen wir ihn gegen den Token.
    handleSpotifyRedirectCode(code);
} else if (!token) {
    // FALL 3: Weder Token noch Code da -> Login Button zeigen
    const loginBtn = document.createElement('button');
    loginBtn.id = "spotify-login-btn";
    loginBtn.innerText = "🎧 Mit Spotify verbinden";
    loginBtn.style.padding = "15px 30px";
    loginBtn.style.fontSize = "18px";
    loginBtn.style.backgroundColor = "#1DB954";
    loginBtn.style.color = "white";
    loginBtn.style.border = "none";
    loginBtn.style.borderRadius = "50px";
    loginBtn.style.cursor = "pointer";
    loginBtn.style.margin = "20px";
    loginBtn.style.fontWeight = "bold";
    
    loginBtn.onclick = loginWithSpotify; 
    document.body.prepend(loginBtn);
}

// Überträgt das aktive Spotify-Playback wieder auf unseren WebView-Player (PUT /v1/me/player)
function transferPlaybackToWebView(playNow = false) {
    const activeToken = token || getValidToken();
    if (!activeToken || !deviceId) return Promise.resolve(false);

    return fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({
            device_ids: [deviceId],
            play: playNow
        })
    })
    .then(res => {
        if (res.ok || res.status === 204) {
            console.log("🔄 Spotify Playback erfolgreich auf WebView-Device übertragen:", deviceId);
            return true;
        }
        console.warn("⚠️ Transfer Playback Status:", res.status);
        return false;
    })
    .catch(err => {
        console.warn("Fehler beim Playback-Transfer:", err);
        return false;
    });
}

// --- 4. SPOTIFY PLAYER BAUEN ---
function initSpotifyPlayer() {
    if (!token) token = getValidToken();
    if (!token || !window.Spotify) return;

    if (spotifyPlayer) {
        try {
            spotifyPlayer.disconnect();
        } catch (e) {}
    }

    spotifyPlayer = new Spotify.Player({
        name: 'Guess The Song Web Player',
        getOAuthToken: cb => {
            const valid = getValidToken() || token;
            cb(valid);
        },
        volume: 0.5
    });

    spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('✅ Spotify Player ist bereit! Device ID:', device_id);
        deviceId = device_id;
        transferPlaybackToWebView(false);
    });

    spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('❌ Gerät offline', device_id);
    });

    spotifyPlayer.connect();
}

window.onSpotifyWebPlaybackSDKReady = () => {
    // Falls der Token schon da ist, direkt starten
    if (token) {
        initSpotifyPlayer();
    }
};

// --- 4b. RECONNECT & VISIBILITYCHANGE (wenn man aus der echten Spotify-App zurückkehrt) ---
function reconnectSpotifyOnResume() {
    const validToken = getValidToken() || token;
    if (!validToken) return;
    token = validToken;

    if (!spotifyPlayer) {
        if (window.Spotify) {
            initSpotifyPlayer();
        }
        return;
    }

    if (typeof spotifyPlayer.activateElement === 'function') {
        spotifyPlayer.activateElement().catch(() => {});
    }

    spotifyPlayer.getCurrentState().then(state => {
        if (!state) {
            // Player ist nicht aktiv verbunden oder echte Spotify-App hat übernommen ->
            // Verbindung auffrischen und Playback zurück auf unsere deviceId holen
            console.log("🔄 Stelle Spotify Web Playback SDK nach App-Wechsel wieder her...");
            spotifyPlayer.connect().then(connected => {
                if (connected && deviceId) {
                    transferPlaybackToWebView(false);
                } else {
                    initSpotifyPlayer();
                }
            });
        } else if (deviceId) {
            transferPlaybackToWebView(false);
        }
    }).catch(() => {
        initSpotifyPlayer();
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        reconnectSpotifyOnResume();
    }
});

// --- 5. FUNKTIONEN FÜRS SPIEL ---
function spieleSong(spotifyUri, startSekunde) {
    if (!deviceId || !token || !spotifyPlayer) {
        console.error("⚠️ Spotify Player nicht bereit oder nicht eingeloggt!");
        return;
    }

    const startPunktMs = startSekunde * 1000; 
    console.log("Lade Song:", spotifyUri, "ab Sekunde:", startSekunde);

    // 1. Schauen, wie laut der Player gerade ist
    spotifyPlayer.getVolume().then(volume => {
        let aktuelleLautstaerke = volume;
        
        // Wenn er sowieso schon (fast) stumm ist, direkt loslegen
        if (aktuelleLautstaerke <= 0.05) {
            starteNeuenSong(spotifyUri, startPunktMs);
            return;
        }

        // 2. FADE-OUT EFFEKT (0,25 Sekunden)
        const outSchritte = 10;
        const outZeitProSchritt = 25; // 10 * 25ms = 250ms (0,25 Sekunden)
        const verringerung = aktuelleLautstaerke / outSchritte;

        const fadeOutInterval = setInterval(() => {
            aktuelleLautstaerke -= verringerung;
            
            if (aktuelleLautstaerke <= 0) {
                aktuelleLautstaerke = 0;
                clearInterval(fadeOutInterval); // Fade-Out stoppen
                
                // Jetzt ist es stumm -> Neuen Song laden!
                spotifyPlayer.setVolume(0).then(() => {
                    starteNeuenSong(spotifyUri, startPunktMs);
                });
            } else {
                spotifyPlayer.setVolume(aktuelleLautstaerke);
            }
        }, outZeitProSchritt);
    });
}

// Hilfsfunktion: Übernimmt das Laden und Einblenden (inkl. Auto-Retry falls die echte Spotify-App aktiv war)
function starteNeuenSong(spotifyUri, startPunktMs, isRetry = false) {
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
            uris: [spotifyUri], 
            position_ms: startPunktMs 
        }),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
    }).then(async response => {
        if (!response.ok) {
            console.warn("Spotify Play Fehler:", response.status);
            // Falls die echte Spotify-App die Kontrolle gestohlen hat (404/403), Playback übertragen & 1x wiederholen
            if (!isRetry) {
                await transferPlaybackToWebView(false);
                setTimeout(() => starteNeuenSong(spotifyUri, startPunktMs, true), 350);
            }
            return;
        }
        
        // 3. FADE-IN EFFEKT (1 Sekunde)
        let aktuelleLautstaerke = 0;
        const zielLautstaerke = 0.5; // Standard-Lautstärke (50%)
        const schritte = 20;
        const zeitProSchritt = 50; // 20 * 50ms = 1000ms (1 Sekunde)
        const erhoehung = zielLautstaerke / schritte;

        const fadeInInterval = setInterval(() => {
            aktuelleLautstaerke += erhoehung;
            
            if (aktuelleLautstaerke >= zielLautstaerke) {
                aktuelleLautstaerke = zielLautstaerke;
                clearInterval(fadeInInterval);
            }
            spotifyPlayer.setVolume(aktuelleLautstaerke);
        }, zeitProSchritt);
    });
}

function stoppeSpotify(mitFadeOut = false) {
    if (!spotifyPlayer) return;

    if (!mitFadeOut) {
        spotifyPlayer.pause().then(() => {
            console.log('⏸️ Spotify pausiert!');
        });
        return;
    }

    // Sanfter Fade-Out über ~300ms
    spotifyPlayer.getVolume().then(volume => {
        let vol = volume;
        if (vol <= 0.05) {
            spotifyPlayer.pause();
            return;
        }

        const schritte = 10;
        const zeitProSchritt = 30; // 10 * 30ms = 300ms
        const dec = vol / schritte;

        const fadeOut = setInterval(() => {
            vol -= dec;
            if (vol <= 0) {
                clearInterval(fadeOut);
                spotifyPlayer.setVolume(0).then(() => {
                    spotifyPlayer.pause();
                });
            } else {
                spotifyPlayer.setVolume(vol);
            }
        }, zeitProSchritt);
    });
}
