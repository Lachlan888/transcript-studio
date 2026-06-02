# Transcript Studio

Transcript Studio is a lightweight local Mac desktop app for turning local audio/video files or YouTube links into transcripts.

It is built with Electron, plain HTML/CSS/JavaScript, and local command-line tools. It does not use cloud services, accounts, API keys, a backend server, or a database.

## Required Tools

Transcript Studio uses the user's local system tools:

- `python3`
- `yt-dlp`
- `ffmpeg`
- `openai-whisper`, installed into Transcript Studio's private Python environment
- Homebrew, for automatic installation of `yt-dlp` and `ffmpeg`

The app does not bundle Python, Whisper, torch, ffmpeg, yt-dlp, or Whisper model files.
It does not install Whisper into the system Python environment.

## Automatic Setup

On launch, the app checks:

```sh
python3 --version
yt-dlp --version
ffmpeg -version
~/Library/Application\ Support/Transcript\ Studio/whisper-venv/bin/python -m whisper --help
brew --version
```

If Homebrew is installed, the setup screen can install missing `yt-dlp` and `ffmpeg` from inside the app. Homebrew itself is not installed automatically.

For Whisper, Transcript Studio creates and manages its own private virtual environment at:

```text
~/Library/Application Support/Transcript Studio/whisper-venv/
```

Whisper is installed there and run as:

```sh
~/Library/Application\ Support/Transcript\ Studio/whisper-venv/bin/python -m whisper
```

This avoids modifying the system Python installation and avoids Homebrew-managed Python's externally managed environment restrictions.

## Manual Setup

If automatic setup is unavailable, run:

```sh
brew install yt-dlp ffmpeg
mkdir -p "$HOME/Library/Application Support/Transcript Studio"
python3 -m venv "$HOME/Library/Application Support/Transcript Studio/whisper-venv"
"$HOME/Library/Application Support/Transcript Studio/whisper-venv/bin/python" -m pip install --upgrade pip
"$HOME/Library/Application Support/Transcript Studio/whisper-venv/bin/python" -m pip install -U openai-whisper
```

## Run In Development

```sh
npm install
npm start
```

## Package

Electron Builder is configured, so packaging can be attempted with:

```sh
npm run package
```

If packaging needs extra local signing or macOS configuration, use `npm start` for the working development app.

## Output

By default, transcript jobs are written under:

```text
~/Documents/Transcript Studio/
```

You can choose a different output folder in the app. The selected base output folder is saved in:

```text
~/Library/Application Support/Transcript Studio/settings.json
```

Each run creates a timestamped folder containing generated files such as:

- `transcript.txt`
- `transcript.vtt`, when available
- `transcript.srt`, when available
- downloaded YouTube audio, when Whisper is used for YouTube
- `metadata.json`

## Notes

- The first Whisper setup may take a while because torch and other dependencies are large.
- The first Whisper run may download the selected model.
- `medium` and `large` models can be slow on CPU.
- Transcripts should be checked against source audio before publication.
