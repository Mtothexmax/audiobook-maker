https://mtothexmax.github.io/audiobook-maker/



# Audiobook Studio — Svelte

Dark-theme Audiobook-Editor mit **echter Fish-Audio-TTS-Generierung** und
Web-Audio-Wiedergabe, gebaut mit **Svelte 5 (runes)** + Tailwind CSS 4 +
Material Symbols Rounded + [facesjs](https://github.com/zengm-games/facesjs)
(Speaker-Avatare).

## Audio & Generierung (echt, kein Mockup mehr)

- **Render** ruft den Server-Endpoint `/api/tts` auf, der die Fish-Audio-API
  (`POST https://api.fish.audio/v1/tts`) anspricht und die Audio-Bytes zurückgibt.
- Die Bytes werden mit der **Web Audio API** dekodiert; die echte Wellenform wird
  aus den Samples berechnet (Peak-Envelope), die Dauer kommt aus dem Buffer.
- **Play** startet eine echte Wiedergabe: alle gerenderten Clips werden auf dem
  Timeline-Zeitstrahl eingeplant, mit **Fade-In/Fade-Out** als Gain-Hüllkurven und
  Mute pro Lane. Der Playhead läuft synchron zur AudioClock.
- **Play** im Clip-Editor spielt nur den einen Clip vor.
- Text- oder Voice-Änderungen machen gerendertes Audio **stale** — es wird
  verworfen und muss neu gerendert werden, damit nie veraltetes Audio läuft.
- Die App-Direktiven-Syntax wird vor dem Senden in Fish-Cue-Syntax übersetzt
  (`[emotion:whisper]` → `[whisper]`, `[pause:0.4]` → `[pause]`).

### API-Key

Der Key gehört **nicht** ins Browser-Bundle. Zwei Wege:

1. **Empfohlen (Server):** `FISH_AUDIO_API_KEY` in `.env` setzen (siehe
   `.env.example`). Der Key bleibt auf dem Server.
2. **Prototyping (Client):** Key im Settings-Dialog eintragen — er wird in
   `localStorage` gehalten und vom Server-Proxy durchgereicht. Nur für lokale
   Entwicklung gedacht.

Das Modell ist im Settings-Dialog wählbar (Default `s2.1-pro-free`).

## Features

- **Timeline mit generischen Lanes** — keine typgebundenen Spuren:
  - Jeder Clip (Dialog **oder** Sound) kann per Drag auf **jede** Lane gezogen werden.
  - Sound-Library in der Sidebar: Presets per Drag&Drop auf beliebige Lane, Klick fügt
    sie der Lane des selektierten Clips hinzu; pro Lane gibt's zusätzlich „+ line" / „+ sound".
  - **Mute-Button pro Lane** mutet alle Clips der Lane (Clips werden gedimmt und im
    Playback übersprungen).
  - **„Render all"** rendert alle offenen Dialog-Clips nacheinander.
- **Clips wie in Magix Video Deluxe**:
  - Drag-Punkte **oben** (Cyan-Kreise) → Fade-In/Fade-Out (mit Overlay-Dreieck im Clip).
  - Drag-Punkte **unten** (Amber-Tabs) → Cutter/Trimmen (Start/Ende).
  - Unrendered Clips: gestrichelt, Länge **geschätzt aus Textlänge**, keine Drag-Punkte.
  - Doppelklick öffnet den Editor; Zoom (Slider/Buttons), Playhead, Ruler mit Ticks.
- **Clip-Editor (unten)**:
  - Character wechseln, Text mit **Fish-Audio-Direktiven** `[emotion:x]`, `[pause:x]`,
    `[emphasis]`, `[speed:x]` — per Chip am Cursor einfügen und im Preview farbig
    hervorgehoben (Pause=amber, Emotion=violet, Emphasis=cyan, Speed=emerald).
  - Render/Regenerate (echt), Play (Preview), Fehleranzeige, Audio-Effekte, Fades,
    Duplicate/Delete, Zeit-Info.
- **Characters-Tab**: facesjs-Avatare (Reroll-Button), Fish-Voice-ID, Farbe, Default-Emotion.
- **Export-Tab**: flaches, simples JSON (characters + tracks + clips mit Timing/Fades/Direktiven),
  Copy + Download.
- **Settings (Zahnrad im Header)**: Fish Audio API-Key + Modell — in
  `localStorage` gespeichert (Key `audioboook-maker:settings`) und nach Reload wiederhergestellt.

> Hinweis: Die mitgelieferten Demo-Sound-Clips (Rain, Thunder, ...) sind reine
> Timeline-Platzhalter ohne Audiodatei — sie klingen nicht, haben aber echte
> Länge/Waveform für die Anordnung. Echte Geräusch-Assets sind nicht Teil dieses
> Prototyps. Dialog-Clips werden über Fish Audio generiert und sind hörbar.

## Entwicklung

```sh
npm install
cp .env.example .env   # FISH_AUDIO_API_KEY eintragen (oder Key in den Settings)
npm run dev        # Dev-Server (User startet ihn selbst)
npm run check      # nur wenn kein Dev-Server läuft (svelte-kit sync EPERM auf Windows)
npx svelte-check --tsconfig ./tsconfig.json   # typsicher ohne sync
npm run build      # Production-Build
npm run preview    # Build lokal ansehen
```

## Struktur

- `src/lib/project.svelte.ts` — zentraler $state-Store: Projekt, Clips, Playback, Export, Settings
- `src/lib/audio.ts` — Web-Audio-Engine: Synth-Client, Dekodieren, Scheduling, Fades, Peaks
- `src/routes/api/tts/+server.ts` — Server-Proxy zur Fish-Audio-TTS-API (Key bleibt serverseitig)
- `src/lib/tags.ts` — Fish-Audio-Tag-Parsing, Dauer-Schätzung, Highlight-Rendering, Cue-Übersetzung
- `src/lib/waveform.ts` — deterministische Waveform-Generierung (nur für ungerenderte Clips)
- `src/lib/components/` — Header, TimelineView, Lane, Clip, EditorPanel, CharactersView,
  ExportView, SettingsModal, Avatar (facesjs)
