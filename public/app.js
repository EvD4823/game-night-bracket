const app = document.querySelector("#app");
const query = new URLSearchParams(location.search);

const invite = query.get("invite");
const master = query.get("master");

let mine = JSON.parse(localStorage.getItem("gn-player") || "null");
let data;

const api = (path, body = {}) =>
  fetch(`/api/${invite}/${path}`, {
    method: path === "state" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: path === "state"
      ? undefined
      : JSON.stringify({ ...body, master })
  }).then((response) => response.json());

let latestLoad = 0;

async function load() {
  const loadNumber = ++latestLoad;

  if (!invite) {
    app.innerHTML = `
      <div class="card">
        <h1>Game Night Live</h1>
        <button id="create">Create tournament</button>
      </div>
    `;

    document.querySelector("#create").onclick = async () => {
      const response = await fetch("/api/create", { method: "POST" });
      const tournament = await response.json();

      location = `?invite=${tournament.invite}&master=${tournament.master}`;
    };

    return;
  }

  const newData = await api("state");

  /* Ignore an older refresh that finishes after a newer request. */
  if (loadNumber !== latestLoad) return;

  data = newData;
  render();
}

setInterval(() => {
  const typing = document.activeElement?.matches("input, textarea, select");

  if (invite && !typing) {
    load();
  }
}, 5000);

function name(playerId) {
  return data.players.find((player) => player.id === playerId)?.name || "TBD";
}

function render() {
  const me = mine && data.players.find((player) => player.id === mine.id);

  const nextMatch = data.matches.find(
    (match) =>
      match.status !== "done" &&
      (match.a === mine?.id || match.b === mine?.id)
  );

  const waitCount = data.matches.filter(
    (match) => match.status === "ready" && match.id !== nextMatch?.id
  ).length;

  const matchHtml = data.matches.map((match) => `
    <div class="match ${match.status === "live" ? "live" : ""}">
      <b class="${match.a === mine?.id ? "me" : ""}">${name(match.a)}</b>
      vs
      <b class="${match.b === mine?.id ? "me" : ""}">${name(match.b)}</b>
      - ${match.status}

      ${match.characters
        ? `<br>${match.characters[match.a]} vs ${match.characters[match.b]}`
        : ""
      }

      ${master && match.status === "ready"
        ? `<button onclick="go('${match.id}')">Start</button>`
        : ""
      }

      ${master && match.status === "live"
        ? `
          <button onclick="win('${match.id}', '${match.a}')">${name(match.a)} won</button>
          <button onclick="win('${match.id}', '${match.b}')">${name(match.b)} won</button>
        `
        : ""
      }
    </div>
  `).join("");

  app.innerHTML = `
    <div class="card">
      <h1>Game Night Live</h1>
      <p class="hint">${data.phase}</p>

      ${!me
        ? `
          <input id="n" placeholder="Your name">
          <button onclick="join()">Join tournament</button>
        `
        : `
    ``      <b>${me.name}</b> - ${me.points} betting points<br>

            <label>Your five characters, separated by commas</label>
            <input
              id="characters"
              value="${me.characters.join(", ")}"
              placeholder="Mario, Link, Kirby, Samus, Fox"
            >
            <button onclick="saveCharacters()">Save my characters</button>

  <hr>``
          Next: ${nextMatch ? `${name(nextMatch.a)} vs ${name(nextMatch.b)}` : "No match yet"}<br>
          Matches to wait: ${nextMatch ? waitCount : "-"}
        `
      }

      ${master
        ? `
          <div>
            <label>Player invite link — share this, not your master link:</label>
            <input
              readonly
              value="${location.origin}${location.pathname}?invite=${invite}"
              onclick="this.select()"
            >
          </div>
          <hr>
          <hr>
          <input id="add" placeholder="Add player without phone">
          <button onclick="addPlayer()">Add player</button>

          ${data.phase === "registration"
            ? `<button onclick="startTournament()">Close registration & create pool matches</button>`
            : ""
          }
        `
        : ""
      }
    </div>

    <div class="card">
      <h2>Matches</h2>
      ${matchHtml || "No matches yet."}
    </div>

    <div class="card">
      <h2>Players</h2>
      ${data.players.map((player) => `
        <div class="${player.id === mine?.id ? "me" : ""}">
          ${player.name} - ${player.points} pts
        </div>
      `).join("")}
    </div>
  `;
}

async function join() {
  const button = document.querySelector('button[onclick="join()"]');
  button.disabled = true;
  button.textContent = "Joining...";

  const result = await api("join", {
    name: document.querySelector("#n").value
  });

  if (result.error) {
    alert(result.error);
    button.disabled = false;
    button.textContent = "Join tournament";
    return;
  }

  mine = result;
  localStorage.setItem("gn-player", JSON.stringify(result));

  await load();
}

async function addPlayer() {
  const result = await api("add", { name: document.querySelector("#add").value });

  if (result.error) alert(result.error);
  load();
}

async function startTournament() {
  const result = await api("start");

  if (result.error) alert(result.error);
  load();
}

async function go(match) {
  const result = await api("go", { match });

  if (result.error) alert(result.error);
  load();
}

async function win(match, winner) {
  await api("win", { match, winner });
  load();
}

async function saveCharacters() {
  const characters = document.querySelector("#characters").value
    .split(",")
    .map((character) => character.trim())
    .filter(Boolean);

  if (characters.length !== 5) {
    return alert("Please enter exactly five characters.");
  }

  if (new Set(characters).size !== 5) {
    return alert("Your five characters must be different.");
  }

  const result = await api("characters", {
    id: mine.id,
    key: mine.key,
    characters
  });

  if (result.error) return alert(result.error);

  load();
}

Object.assign(window, {
  join,
  addPlayer,
  startTournament,
  go,
  win
});

Object.assign(window, {
  join,
  addPlayer,
  startTournament,
  go,
  win,
  saveCharacters
});

load();