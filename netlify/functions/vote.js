const { readState, writeState, publicState, jsonResp, parseBody } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp({});
  if (event.httpMethod !== "POST") return jsonResp({ error: "method not allowed" }, 405);

  const body = parseBody(event);
  const memberId = String(body.memberId || "");
  const destinationId = String(body.destinationId || "");
  const voteType = String(body.voteType || "");

  if (!["heart", "veto"].includes(voteType) || !memberId || !destinationId) {
    return jsonResp({ error: "invalid vote" }, 400);
  }

  const state = await readState();
  const votes = state.votes[destinationId] || { heart: [], veto: [] };
  votes.heart = votes.heart || [];
  votes.veto = votes.veto || [];

  const alreadySelected = votes[voteType].includes(memberId);
  votes.heart = votes.heart.filter((id) => id !== memberId);
  votes.veto = votes.veto.filter((id) => id !== memberId);
  if (!alreadySelected) {
    votes[voteType].push(memberId);
  }

  state.votes[destinationId] = votes;
  await writeState(state);
  return jsonResp(publicState(state));
};
