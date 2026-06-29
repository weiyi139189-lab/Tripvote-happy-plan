const { getStore } = require("@netlify/blobs");

const STORE_NAME = "tripvote";

function defaultState() {
  return { members: [], votes: {}, customDestinations: [] };
}

async function readState() {
  const store = getStore(STORE_NAME);
  const raw = await store.get("state", { consistency: "strong" });
  if (!raw) return defaultState();
  try {
    const state = JSON.parse(raw);
    state.members = state.members || [];
    state.votes = state.votes || {};
    state.customDestinations = state.customDestinations || [];
    return state;
  } catch {
    return defaultState();
  }
}

async function writeState(state) {
  const store = getStore(STORE_NAME);
  await store.set("state", JSON.stringify(state));
}

function publicState(state, currentMemberId) {
  const result = {
    members: state.members,
    votes: state.votes,
    customDestinations: state.customDestinations,
  };
  if (currentMemberId) {
    result.currentMemberId = currentMemberId;
  }
  return result;
}

function jsonResp(payload, status = 200) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return {};
  }
}

module.exports = { readState, writeState, publicState, jsonResp, parseBody, defaultState };
