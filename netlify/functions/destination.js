const { readState, writeState, publicState, jsonResp, parseBody } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp({});
  if (event.httpMethod !== "POST") return jsonResp({ error: "method not allowed" }, 405);

  const body = parseBody(event);
  const memberId = String(body.memberId || "");
  const destination = body.destination || {};
  const destinationId = String(destination.id || "");

  if (!memberId || !destinationId) {
    return jsonResp({ error: "invalid destination" }, 400);
  }

  const state = await readState();
  state.customDestinations = state.customDestinations.filter(
    (item) => item.id !== destinationId
  );
  state.customDestinations.unshift(destination);
  state.votes[destinationId] = destination.votes || {
    heart: [memberId],
    veto: [],
  };

  await writeState(state);
  return jsonResp(publicState(state));
};
