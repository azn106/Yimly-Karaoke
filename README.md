# Yimly

A lightweight, self-hosted karaoke media server and web application. Yimly indexes your local karaoke tracks (MP3 and LRC files) without duplicating them, and enables real-time synchronized lyrics display and mobile queue management via WebSockets.

---

## Production Deployment (Docker & Cloudflare Tunnel)

Yimly is pre-configured with Docker and Docker Compose for production deployment, securely integrated with the external Cloudflare Docker network (`cloudflared_bridge`).

### Network Architecture & Routing

```text
Public Domain
    ↓
Cloudflare Tunnel
    ↓
cloudflared_bridge (External Docker Network)
    ↓
Yimly (Network Alias: yimly)
    ↓
http://yimly:3000
```

* **Cloudflare Tunnel Target:** Configure your Cloudflare Tunnel service target to `http://yimly:3000`.
* **External Network:** Yimly attaches to the existing external Docker network `cloudflared_bridge` with the network alias `yimly`. No host ports are published; internal traffic is routed securely via Docker bridge networking.
* **WebSockets:** Real-time WebSocket connections for lyrics synchronization and queue management operate seamlessly through the Cloudflare public domain.

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with Docker Compose)
* [Git](https://git-scm.com/)
* External Cloudflare network `cloudflared_bridge` pre-created by infrastructure.

---

### Initial Setup (Windows)

1. **Clone the repository:**
   ```bash
   git clone <repository_url> yimly
   cd yimly
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and configure your settings:
   ```bash
   copy .env.example .env
   ```
   Edit `.env` and set a strong `JWT_SECRET`:
   ```env
   JWT_SECRET=your_long_random_secret_here
   DATA_PATH=./data
   MEDIA_PATH=./media
   ```

3. **Deploy Yimly:**
   Double-click `deploy-yimly.bat` or run:
   ```cmd
   deploy-yimly.bat
   ```

   This script will:
   * Verify Docker & Docker Compose
   * Verify the existence of the external `cloudflared_bridge` network
   * Create `./data` and `./media` directories (preserving any existing data)
   * Build the Docker image
   * Start the container in detached mode on `cloudflared_bridge`
   * Verify container health status

4. **Access the application:**
   * Access Yimly securely via your configured Cloudflare Tunnel domain.
   * On first run, create your initial Administrator account.

---

### Updating Yimly (Windows 1-Click Update)

Whenever you push new changes or bugfixes to your GitHub repository, update your production server simply by running:

```cmd
update-yimly.bat
```

Or double-click `update-yimly.bat` in File Explorer.

**What the update script does:**
1. Pulls the latest code from GitHub (`git pull`)
2. Rebuilds the Docker image (`docker compose build`)
3. Restarts the container with minimal downtime (`docker compose up -d`)
4. Cleans up obsolete build artifacts safely (`docker image prune -f`)
5. Verifies container health

> **Note on Data Safety:** The update script **never** deletes or resets your SQLite database (`./data/yimly.db`) or media library (`./media`).

---

### Manual Docker Deployment (Linux / macOS)

To deploy or update on Linux/macOS:

```bash
# First time deployment (ensure cloudflared_bridge network exists)
docker network inspect cloudflared_bridge
mkdir -p data media
cp .env.example .env
# Edit .env and configure JWT_SECRET
docker compose -f compose.yaml up -d --build

# Updating
git pull
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d
docker image prune -f
```

---

## Directory Architecture & Persistence

```text
yimly/
├── data/                  # Persistent SQLite database (mapped to /app/data in container)
│   └── yimly.db
├── media/                 # Karaoke audio & lyrics directory (mapped to /media:ro in container)
│   ├── Artist - Title.mp3
│   ├── Artist - Title (Instrumental).mp3
│   └── Artist - Title.lrc
├── Dockerfile             # Multi-stage production container definition
├── compose.yaml           # Authoritative Docker Compose configuration
├── deploy-yimly.bat       # Windows initial deployment script
├── update-yimly.bat       # Windows 1-click update script
├── .env                   # Local secrets (git-ignored)
└── .env.example           # Example environment template
```

### Media Library Organization

Yimly scans and indexes your files without copying them into the database. Place your media in `./media/` with standard naming conventions:

* Main audio: `Artist - Title.mp3`
* Instrumental audio: `Artist - Title (Instrumental).mp3`
* Synchronized lyrics: `Artist - Title.lrc`

In the Yimly Web UI, go to **Settings > Media Libraries**, enter `/media` as the Folder Path, and click **Scan**.

---

## Private GitHub Repository Setup

To allow `update-yimly.bat` to pull from a private GitHub repository without typing credentials every time:

1. **HTTPS with Git Credential Manager (Default on Windows):**
   * Run `git pull` manually once in the terminal.
   * Sign in via your browser or paste a GitHub Personal Access Token (PAT with `repo` scope).
   * Windows Credential Manager will securely store your token for all future automated updates.

2. **SSH Key Authentication:**
   * Generate an SSH key: `ssh-keygen -t ed25519 -C "your_email@example.com"`
   * Add the public key (`~/.ssh/id_ed25519.pub`) to your GitHub account under **Settings > SSH and GPG keys**.
   * Set your remote to SSH: `git remote set-url origin git@github.com:username/yimly.git`
