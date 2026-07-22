const app = document.querySelector("#app");
const query = new URLSearchParams(location.search);

const invite = query.get("invite");
const master = query.get("master");

let mine = JSON.parse(
  localStorage.getItem(`game-night-${invite}`) || "null"
);

let data;

const api = async (action, body = {}) => {
  const response = await fetch(`/api/${invite}/${action}`, {
    method: action === "state" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body:
      action === "state"
        ? undefined
        : JSON.stringify({ ...body, master })
  });

  return response.json();
};

const esc = (text) =>
  String(text).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]
  );

const name = (id) =>
  data.players.find((player) => player.id === id)?.name || "TBD";

const minePlayer = () =>
  mine && data.players.find((player) => player.id === mine.id);

async function load() {
  if (!invite) {
    renderHome();
    return;
  }

  data = await api("state");

  if (data.error) {
    app.innerHTML = `
      <div class="card">
        <h1>Game Night Live</h1>
        <p>${esc(data.error)}</p>
      </div>
    `;
    return;
  }

  render();
}

function renderHome() {
  app.innerHTML = `
    <div class="card hero">
      <h1>Game Night Live</h1>
      <p>Create a private tournament and share its player link.</p>
      <button onclick="createTournament()">Create tournament</button>
    </div>
  `;
}

function charactersForm(player) {
  return `
    <div class="characters">
      <h3>Your five fighters</h3>
      <p class="hint">Pick five characters before your first match.</p>

      ${[0, 1, 2, 3, 4]
        .map(
          (index) => `
            <input
              id="fighter-${index}"
              value="${esc(player?.characters?.[index] || "")}"
              placeholder="Character ${index + 1}"
            >
          `
        )
        .join("")}

      <button onclick="saveCharacters()">Save characters</button>
    </div>
  `;
}

function matchCard(match) {
  const me = minePlayer();

  const canBet =
    me &&
    match.status === "ready" &&
    ![match.a, match.b].includes(me.id);

  return `
    <article class="match ${match.status}">
      <div>
        <strong class="${match.a === me?.id ? "me" : ""}">
          ${esc(name(match.a))}
        </strong>

        <span>vs</span>

        <strong class="${match.b === me?.id ? "me" : ""}">
          ${esc(name(match.b))}
        </strong>
      </div>

      <small>${esc(match.stage)} - ${esc(match.status)}</small>

      ${
        match.characters
          ? `
            <p class="fighters">
              ${esc(match.characters[match.a])}
              vs
              ${esc(match.characters[match.b])}
            </p>
          `
          : ""
      }

      ${
        canBet
          ? `
            <div class="bet">
              <select id="pick-${match.id}">
                <option value="${match.a}">${esc(name(match.a))}</option>
                <option value="${match.b}">${esc(name(match.b))}</option>
              </select>

              <input
                id="stake-${match.id}"
                type="number"
                min="1"
                max="${me.points}"
                placeholder="Points"
              >

              <button onclick="placeBet('${match.id}')">Bet</button>
            </div>
          `
          : ""
      }

      ${
        master && match.status === "ready"
          ? `
            <button onclick="startMatch('${match.id}')">
              Start game (close betting)
            </button>
          `
          : ""
      }

      ${
        master && match.status === "live"
          ? `
            <div class="winner-buttons">
              <button onclick="setWinner('${match.id}', '${match.a}')">
                ${esc(name(match.a))} won
              </button>

              <button onclick="setWinner('${match.id}', '${match.b}')">
                ${esc(name(match.b))} won
              </button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function render() {
  const me = minePlayer();

  const upcomingMatches = data.matches.filter(
    (match) => match.status !== "done"
  );

  const myMatch = upcomingMatches.find(
    (match) => me && [match.a, match.b].includes(me.id)
  );

  const wait = myMatch ? upcomingMatches.indexOf(myMatch) : null;

  const bettingRanking = [...data.players].sort(
    (a, b) => b.points - a.points || b.wins - a.wins
  );

  const masterPanel = master
    ? `
      <section class="card">
        <h2>Game master</h2>

        <p>
          <b>Player invite link</b><br>
          <code>${location.origin}${location.pathname}?invite=${invite}</code>
        </p>

        <button onclick="copyInvite()">Copy player invite link</button>

        ${
          data.phase === "registration"
            ? `
              <hr>
              <h3>Add player without a phone</h3>

              <input id="manual-name" placeholder="Name">

              ${[0, 1, 2, 3, 4]
                .map(
                  (index) => `
                    <input
                      id="manual-fighter-${index}"
                      placeholder="Character ${index + 1}"
                    >
                  `
                )
                .join("")}

              <button onclick="addPlayer()">Add player</button>
              <button onclick="startTournament()">Start tournament</button>
            `
            : ""
        }

        ${
          data.phase !== "stopped"
            ? `
              <hr>
              <button class="danger" onclick="stopTournament()">
                Stop tournament
              </button>
            `
            : ""
        }
      </section>
    `
    : "";

  app.innerHTML = `
    <header>
      <h1>Game Night Live</h1>
      <p class="hint">${esc(data.phase)}</p>
    </header>

    ${
      data.stopped
        ? `
          <div class="notice">
            The game master has stopped this tournament.
          </div>
        `
        : ""
    }

    ${
      !me && data.phase === "registration"
        ? `
          <section class="card">
            <h2>Join tournament</h2>
            <input id="join-name" placeholder="Your name">
            <button onclick="joinTournament()">Join tournament</button>
          </section>
        `
        : ""
    }

    ${
      me
        ? `
          <section class="card">
            <h2 class="me">${esc(me.name)}</h2>

            <p>
              <b>${me.points}</b> betting points ·
              <b>${me.wins}</b> wins ·
              <b>${me.losses}</b> losses
            </p>

            <p>
              ${
                myMatch
                  ? `
                    Your next game:
                    <b>${esc(name(myMatch.a))} vs ${esc(name(myMatch.b))}</b>
                    <br>
                    Matches to wait: <b>${wait}</b>
                  `
                  : "No upcoming game assigned to you."
              }
            </p>

            ${charactersForm(me)}
          </section>
        `
        : ""
    }

    ${masterPanel}

    <section class="card">
      <h2>Upcoming games</h2>
      ${
        upcomingMatches.length
          ? upcomingMatches.map(matchCard).join("")
          : "<p>No upcoming games.</p>"
      }
    </section>

    <section class="card">
      <h2>Betting leaderboard</h2>
      <ol>
        ${bettingRanking
          .map(
            (player) => `
              <li class="${player.id === me?.id ? "me" : ""}">
                ${esc(player.name)} - ${player.points} points
              </li>
            `
          )
          .join("")}
      </ol>
    </section>

    <section class="card">
      <h2>Game leaderboard</h2>
      <ol>
        ${[...data.players]
          .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
          .map(
            (player) => `
              <li class="${player.id === me?.id ? "me" : ""}">
                ${esc(player.name)} - ${player.wins}W / ${player.losses}L
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  `;
}

async function createTournament() {
  const response = await fetch("/api/create", {
    method: "POST"
  });

  const tournament = await response.json();

  location.href =
    `?invite=${tournament.invite}&master=${tournament.master}`;
}

async function joinTournament() {
  const response = await api("join", {
    name: document.querySelector("#join-name").value
  });

  if (response.error) return alert(response.error);

  mine = response;

  localStorage.setItem(
    `game-night-${invite}`,
    JSON.stringify(response)
  );

  load();
}

async function saveCharacters() {
  const characters = [0, 1, 2, 3, 4].map(
    (index) => document.querySelector(`#fighter-${index}`).value
  );

  const response = await api("characters", {
    ...mine,
    characters
  });

  if (response.error) return alert(response.error);

  load();
}

async function addPlayer() {
  const characters = [0, 1, 2, 3, 4].map(
    (index) =>
      document.querySelector(`#manual-fighter-${index}`).value
  );

  const response = await api("add", {
    name: document.querySelector("#manual-name").value,
    characters
  });

  if (response.error) return alert(response.error);

  load();
}

async function startTournament() {
  if (!confirm("Start the tournament and close registration?")) {
    return;
  }

  const response = await api("start");

  if (response.error) return alert(response.error);

  load();
}

async function startMatch(match) {
  const response = await api("go", { match });

  if (response.error) return alert(response.error);

  load();
}

async function setWinner(match, winner) {
  const response = await api("win", { match, winner });

  if (response.error) return alert(response.error);

  load();
}

async function placeBet(match) {
  const response = await api("bet", {
    ...mine,
    match,
    pick: document.querySelector(`#pick-${match}`).value,
    stake: document.querySelector(`#stake-${match}`).value
  });

  if (response.error) return alert(response.error);

  load();
}

async function stopTournament() {
  if (!confirm("Stop the tournament for everybody? This cannot be undone.")) {
    return;
  }

  const response = await api("stop");

  if (response.error) return alert(response.error);

  load();
}

async function copyInvite() {
  await navigator.clipboard.writeText(
    `${location.origin}${location.pathname}?invite=${invite}`
  );

  alert("Player invite link copied.");
}

Object.assign(window, {
  createTournament,
  joinTournament,
  saveCharacters,
  addPlayer,
  startTournament,
  startMatch,
  setWinner,
  placeBet,
  stopTournament,
  copyInvite
});

if (invite) {
  const script = document.createElement("script");

  script.src = "/socket.io/socket.io.js";

  script.onload = () => {
    const socket = io();

    socket.emit("watch", invite);

    socket.on("state", (state) => {
      data = state;
      render();
    });
  };

  document.head.append(script);
}

load();