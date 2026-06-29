const { readState, writeState, publicState, jsonResp, parseBody } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp({});
  if (event.httpMethod !== "POST") return jsonResp({ error: "method not allowed" }, 405);

  const body = parseBody(event);
  const name = String(body.name || "").trim();
  const className = String(body.className || "avatar-a").trim() || "avatar-a";
  if (!name) return jsonResp({ error: "name required" }, 400);

  const crypto = require("crypto");
  const member = {
    id: crypto.randomBytes(5).toString("hex"),
    name,
    className,
    joinedAt: Math.floor(Date.now() / 1000),
  };

  const state = await readState();
  state.members.push(member);
  await writeState(state);
  return jsonResp(publicState(state, member.id));
};
