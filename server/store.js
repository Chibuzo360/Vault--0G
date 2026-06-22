/**
 * store.js — file-backed store for agent templates + encryption keys.
 * Keys are NEVER exposed via any API endpoint — only used server-side
 * to decrypt training content from 0G Storage before passing to 0G Compute.
 */
const fs   = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "agents.json");

function load() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
  catch { return []; }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  getAll() {
    // Never expose encKey externally
    return load().map(({ encKey, ...safe }) => safe);
  },

  getKey(templateId) {
    const agent = load().find(a => a.templateId === Number(templateId));
    return agent?.encKey || null;
  },

  add({ templateId, name, description, personality, contentHash, encKey, creatorAddress }) {
    const all = load();
    const agent = { templateId, name, description, personality, contentHash, encKey, creatorAddress, createdAt: new Date().toISOString() };
    all.push(agent);
    save(all);
    return agent;
  },

  findByTemplateId(templateId) {
    const agent = load().find(a => a.templateId === Number(templateId));
    if (!agent) return null;
    const { encKey, ...safe } = agent;
    return safe;
  },
};
