const { jsonResp } = require("./shared");

exports.handler = async () => {
  return jsonResp({ ok: true });
};
