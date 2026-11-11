// ==========================================
// PASTE YOUR PUBLISHED GOOGLE SHEET CSV LINK BELOW
// ==========================================
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTIiNZJqanEu9X11xB4jfOcq9R9NP1JpU1KLHXiXkl1I7gTQeVHm-sXxArB_nvUkvPK2C74BNaTkaay/pub?gid=1299531799&single=true&output=csv";

const CONFIG = {
  STARTING_ELO: 1000,
  K_FACTOR: 32,
  KILL_BONUS: 2
};

let allPlayers = [];
let recentMatches = [];
let currentMode = "overall";

// Looks for assets/PLAYERNAME.PNG first, and falls back to assets/default-skin.png
function getAvatarHtml(playerName) {
  const fileName = playerName.toUpperCase().trim().replace(/\s+/g, "_");
  return `<img class="avatar-img" src="assets/${fileName}.PNG" onerror="this.onerror=null; this.src='assets/default-skin.png';" alt="${playerName}" />`;
}


// Parse CSV cleanly even when match strings contain commas inside quotes
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function parseMatchString(str) {
  const rankGroups = str.split(",");
  const results = [];

  rankGroups.forEach((group, rankIndex) => {
    const tiedPlayers = group.split("=");
    tiedPlayers.forEach(entry => {
      const clean = entry.trim();
      if (!clean) return;

      const parts = clean.split(":");
      const name = parts[0].trim();
      const kills = parts.length > 1 ? (parseInt(parts[1].trim(), 10) || 0) : 0;

      if (name) {
        results.push({
          name,
          kills: Math.max(0, kills),
          rank: rankIndex + 1
        });
      }
    });
  });

  return results;
}

function computeMultiplayerElo(lobby, players, eloField) {
  const n = lobby.length;
  const deltas = {};
  const scaleFactor = CONFIG.K_FACTOR / (n - 1);

  lobby.forEach(playerA => {
    const keyA = playerA.name.toLowerCase();
    const ratingA = players[keyA][eloField];
    let totalChange = 0;

    lobby.forEach(playerB => {
      const keyB = playerB.name.toLowerCase();
      if (keyA === keyB) return;

      const ratingB = players[keyB][eloField];
      const expectedScore = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

      let actualScore = 0.5;
      if (playerA.rank < playerB.rank) actualScore = 1;
      else if (playerA.rank > playerB.rank) actualScore = 0;

      totalChange += scaleFactor * (actualScore - expectedScore);
    });

    totalChange += playerA.kills * CONFIG.KILL_BONUS;
    deltas[keyA] = totalChange;
  });

  return deltas;
}

function getTierBadge(elo) {
  if (elo >= 1450) return "HT1";
  if (elo >= 1350) return "LT1";
  if (elo >= 1275) return "HT2";
  if (elo >= 1200) return "LT2";
  if (elo >= 1125) return "HT3";
  if (elo >= 1050) return "LT3";
  if (elo >= 975)  return "HT4";
  if (elo >= 900)  return "LT4";
  if (elo >= 825)  return "HT5";
  return "LT5";
}

function processMatches(rows) {
  const players = {};
  const history = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const timestamp = row[0] || "";
    const mode = (row[1] || "").trim();
    const matchStr = (row[2] || "").trim();

    if (!matchStr) continue;
    const lobby = parseMatchString(matchStr);
    if (lobby.length < 2) continue;

    lobby.forEach(p => {
      const key = p.name.toLowerCase();
      if (!players[key]) {
        players[key] = {
          name: p.name,
          overall: CONFIG.STARTING_ELO,
          sw: CONFIG.STARTING_ELO,
          bw: CONFIG.STARTING_ELO,
          wins: 0,
          games: 0,
          kills: 0
        };
      }
    });

    const overallDeltas = computeMultiplayerElo(lobby, players, "overall");
    const modeKey = mode.toLowerCase().includes("bed") ? "bw" : "sw";
    const modeDeltas = computeMultiplayerElo(lobby, players, modeKey);

    lobby.forEach(p => {
      const key = p.name.toLowerCase();
      players[key].overall = Math.round(players[key].overall + overallDeltas[key]);
      players[key][modeKey] = Math.round(players[key][modeKey] + modeDeltas[key]);
      players[key].games += 1;
      players[key].kills += p.kills;
      if (p.rank === 1) players[key].wins += 1;
    });

    history.unshift({ timestamp, mode: mode || "Match", matchStr });
  }

  allPlayers = Object.values(players);
  recentMatches = history.slice(0, 10);
}

function renderLeaderboard() {
  const tbody = document.getElementById("leaderboardBody");
  const search = document.getElementById("searchInput").value.toLowerCase().trim();

  const sorted = [...allPlayers]
    .filter(p => p.name.toLowerCase().includes(search))
    .sort((a, b) => b[currentMode] - a[currentMode]);

  tbody.innerHTML = sorted.map((p, idx) => {
    const rank = idx + 1;
    const elo = p[currentMode];
    const tier = getTierBadge(elo);
    const winRate = p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;
    const rankClass = rank <= 3 ? `rank-${rank}` : "";

    return `
      <tr>
        <td class="rank-num ${rankClass}">#${rank}</td>
        <td>
          <div class="player-cell">
            ${getAvatarHtml(p.name)}
            <span>${p.name}</span>
          </div>
        </td>
        <td><span class="badge ${tier}">${tier}</span></td>
        <td class="elo-val">${elo}</td>
        <td>${p.wins}</td>
        <td>${p.kills}</td>
        <td>${winRate}%</td>
      </tr>
    `;
  }).join("");
}

function renderRecentMatches() {
  const container = document.getElementById("recentMatches");
  if (!recentMatches.length) {
    container.innerHTML = `<div class="match-card">No matches logged yet!</div>`;
    return;
  }

  container.innerHTML = recentMatches.map(m => `
    <div class="match-card">
      <div><span class="match-mode">[${m.mode}]</span> ${m.matchStr}</div>
      <div style="color: var(--text-muted); font-size: 0.8rem;">${m.timestamp}</div>
    </div>
  `).join("");
}

async function loadData() {
  const statusEl = document.getElementById("statusMsg");
  statusEl.style.display = "block";
  statusEl.textContent = "Loading live rankings...";

  try {
    const url = `${SHEET_CSV_URL}&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch Google Sheet CSV.");

    const csvText = await res.text();
    const rows = parseCSV(csvText);
    processMatches(rows);

    statusEl.style.display = allPlayers.length ? "none" : "block";
    if (!allPlayers.length) {
      statusEl.textContent = "Connected! Submit your first match on the Google Form to appear here.";
    }

    renderLeaderboard();
    renderRecentMatches();
  } catch (err) {
    statusEl.textContent = "Error loading sheet. Double-check that your Google Sheet is Published to Web as CSV.";
    console.error(err);
  }
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    renderLeaderboard();
  });
});

document.getElementById("searchInput").addEventListener("input", renderLeaderboard);
document.getElementById("refreshBtn").addEventListener("click", loadData);

loadData();
