let state = JSON.parse(localStorage.getItem("gameNightTournament") || "null");

const $ = (id) => document.getElementById(id);
const save = () => localStorage.setItem("gameNightTournament", JSON.stringify(state));
const id = () => Math.random().toString(36).slice(2, 10);

const esc = (text) =>
  String(text || "TBD").replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;"
  }[character]));

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function players() {
  return state.players;
}

function byId(playerId) {
  return players().find((player) => player.id === playerId);
}

function pName(playerId) {
  return byId(playerId)?.name || "TBD";
}

function matches(stage) {
  return state.matches.filter((match) => match.stage === stage);
}

function openMatch() {
  return state.matches.find((match) => match.status === "live");
}

function readyMatches() {
  return state.matches.filter((match) => match.status === "ready");
}

function randomCharacter(player) {
  return player.characters[Math.floor(Math.random() * player.characters.length)];
}

function createTournament() {
  const names = $("playerNames").value
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length < 4) {
    return toast("Please add at least 4 players.");
  }

  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    return toast("Player names need to be unique.");
  }

  const master = $("master").value;

  if (!master) {
    return toast("Choose the game master.");
  }

  const tournamentPlayers = names.map((name, index) => ({
    id: `p${index}`,
    name,
    points: 100,
    wins: 0,
    losses: 0,
    characters: []
  }));

  const poolCount = names.length >= 6 ? 2 : 1;
  const pools = Array.from({ length: poolCount }, (_, index) => ({
    name: `Pool ${String.fromCharCode(65 + index)}`,
    playerIds: []
  }));

  tournamentPlayers.forEach((player, index) => {
    pools[index % poolCount].playerIds.push(player.id);
  });

  state = {
    players: tournamentPlayers,
    master,
    pools,
    matches: [],
    phase: "pools",
    champion: null,
    selectedMatch: null
  };

  pools.forEach((pool) => {
    for (let first = 0; first < pool.playerIds.length; first++) {
      for (let second = first + 1; second < pool.playerIds.length; second++) {
        state.matches.push({
          id: id(),
          stage: "pool",
          pool: pool.name,
          round: "Pool match",
          a: pool.playerIds[first],
          b: pool.playerIds[second],
          status: "ready",
          bets: [],
          chars: null
        });
      }
    }
  });

  save();
  render();
  toast("Tournament created. Pick five characters each.");
}

function allCharactersChosen() {
  return players().every((player) => player.characters.length === 5);
}

function setCharacters(playerId, rawCharacters) {
  const picks = rawCharacters
    .split(",")
    .map((character) => character.trim())
    .filter(Boolean);

  if (picks.length !== 5) {
    return toast("Choose exactly five characters.");
  }

  if (new Set(picks).size !== 5) {
    return toast("Those five choices must be different.");
  }

  byId(playerId).characters = picks;
  save();
  render();
}

function startMatch(matchId) {
  const match = state.matches.find((item) => item.id === matchId);

  if (!allCharactersChosen()) {
    return toast("Every player must select five characters first.");
  }

  if (openMatch()) {
    return toast("Finish the current live game first.");
  }

  match.status = "live";
  match.chars = {
    [match.a]: randomCharacter(byId(match.a)),
    [match.b]: randomCharacter(byId(match.b))
  };

  state.selectedMatch = matchId;
  save();
  render();
  toast("Game started - bets are locked!");
}

function recordWin(matchId, winner) {
  const match = state.matches.find((item) => item.id === matchId);

  if (match.status !== "live") return;

  const loser = winner === match.a ? match.b : match.a;

  match.status = "done";
  match.winner = winner;
  match.loser = loser;

  byId(winner).wins++;
  byId(loser).losses++;

  match.bets.forEach((bet) => {
    const bettor = byId(bet.bettor);

    if (bet.pick === winner) {
      bettor.points += bet.stake;
      bet.result = "won";
    } else {
      bettor.points -= bet.stake;
      bet.result = "lost";
    }
  });

  state.selectedMatch = null;

  if (match.stage === "pool" && matches("pool").every((item) => item.status === "done")) {
    buildBrackets();
  } else if (match.stage === "winner" || match.stage === "loser") {
    advanceBracket(match);
  } else if (match.stage === "final") {
    resolveFinal(match);
  }

  save();
  render();
}

function orderedPool(pool) {
  return pool.playerIds.slice().sort((firstId, secondId) => {
    const first = byId(firstId);
    const second = byId(secondId);

    return (
      (second.wins - first.wins) ||
      (first.losses - second.losses) ||
      first.name.localeCompare(second.name)
    );
  });
}

function buildBrackets() {
  state.phase = "brackets";

  const winnerEntrants = [];
  const loserEntrants = [];

  state.pools.forEach((pool) => {
    const rankings = orderedPool(pool);
    const splitPoint = Math.ceil(rankings.length / 2);

    winnerEntrants.push(...rankings.slice(0, splitPoint));
    loserEntrants.push(...rankings.slice(splitPoint));
  });

  createRound("winner", winnerEntrants, "Winners Bracket - Round 1");
  createRound("loser", loserEntrants, "Losers Bracket - Round 1");
}

function createRound(stage, entrants, label) {
  if (entrants.length === 1) {
    declareBracketChampion(stage, entrants[0]);
    return;
  }

  let bracketSize = 1;
  while (bracketSize < entrants.length) bracketSize *= 2;

  const paddedEntrants = entrants.concat(
    Array(bracketSize - entrants.length).fill(null)
  );

  for (let index = 0; index < bracketSize; index += 2) {
    const a = paddedEntrants[index];
    const b = paddedEntrants[index + 1];

    if (!a && !b) continue;

    const match = {
      id: id(),
      stage,
      round: label,
      a,
      b,
      status: a && b ? "ready" : "done",
      bets: [],
      chars: null
    };

    if (a && !b) match.winner = a;
    if (b && !a) match.winner = b;

    state.matches.push(match);
  }

  const autoWinners = state.matches
    .filter((match) =>
      match.stage === stage &&
      match.round === label &&
      match.status === "done" &&
      match.winner
    )
    .map((match) => match.winner);

  if (autoWinners.length) {
    setTimeout(() => advanceByes(stage, label), 0);
  }
}

function advanceByes(stage, label) {
  const round = matches(stage).filter((match) => match.round === label);

  if (!round.every((match) => match.status === "done")) return;

  const winners = round.map((match) => match.winner).filter(Boolean);

  if (winners.length === 1) {
    declareBracketChampion(stage, winners[0]);
  } else {
    createRound(
      stage,
      winners,
      stage === "winner"
        ? "Winners Bracket - Next round"
        : "Losers Bracket - Next round"
    );
  }

  save();
  render();
}

function advanceBracket(match) {
  const round = matches(match.stage).filter(
    (item) => item.round === match.round
  );

  if (!round.every((item) => item.status === "done")) return;

  const winners = round.map((item) => item.winner).filter(Boolean);

  if (winners.length === 1) {
    declareBracketChampion(match.stage, winners[0]);
  } else {
    createRound(
      match.stage,
      winners,
      match.stage === "winner"
        ? "Winners Bracket - Next round"
        : "Losers Bracket - Next round"
    );
  }
}

function declareBracketChampion(stage, playerId) {
  state[`${stage}Champion`] = playerId;

  if (
    state.winnerChampion &&
    state.loserChampion &&
    !matches("final").length
  ) {
    state.phase = "final";

    state.matches.push({
      id: id(),
      stage: "final",
      round: "Grand Final - Set 1",
      a: state.winnerChampion,
      b: state.loserChampion,
      status: "ready",
      bets: [],
      chars: null,
      finalSet: 1
    });
  }
}

function resolveFinal(match) {
  if (match.finalSet === 1 && match.winner === state.winnerChampion) {
    state.champion = match.winner;
    state.phase = "complete";
    toast(`${pName(match.winner)} wins the tournament!`);
  } else if (match.finalSet === 1) {
    state.matches.push({
      id: id(),
      stage: "final",
      round: "Grand Final Reset - Losers champion must win again",
      a: state.winnerChampion,
      b: state.loserChampion,
      status: "ready",
      bets: [],
      chars: null,
      finalSet: 2
    });

    toast("Bracket reset! One more final game.");
  } else {
    state.champion = match.winner;
    state.phase = "complete";
    toast(`${pName(match.winner)} wins the tournament!`);
  }
}

function placeBet() {
  const matchId = state.selectedMatch || readyMatches()[0]?.id;
  const bettor = $("bettor")?.value;
  const pick = $("pick")?.value;
  const stake = Number($("stake")?.value);

  if (!matchId) {
    return toast("No game is ready to bet on.");
  }

  const match = state.matches.find((item) => item.id === matchId);

  if (match.status !== "ready") {
    return toast("Betting is closed for this game.");
  }

  if (!bettor || !pick || !stake || stake < 1) {
    return toast("Choose a bettor, pick, and stake.");
  }

  if ([match.a, match.b].includes(bettor)) {
    return toast("Players cannot bet on their own match.");
  }

  const player = byId(bettor);

  if (stake > player.points) {
    return toast("Not enough points.");
  }

  match.bets = match.bets.filter((bet) => bet.bettor !== bettor);
  match.bets.push({ bettor, pick, stake });

  state.selectedMatch = matchId;
  save();
  render();
  toast("Bet registered.");
}

function matchHtml(match, actions = false) {
  const live = match.status === "live";
  const done = match.status === "done";
  const className =
    `${live ? " live" : ""}${match.stage === "final" ? " final" : ""}`;

  const characterHtml = match.chars
    ? `<div class="characters">
        ${esc(pName(match.a))}: ${esc(match.chars[match.a])}
        vs
        ${esc(pName(match.b))}: ${esc(match.chars[match.b])}
      </div>`
    : "";

  let actionHtml = "";

  if (actions && match.status === "ready") {
    actionHtml = `
      <div class="match-actions">
        <button onclick="startMatch('${match.id}')">Start game</button>
      </div>
    `;
  }

  if (actions && live) {
    actionHtml = `
      <div class="match-actions">
        <button onclick="recordWin('${match.id}', '${match.a}')">${esc(pName(match.a))} won</button>
        <button onclick="recordWin('${match.id}', '${match.b}')">${esc(pName(match.b))} won</button>
      </div>
    `;
  }

  return `
    <div class="match${className}">
      <div class="match-title">
        <span>${esc(match.round)}${match.pool ? ` - ${esc(match.pool)}` : ""}</span>
        <span class="pill ${live ? "live" : done ? "done" : "ready"}">
          ${live ? "LIVE" : done ? "COMPLETE" : "READY"}
        </span>
      </div>

      <div class="players">
        <span class="${match.winner === match.a ? "winner" : ""}">${esc(pName(match.a))}</span>
        <span class="hint">vs</span>
        <span class="${match.winner === match.b ? "winner" : ""}">${esc(pName(match.b))}</span>
      </div>

      ${characterHtml}
      ${actionHtml}
    </div>
  `;
}

function render() {
  const activeTournament = Boolean(state);

  $("setup").classList.toggle("hidden", activeTournament);
  $("app").classList.toggle("hidden", !activeTournament);

  if (!activeTournament) return;

  const currentMatch =
    openMatch() ||
    state.matches.find(
      (match) => match.id === state.selectedMatch && match.status === "ready"
    ) ||
    readyMatches()[0];

  $("eventTitle").textContent =
    state.phase === "complete" ? "Tournament complete" : "Tonight's tournament";

  $("phasePill").textContent =
    state.phase === "pools" ? "Pool stage" :
    state.phase === "brackets" ? "Bracket stage" :
    state.phase === "final" ? "Grand Final" :
    "Complete";

  $("phasePill").className = `pill ${state.phase === "complete" ? "done" : "live"}`;
  $("champion").textContent = state.champion ? `Champion: ${pName(state.champion)}` : "";

  $("nextGame").innerHTML = currentMatch
    ? `
      <div class="match-title">
        <strong>Next game</strong>
        <span>${currentMatch.status === "live" ? "In progress" : "Betting open until the game master starts it"}</span>
      </div>
      ${matchHtml(currentMatch)}
    `
    : `<div class="empty">No ready game right now. Complete the current stage to reveal the next one.</div>`;

  $("masterText").innerHTML =
    `Game master: <strong>${esc(pName(state.master))}</strong>. Select characters below, then use the controls to start and record each game.`;

  $("masterControls").innerHTML =
    players()
      .map((player) => `
        <label>${esc(player.name)}'s five characters (comma-separated)</label>
        <div class="row">
          <input
            id="chars-${player.id}"
            value="${esc(player.characters.join(", "))}"
            placeholder="Mario, Link, Kirby, Samus, Fox"
          >
          <button
            class="secondary"
            onclick="setCharacters('${player.id}', document.getElementById('chars-${player.id}').value)"
          >
            Save
          </button>
        </div>
      `)
      .join("") +
    (currentMatch ? `<h3>Current game</h3>${matchHtml(currentMatch, true)}` : "");

  const betMatch = currentMatch?.status === "ready" ? currentMatch : null;

  $("betHint").textContent = betMatch
    ? `Pick a side for ${pName(betMatch.a)} vs ${pName(betMatch.b)}. A correct bet wins the same number of points staked; an incorrect bet loses them.`
    : "Betting is only open while the next game is ready.";

  $("betControls").innerHTML = betMatch
    ? `
      <div class="row">
        <div>
          <label>Bettor</label>
          <select id="bettor">
            <option value="">Choose player</option>
            ${players()
              .filter((player) => ![betMatch.a, betMatch.b].includes(player.id))
              .map((player) => `<option value="${player.id}">${esc(player.name)} (${player.points} pts)</option>`)
              .join("")}
          </select>
        </div>

        <div>
          <label>Pick</label>
          <select id="pick">
            <option value="${betMatch.a}">${esc(pName(betMatch.a))}</option>
            <option value="${betMatch.b}">${esc(pName(betMatch.b))}</option>
          </select>
        </div>

        <div>
          <label>Stake</label>
          <input id="stake" type="number" min="1" value="10">
        </div>

        <button onclick="placeBet()">Place bet</button>
      </div>
    `
    : `<div class="empty">Waiting for a ready match.</div>`;

  $("leaderboard").innerHTML = players()
    .slice()
    .sort((a, b) => b.points - a.points)
    .map((player, index) => `
      <div class="leader">
        <span>${index + 1}. ${esc(player.name)}</span>
        <strong>${player.points} pts</strong>
      </div>
    `)
    .join("");

  $("standings").innerHTML = state.pools
    .map((pool) => {
      const rankings = orderedPool(pool);

      return `
        <div class="stage">
          <h3>${pool.name}</h3>
          <table class="standings">
            <tr><th>#</th><th>Player</th><th>W</th><th>L</th></tr>
            ${rankings
              .map((playerId, index) => {
                const player = byId(playerId);

                return `
                  <tr>
                    <td class="rank">${index + 1}</td>
                    <td>${esc(player.name)}</td>
                    <td>${player.wins}</td>
                    <td>${player.losses}</td>
                  </tr>
                `;
              })
              .join("")}
          </table>
        </div>
      `;
    })
    .join("");

  $("winnerBracket").innerHTML = matches("winner").length
    ? matches("winner").map((match) => matchHtml(match)).join("")
    : `<div class="empty">Revealed after pool play.</div>`;

  $("loserBracket").innerHTML = matches("loser").length
    ? matches("loser").map((match) => matchHtml(match)).join("")
    : `<div class="empty">Revealed after pool play.</div>`;

  $("matchList").innerHTML = state.matches.length
    ? state.matches.slice().reverse().map((match) => matchHtml(match)).join("")
    : `<div class="empty">Pool matches will appear here.</div>`;
}

$("playerNames").addEventListener("input", () => {
  const names = $("playerNames").value
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);

  $("master").innerHTML =
    `<option value="">Choose a game master</option>` +
    names.map((name, index) => `<option value="p${index}">${esc(name)}</option>`).join("");
});

$("createBtn").onclick = createTournament;

$("resetBtn").onclick = () => {
  if (confirm("Erase this tournament and start a new one?")) {
    localStorage.removeItem("gameNightTournament");
    state = null;
    render();
  }
};

window.startMatch = startMatch;
window.recordWin = recordWin;
window.setCharacters = setCharacters;
window.placeBet = placeBet;

render();