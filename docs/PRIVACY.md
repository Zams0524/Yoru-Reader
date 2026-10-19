# Privacy policy

Yoru Reader stores your books, vocabulary, review history, statistics and settings **on your own device**. It has no account system and collects no analytics or telemetry.

The app only sends data to other services in the situations below. Apart from the update check and loading fonts, each one happens only when you use that feature.

| Service | When it is contacted | What is sent |
| :--- | :--- | :--- |
| **GitHub** (`raw.githubusercontent.com`, `github.com`) | Checking for and downloading updates | A request for the public update manifest or installer; no personal data |
| **Google Drive** (`googleapis.com`, `accounts.google.com`) | Only if you connect Google Drive for backup and sync | Your backup file, stored in your own Google Drive; access is limited to files the app creates (`drive.file`) |
| **Microsoft Edge text-to-speech** (`speech.platform.bing.com`) | When you use read-aloud on desktop | The text being read aloud |
| **Azure Speech** (`*.tts.speech.microsoft.com`) | Only if you enter your own Azure key | The text being read aloud |
| **Google Translate text-to-speech** (`translate.google.com`) | When you play audio for a dictionary word | The word being pronounced |
| **Jiten** (`api.jiten.moe`, sometimes through `api.allorigins.win`) | When a word is not found in the built-in dictionaries | The word being looked up |
| **jpdb.io** | Only if you enter your jpdb API key to import decks | Your API key and deck requests |
| **AnkiConnect** (`127.0.0.1`) | Only if you use Anki integration | Cards you create, sent to Anki on your own computer |
| **Discord** (local Discord client) | Only if you enable Discord Rich Presence | The book and chapter title shown on your Discord profile (books can be excluded with the blacklist) |
| **Font CDN** (`migaku-public-data.migaku.com`) | When the app starts | A request for the interface fonts; no personal data |

Each of these services handles requests under its own privacy policy.

## Uninstalling

- **Windows:** Settings → Apps → Yoru Reader → Uninstall (or the uninstaller in the install folder).
- **Android:** long-press the app → Uninstall.
- **Linux (Flatpak):** `flatpak uninstall com.yorureader.app`

Uninstalling removes the app. Your local data can be deleted from inside the app with **Settings → Data → Danger Zone** before uninstalling.

Questions: <https://github.com/Zams0524/Yoru-Reader/issues>
