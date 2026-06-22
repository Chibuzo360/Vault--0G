require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const crypto   = require("crypto");
const { ethers } = require("ethers");
const { createZGComputeNetworkBroker } = require("@0gfoundation/0g-compute-ts-sdk");
const { Indexer, MemData, newSymmetricEncryptedFile } = require("@0gfoundation/0g-ts-sdk");
const store = require("./store");

const PORT             = process.env.PORT        || 3000;
const RPC_URL          = process.env.RPC_URL     || "https://evmrpc-testnet.0g.ai";
const INDEXER_URL      = process.env.INDEXER_URL || "https://indexer-storage-testnet-turbo.0g.ai";
const PRIVATE_KEY      = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

if (!PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error("Missing PRIVATE_KEY or CONTRACT_ADDRESS in .env");
  process.exit(1);
}

// ── Contract ABI (read-only — only what server needs) ────────────────────────
const ABI = [
  "function ownsAgent(address owner, uint256 templateId) view returns (bool, uint256)",
  "function ownedTemplates(address owner) view returns (uint256[])",
  "function templates(uint256 templateId) view returns (uint256,string,string,string,string,address,uint256)",
  "function totalTemplates() view returns (uint256)",
];

// ── Clients ───────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const indexer  = new Indexer(INDEXER_URL);

// ── 0G Compute broker ─────────────────────────────────────────────────────────
let brokerPromise       = null;
let chatProviderAddress = null;

async function getBroker() {
  if (!brokerPromise) {
    brokerPromise = (async () => {
      const broker = await createZGComputeNetworkBroker(wallet);
      try { await broker.ledger.addLedger(0.1); console.log("0G Compute ledger ready."); }
      catch { console.log("0G Compute ledger already exists."); }
      const services = await broker.inference.listService();
      const chat = services.find(s => s.serviceType === "chatbot");
      if (!chat) throw new Error("No chatbot provider on 0G Compute.");
      chatProviderAddress = chat.provider;
      await broker.inference.acknowledgeProviderSigner(chatProviderAddress);
      console.log(`0G Compute: ${chatProviderAddress} · ${chat.model}`);
      return broker;
    })();
  }
  return brokerPromise;
}

// ── 0G Storage: encrypt + upload ─────────────────────────────────────────────
async function uploadTrainingData(text) {
  const key           = crypto.randomBytes(32);
  const memData       = new MemData(Buffer.from(text, "utf8"));
  const encryptedFile = newSymmetricEncryptedFile(memData, key);
  console.log(`Uploading ${text.length} chars to 0G Storage...`);
  const [tx, err] = await indexer.upload(encryptedFile, RPC_URL, wallet);
  if (err) throw new Error("0G Storage upload failed: " + err.message);
  const rootHash = tx.rootHash ?? tx.rootHashes?.[0];
  console.log("Root hash:", rootHash);
  return { rootHash, keyHex: key.toString("hex") };
}

// ── 0G Storage: fetch + decrypt ───────────────────────────────────────────────
async function fetchTrainingData(contentHash, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const [blob, err] = await indexer.downloadToBlob(contentHash, {
    proof: true,
    decryption: { symmetricKey: key },
  });
  if (err) throw new Error("0G Storage download failed: " + err.message);
  return Buffer.from(await blob.arrayBuffer()).toString("utf8");
}

// ── 0G Compute: run inference ─────────────────────────────────────────────────
async function runInference(personality, trainingContent, question) {
  const broker = await getBroker();
  const { endpoint, model } = await broker.inference.getServiceMetadata(chatProviderAddress);

  const systemPrompt =
    personality.trim()
      ? `${personality.trim()}\n\nYou have been trained on the following knowledge. Answer questions using ONLY this knowledge. If something cannot be answered from it, say so clearly.\n\nKNOWLEDGE BASE:\n${trainingContent}`
      : `You are a knowledgeable AI agent. Answer questions using ONLY the knowledge base below. If something cannot be answered from it, say so clearly.\n\nKNOWLEDGE BASE:\n${trainingContent}`;

  const messages = [
    { role: "system",  content: systemPrompt },
    { role: "user",    content: question },
  ];

  const headers = await broker.inference.getRequestHeaders(chatProviderAddress, question);
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) throw new Error(`0G Compute error (${res.status}): ${await res.text()}`);
  const data   = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "(no answer)";
  const chatID = res.headers.get("ZG-Res-Key") || data.id;

  let verified = null;
  try { verified = await broker.inference.processResponse(chatProviderAddress, chatID, answer); }
  catch (e) { console.warn("Verification skipped:", e.message); }

  return { answer, model, provider: chatProviderAddress, verified };
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Config for frontend
app.get("/api/config", (_req, res) => {
  res.json({ contractAddress: CONTRACT_ADDRESS, chainId: 16602, rpcUrl: RPC_URL });
});

// All published agents (from store — chain is source of truth for ownership)
app.get("/api/agents", (_req, res) => {
  res.json(store.getAll());
});

// Single agent metadata
app.get("/api/agents/:templateId", (req, res) => {
  const agent = store.findByTemplateId(req.params.templateId);
  if (!agent) return res.status(404).json({ error: "Agent not found." });
  res.json(agent);
});

// Creator: train agent → encrypt → 0G Storage → return rootHash for frontend to mint with
app.post("/api/train", async (req, res) => {
  try {
    const { name, description, personality, content, creatorAddress, templateId } = req.body;
    if (!name?.trim())       return res.status(400).json({ error: "Agent name required." });
    if (!content?.trim())    return res.status(400).json({ error: "Training content required." });
    if (!templateId)         return res.status(400).json({ error: "Template ID required." });
    if (content.length > 500_000) return res.status(400).json({ error: "Content too large (max 500KB)." });

    const { rootHash, keyHex } = await uploadTrainingData(content);

    store.add({
      templateId: Number(templateId),
      name:         name.trim(),
      description:  description?.trim() || "",
      personality:  personality?.trim() || "",
      contentHash:  rootHash,
      encKey:       keyHex,
      creatorAddress: creatorAddress || null,
    });

    res.json({ templateId, contentHash: rootHash, name: name.trim() });
  } catch(err) {
    console.error("Train error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Buyer: chat with an owned agent
app.post("/api/chat", async (req, res) => {
  try {
    const { wallet: userWallet, templateId, question } = req.body;
    if (!userWallet || templateId == null || !question)
      return res.status(400).json({ error: "wallet, templateId, and question are required." });

    // Verify ownership on 0G Chain
    const [owns] = await contract.ownsAgent(userWallet, templateId);
    if (!owns) return res.status(403).json({
      error: "Your wallet doesn't own this agent. Acquire it first.",
    });

    // Get agent metadata + decryption key (key never leaves server)
    const agent  = store.findByTemplateId(templateId);
    const encKey = store.getKey(templateId);
    if (!agent || !encKey) return res.status(404).json({ error: "Agent not found on this server." });

    // Fetch encrypted training data from 0G Storage + decrypt
    const trainingContent = await fetchTrainingData(agent.contentHash, encKey);

    // Run inference on 0G Compute
    const result = await runInference(agent.personality, trainingContent, question);
    res.json(result);
  } catch(err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nVault → http://localhost:${PORT}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`Agents in store: ${store.getAll().length}\n`);
});
