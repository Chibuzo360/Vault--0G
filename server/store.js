/**
 * File-backed store for encryption keys + shared contract address.
 * Keys are never returned via public listing — only after on-chain ownership check.
 */
const fs   = require("fs");
const path = require("path");

const KEYS_PATH     = path.join(__dirname, "keys.json");
const CONTRACT_PATH = path.join(__dirname, "contract.json");

function loadKeys() {
  try { return JSON.parse(fs.readFileSync(KEYS_PATH, "utf8")); }
  catch { return []; }
}

function saveKeys(data) {
  fs.writeFileSync(KEYS_PATH, JSON.stringify(data, null, 2));
}

function keyId(contractAddress, templateId) {
  return `${contractAddress.toLowerCase()}:${Number(templateId)}`;
}

module.exports = {
  getContract() {
    try { return JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8")); }
    catch { return null; }
  },

  setContract({ address, deployer }) {
    const data = { address, deployer, deployedAt: new Date().toISOString() };
    fs.writeFileSync(CONTRACT_PATH, JSON.stringify(data, null, 2));
    return data;
  },

  registerKey({ contractAddress, templateId, encKey, creatorAddress }) {
    const all = loadKeys();
    const id  = keyId(contractAddress, templateId);
    const row = {
      id,
      contractAddress: contractAddress.toLowerCase(),
      templateId: Number(templateId),
      encKey,
      creatorAddress: creatorAddress?.toLowerCase() || null,
      createdAt: new Date().toISOString(),
    };
    const idx = all.findIndex(k => k.id === id);
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    saveKeys(all);
    return row;
  },

  getKey(contractAddress, templateId) {
    const id = keyId(contractAddress, templateId);
    return loadKeys().find(k => k.id === id)?.encKey || null;
  },
};
