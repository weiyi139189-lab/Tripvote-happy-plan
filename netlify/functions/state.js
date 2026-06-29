const { readState, publicState, jsonResp } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return jsonResp({});
  }
  const state = await readState();
  return jsonResp(publicState(state));
};
