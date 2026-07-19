const app = document.querySelector("#app");
const query = new URLSearchParams(location.search);
const invite = query.get("invite");
const master = query.get("master");

let mine = JSON.parse(localStorage.getItem("gn-player") || "null");
let tournament;

const api = async (action, body = {}) => {
  const response = await fetch(`/api/${invite}/${action}`, {
    method: action === "state" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: action === "state" ? undefined : JSON.stringify({ ...body, master })
  });

  const result = await response.json();

  if (!response.ok || result.error) throw new Error(result.error || "Request failed");

  return result;
};

const name = (id) => tournament.players.find((p) => p.id === id)?.name || "TBD";
const me = () => mine && tournament.players.find((p) => p.id === mine.id);

async function load() {
  try {
    if (!invite) return home();
    tournament = await api("state");
    render();
  } catch (error) {
    app.innerHTML = `<div class="card"><h1>Game Night Live</h1><p>${error.message}</p><button onclick="load()">Try again</button></div>`;
  }
}

function home() {
  app.innerHTML = `<div class="card"><h1>Game Night Live</h1><button onclick="create()">Create tournament</button></div>`;
}

async function create() {
  const result = await fetch("/api/create", { method: "POST" }).then((r) => r.json());
  location.href = `?invite=${result.invite}&master=${result.master}`;
}

function playerList() {
  return [...tournament.players]
    .sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses))
    .map((p, index) => `
      <div class="${p.id === me()?.id ? "me" : ""}">
        ${index + 1}. ${p.name} - ${p.wins}W / ${p.losses}L
      </div>
    `).join("");
}

function pointsList() {
  return [...tournament.players]
    .sort((a, b) => b.points - a.points)
    .map((p, index) => `
      <div class="${p.id === me()?.id ? "me" : ""}">
        ${index + 1}. ${p.name} - ${p.points} points
      </div>
    `).join("");
}

function bracket(stage, title) {
  const matches = tournament.matches.filter((m) => m.stage === stage);

  return `
    <div class="card">
      <h2>${title}</h2>
      ${matches.length
        ? matches.map(matchView).join("")
        : "<p class='hint'>Revealed after pool play.</p>"
      }
    </div>
  `;
}

function matchView(match) {
  const isMaster = Boolean(master);

  return `
    <div class="match ${match.status === "live" ? "live" : ""}">
      <strong class="${match.a === me()?.id ? "me" : ""}">${name(match.a)}</strong>
      vs
      <strong class="${match.b === me()?.id ? "me" : ""}">${name(match.b)}</strong>
      <br>
      <span class="hint">${match.label} - ${match.status}</span>

      ${match.characters
        ? `<br>${match.characters[match.a]} vs ${match.characters[match.b]}`
        : ""
      }

      ${isMaster && match.status === "ready"
        ? `<button onclick="startGame('${match.id}')">Start game</button>`
        : ""
      }

      ${isMaster && match.status === "live"
        ? `
          <button onclick="winner('${match.id}', '${match.a}')">${name(match.a)} won</button>
          <button onclick="winner('${match.id}', '${match.b}')">${name(match.b)} won</button>
        `
        : ""
      }
    </div>
  `;
}

function betPanel() {
  const player = me();
  const ready = tournament.matches.find(
    (m) => m.status === "ready" && ![m.a, m.b].includes(player?.id)
  );

  if (!player || !ready || tournament.phase === "registration") return "";

  return `
    <div class="card">
      <h2>Place a bet</h2>
      <p>${name(ready.a)} vs ${name(ready.b)}</p>

      <select id="betPick">
        <option value="${ready.a}">${name(ready.a)}</option>
        <option value="${ready.b}">${name(ready.b)}</option>
      </select>

      <input id="betStake" type="number" min="1" max="${player.points}" value="10">
      <button onclick="bet('${ready.id}')">Place bet</button>
    </div>
  `;
}

function render() {
  const player = me();
  const isMaster = Boolean(master);
  const inviteLink = `${location.origin}${location.pathname}?invite=${invite}`;

  app.innerHTML = `
    <div class="card">
      <h1>${isMaster ? "Game Master" : "Tournament"} Lobby</h1>
      <p class="hint">Status: ${tournament.phase}</p>

      ${tournament.champion
        ? `<h2>Champion: ${name(tournament.champion)}</h2>`
        : ""
      }

      ${isMaster ? `
        <label>Player invite link</label>
        <input readonly value="${inviteLink}" onclick="this.select()">

        <h2>Joining participants (${tournament.players.length})</h2>
        ${tournament.players.map((p) => `
          <div>${p.name} - ${p.characters.length === 5 ? "ready" : "needs characters"}</div>
        `).join("")}

        ${tournament.phase === "registration" ? `
          <hr>
          <input id="manualName" placeholder="Manual player name">
          <input id="manualCharacters" placeholder="Mario, Link, Kirby, Samus, Fox">
          <button onclick="add()">Add player</button>
          <button onclick="start()">Start tournament</button>
        ` : ""}
      ` : ""}

      ${!player ? `
        <h2>Join tournament</h2>
        <input id="joinName" placeholder="Your name">
        <button onclick="join()">Join tournament</button>
      ` : `
        <h2 class="me">${player.name}</h2>
        <p>${player.points} betting points</p>

        ${tournament.phase === "registration" ? `
          <input id="myCharacters" value="${player.characters.join(", ")}" placeholder="Mario, Link, Kirby, Samus, Fox">
          <button onclick="characters()">Save five characters</button>
        ` : ""}
      `}
    </div>

    ${betPanel()}

    <div class="card">
      <h2>Game leaderboard</h2>
      ${playerList()}
    </div>

    <div class="card">
      <h2>Betting leaderboard</h2>
      ${pointsList()}
    </div>

    <div class="card">
      <h2>Pool matches</h2>
      ${tournament.matches.filter((m) => m.stage === "pool").map(matchView).join("") || "<p class='hint'>Not started.</p>"}
    </div>

    ${bracket("winner", "Winners Bracket")}
    ${bracket("loser", "Losers Bracket")}
    ${bracket("final", "Grand Final")}
  `;
}

async function join() {
  try {
    const result = await api("join", { name: document.querySelector("#joinName").value.trim() });
    localStorage.setItem("gn-player", JSON.stringify(result));
    location.reload();
  } catch (error) {
    alert(error.message);
  }
}

async function characters() {
  try {
    const characters = document.querySelector("#myCharacters").value.split(",").map((x) => x.trim()).filter(Boolean);
    await api("characters", { id: mine.id, key: mine.key, characters });
    load();
  } catch (error) {
    alert(error.message);
  }
}

async function add() {
  try {
    const name = document.querySelector("#manualName").value.trim();
    const characters = document.querySelector("#manualCharacters").value.split(",").map((x) => x.trim()).filter(Boolean);
    await api("add", { name, characters });
    load();
  } catch (error) {
    alert(error.message);
  }
}

async function start() {
  try {
    await api("start");
    load();
  } catch (error) {
    alert(error.message);
  }
}

async function startGame(match) {
  try {
    await api("go", { match });
    load();
  } catch (error) {
    alert(error.message);
  }
}

async function winner(match, winner) {
  try {
    await api("win", { match, winner });
    load();
  } catch (error) {
    alert(error.message);
  }
}

async function bet(match) {
  try {
    const player = me();
    const stake = Number(document.querySelector("#betStake").value);

    if (player.points <= 0) {
      alert("You cannot place a bet because you have no points left.");
      return;
    }

    if (!Number.isInteger(stake) || stake < 1) {
      alert("Enter a valid stake of at least 1 point.");
      return;
    }

    if (stake > player.points) {
      alert(`You only have ${player.points} points available.`);
      return;
    }

    await api("bet", {
      match,
      id: mine.id,
      key: mine.key,
      pick: document.querySelector("#betPick").value,
      stake
    });

    alert("Bet placed. Your stake has been deducted.");
    load();
  } catch (error) {
    alert(error.message);
  }
}

Object.assign(window, {
  load, create, join, characters, add, start,
  startGame, winner, bet
});

if (invite) {
  setInterval(() => {
    if (!document.activeElement?.matches("input, select")) load();
  }, 5000);
}

load();