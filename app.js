// ==========================================
// PASTE YOUR PUBLISHED GOOGLE SHEET CSV LINK BELOW
// ==========================================
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTIiNZJqanEu9X11xB4jfOcq9R9NP1JpU1KLHXiXkl1I7gTQeVHm-sXxArB_nvUkvPK2C74BNaTkaay/pub?gid=1299531799&single=true&output=csv";

const CONFIG = {
  STARTING_ELO: 1000,
  K_FACTOR: 32,
  KILL_BONUS: 2
};

// Map each tab's data-mode key to the keyword in your Google Sheet's Gamemode column
const GAMEMODES = {
  bw: "bed",
  sw: "sky",
  arena: "arena"
};

let allPlayers = [];
let allMatches = [];
let rawRows = [];
let pendingCount = 0;
let includeUnverified = false;
let currentMode = "overall";

// Automatically removes white/near-white background pixels from any PNG image
function makeTransparent(imgEl) {
  return;
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

function detectModeKey(modeText) {
  const lower = modeText.toLowerCase();
  for (const [key, keyword] of Object.entries(GAMEMODES)) {
    if (lower.includes(keyword)) return key;
  }
  return "sw";
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
  let unverifiedMatches = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const timestamp = row[0] || "";
    const mode = (row[1] || "").trim();
    const matchStr = (row[2] || "").trim();
    const isVerified = (row[4] || "").trim().toUpperCase() === "TRUE";

    if (!matchStr) continue;
    const lobby = parseMatchString(matchStr);
    if (lobby.length < 2) continue;

    if (!isVerified) {
      unverifiedMatches++;
      if (!includeUnverified) continue;
    }

    const modeKey = detectModeKey(mode);

    lobby.forEach(p => {
      const key = p.name.toLowerCase();
      if (!players[key]) {
        const stats = { overall: createModeStats() };
        Object.keys(GAMEMODES).forEach(k => {
          stats[k] = createModeStats();
        });
        players[key] = { name: p.name, stats };
      }
    });

    const overallDeltas = computeMultiplayerElo(lobby, players, "overall");
    const modeDeltas = computeMultiplayerElo(lobby, players, modeKey);

    lobby.forEach(p => {
      const key = p.name.toLowerCase();
      const pl = players[key];

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

    history.unshift({
      timestamp,
      mode: mode || "Match",
      modeKey,
      matchStr,
      isVerified
    });
  }

  pendingCount = unverifiedMatches;
  allPlayers = Object.values(players);
  allMatches = history;

  const pendingEl = document.getElementById("pendingCount");
  if (pendingEl) pendingEl.textContent = pendingCount;
}

function renderLeaderboard() {
  const tbody = document.getElementById("leaderboardBody");
  const search = document.getElementById("searchInput").value.toLowerCase().trim();

  const sorted = [...allPlayers]
    .filter(p => p.stats[currentMode].games > 0)
    .filter(p => p.name.toLowerCase().includes(search))
    .sort((a, b) => b.stats[currentMode].elo - a.stats[currentMode].elo);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No players found for this mode yet.</td></tr>`;
    return;
  }

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
      <tr onclick="openPlayerModal('${p.name.replace(/'/g, "\\'")}')">
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

function openPlayerModal(playerName) {
  const player = allPlayers.find(p => p.name.toLowerCase() === playerName.toLowerCase());
  if (!player) return;

  const modal = document.getElementById("playerModal");
  const content = document.getElementById("modalContent");
  const fileName = player.name.toUpperCase().trim().replace(/\s+/g, "_");
  const overall = player.stats.overall;
  const overallTier = getTierBadge(overall.elo);
  const overallWinRate = overall.games > 0 ? Math.round((overall.wins / overall.games) * 100) : 0;

  const modeLabels = [
    { key: "sw", label: "☁️ SkyWars" },
    { key: "bw", label: "🛏️ BedWars" },
    { key: "arena", label: "⚔️ PvP Arena" }
  ];

  const modeCardsHtml = modeLabels.map(m => {
    const s = player.stats[m.key];
    const tier = getTierBadge(s.elo);
    const wr = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;

    return `
      <div class="mode-box">
        <div class="mode-box-title">${m.label}</div>
        <div class="mode-box-row">
          <span class="badge ${tier}">${tier}</span>
          <span class="elo-val">${s.elo} ELO</span>
        </div>
        <div class="mode-box-sub">
          ${s.wins}W / ${s.games}G (${wr}%)<br/>
          ${s.kills} Kills • Streak: ${s.streak}
        </div>
      </div>
    `;
  }).join("");

  const playerMatches = allMatches
    .filter(m => m.matchStr.toLowerCase().includes(player.name.toLowerCase()))
    .slice(0, 5);

  const historyHtml = playerMatches.length
    ? playerMatches.map(m => `
        <div class="match-card" style="margin-bottom: 6px; padding: 8px 12px; font-size: 0.85rem;">
          <div>
            <span class="match-mode">[${m.mode}]</span> ${m.matchStr}
            ${!m.isVerified ? `<span class="badge-pending">PENDING</span>` : ""}
          </div>
          <div style="color: var(--text-muted); font-size: 0.75rem;">${m.timestamp}</div>
        </div>
      `).join("")
    : `<div style="color: var(--text-muted); font-size: 0.85rem;">No recent matches found.</div>`;

  content.innerHTML = `
    <div class="profile-header">
      <img
        class="profile-avatar"
        src="assets/${fileName}.PNG"
        onload="makeTransparent(this)"
        onerror="this.onerror=null; this.src='assets/default-skin.png';"
        alt="${player.name}"
      />
      <div class="profile-title">
        <h2>${player.name}</h2>
        <span class="badge ${overallTier}">Overall ${overallTier}</span>
        <span style="margin-left: 8px; font-weight: 700;">${overall.elo} ELO</span>
        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 6px;">
          ${overall.wins} Wins • ${overall.kills} Kills • ${overallWinRate}% Win Rate
        </div>
      </div>
    </div>

    <div class="mode-grid">${modeCardsHtml}</div>

    <div class="profile-history-title">Last 5 Matches</div>
    <div>${historyHtml}</div>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closePlayerModal() {
  const modal = document.getElementById("playerModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function renderRecentMatches() {
  const container = document.getElementById("recentMatches");
  const filtered = currentMode === "overall"
    ? allMatches
    : allMatches.filter(m => m.modeKey === currentMode);

  const visibleMatches = filtered.slice(0, 10);

  if (!visibleMatches.length) {
    container.innerHTML = `<div class="match-card">No matches logged for this mode yet!</div>`;
    return;
  }

  container.innerHTML = visibleMatches.map(m => `
    <div class="match-card">
      <div>
        <span class="match-mode">[${m.mode}]</span> ${m.matchStr}
        ${!m.isVerified ? `<span class="badge-pending">PENDING</span>` : ""}
      </div>
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
    rawRows = parseCSV(csvText);
    processMatches(rawRows);

    statusEl.style.display = allPlayers.length ? "none" : "block";
    if (!allPlayers.length) {
      statusEl.textContent = pendingCount > 0
        ? `${pendingCount} match(es) waiting for admin verification. Tick "Include Unverified" to preview.`
        : "Connected! Submit your first match on the Google Form to appear here.";
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
    renderRecentMatches();
  });
});

document.getElementById("searchInput").addEventListener("input", renderLeaderboard);
document.getElementById("refreshBtn").addEventListener("click", loadData);

document.getElementById("unverifiedToggle").addEventListener("change", e => {
  includeUnverified = e.target.checked;
  processMatches(rawRows);

  const statusEl = document.getElementById("statusMsg");
  statusEl.style.display = allPlayers.length ? "none" : "block";
  if (!allPlayers.length && pendingCount > 0) {
    statusEl.textContent = `${pendingCount} match(es) waiting for admin verification. Tick "Include Unverified" to preview.`;
  }

  renderLeaderboard();
  renderRecentMatches();
});

document.getElementById("closeModalBtn").addEventListener("click", closePlayerModal);
document.getElementById("playerModal").addEventListener("click", e => {
  if (e.target.id === "playerModal") closePlayerModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closePlayerModal();
});

loadData();
