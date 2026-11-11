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

// Automatically removes white/near-white background pixels from any PNG image
function makeTransparent(imgEl) {
  if (imgEl.dataset.cleaned) return;
  imgEl.dataset.cleaned = "true";

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = imgEl.naturalWidth || 64;
    canvas.height = imgEl.naturalHeight || 64;

    ctx.drawImage(imgEl, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Turn pure white and near-white pixels (R,G,B > 240) completely transparent
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
        data[i + 3] = 0;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    imgEl.src = canvas.toDataURL("image/png");
  } catch (e) {
    // Fallback safely if browser blocks pixel read
  }
}

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

function computeMultiplayerElo(lobby, players, modeKey) {
  const n = lobby.length;
  const deltas = {};
  const scaleFactor = CONFIG.K_FACTOR / (n - 1);

  lobby.forEach(playerA => {
    const keyA = playerA.name.toLowerCase();
    const ratingA = players[keyA].stats[modeKey].elo;
    let totalChange = 0;

    lobby.forEach(playerB => {
      const keyB = playerB.name.toLowerCase();
      if (keyA === keyB) return;

      const ratingB = players[keyB].stats[modeKey].elo;
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

function createModeStats() {
  return {
    elo: CONFIG.STARTING_ELO,
    wins: 0,
    games: 0,
    kills: 0,
    streak: 0
  };
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
          stats: {
            overall: createModeStats(),
            sw: createModeStats(),
            bw: createModeStats()
          }
        };
      }
    });

    const overallDeltas = computeMultiplayerElo(lobby, players, "overall");
    const isBedwars = mode.toLowerCase().includes("bed");
    const modeKey = isBedwars ? "bw" : "sw";
    const modeDeltas = computeMultiplayerElo(lobby, players, modeKey);

    lobby.forEach(p => {
      const key = p.name.toLowerCase();
      const pl = players[key];

      // Update both 'overall' and the specific gamemode ('sw' or 'bw')
      [
        { bucket: pl.stats.overall, delta: overallDeltas[key] },
        { bucket: pl.stats[modeKey], delta: modeDeltas[key] }
      ].forEach(({ bucket, delta }) => {
        bucket.elo = Math.round(bucket.elo + delta);
        bucket.games += 1;
        bucket.kills += p.kills;

        if (p.rank === 1) {
          bucket.wins += 1;
          bucket.streak += 1;
        } else {
          bucket.streak = 0;
        }
      });
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
    .sort((a, b) => b.stats[currentMode].elo - a.stats[currentMode].elo);

  tbody.innerHTML = sorted.map((p, idx) => {
    const rank = idx + 1;
    const modeStats = p.stats[currentMode];
    const elo = modeStats.elo;
    const tier = getTierBadge(elo);
    const winRate = modeStats.games > 0 ? Math.round((modeStats.wins / modeStats.games) * 100) : 0;
    const bannerClass = rank <= 3 ? `banner-${rank}` : "banner-default";
    const fileName = p.name.toUpperCase().trim().replace(/\s+/g, "_");
    const streakDisplay = modeStats.streak >= 2 ? `🔥 ${modeStats.streak}` : modeStats.streak;

    return `
      <tr>
        <td class="col-player">
          <div class="player-cell">
            <div class="rank-banner ${bannerClass}">
              <span class="banner-num">${rank}</span>
              <img 
                class="bust-img" 
                src="assets/${fileName}.PNG" 
                onload="makeTransparent(this)"
                onerror="this.onerror=null; this.src='assets/default-skin.png';" 
                alt="${p.name}" 
              />
            </div>
            <span class="player-name">${p.name}</span>
          </div>
        </td>
        <td><span class="badge ${tier}">${tier}</span></td>
        <td class="elo-val">${elo}</td>
        <td>${modeStats.wins}</td>
        <td>${modeStats.kills}</td>
        <td class="streak-val">${streakDisplay}</td>
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
