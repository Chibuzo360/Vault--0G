require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const { ethers } = require("ethers");
const store   = require("./store");

const PORT        = process.env.PORT        || 3000;
const RPC_URL     = process.env.RPC_URL     || "https://evmrpc-testnet.0g.ai";
const INDEXER_URL = process.env.INDEXER_URL || "https://indexer-storage-testnet-turbo.0g.ai";

const READ_ABI = [
  "function ownsAgent(address owner, uint256 templateId) view returns (bool, uint256)",
  "function templates(uint256 templateId) view returns (uint256,string,string,string,string,address,uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

function readContract(address) {
  return new ethers.Contract(address, READ_ABI, provider);
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// API routes MUST be registered before static files
app.get("/api/config", (_req, res) => {
  const shared = store.getContract();
  res.json({
    chainId: 16602,
    rpcUrl: RPC_URL,
    indexerUrl: INDEXER_URL,
    contractAddress: shared?.address || null,
  });
});

app.get("/api/artifact/AgentNFT", (_req, res) => {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "AgentNFT.sol", "AgentNFT.json");
  try {
    const artifact = require(artifactPath);
    res.json({ abi: artifact.abi, bytecode: artifact.bytecode });
  } catch {
    res.status(404).json({
      error: "Contract artifact not found. Run: npm run compile",
    });
  }
});

app.get("/api/contract", (_req, res) => {
  res.json(store.getContract() || {});
});

app.post("/api/contract", (req, res) => {
  const { address, deployer } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Valid contract address required." });
  }
  res.json(store.setContract({ address, deployer: deployer || null }));
});

// Creator registers decryption key after on-chain template is created
app.post("/api/keys/register", async (req, res) => {
  try {
    const { contractAddress, templateId, encKey, creatorAddress } = req.body;
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ error: "Valid contractAddress required." });
    }
    if (templateId == null || !encKey) {
      return res.status(400).json({ error: "templateId and encKey required." });
    }
    if (!creatorAddress || !ethers.isAddress(creatorAddress)) {
      return res.status(400).json({ error: "creatorAddress required." });
    }

    const contract = readContract(contractAddress);
    const t = await contract.templates(templateId);
    const onChainCreator = String(t[5]).toLowerCase();
    if (onChainCreator !== creatorAddress.toLowerCase()) {
      return res.status(403).json({ error: "Only the on-chain creator can register keys." });
    }

    store.registerKey({ contractAddress, templateId, encKey, creatorAddress });
    res.json({ ok: true, templateId: Number(templateId) });
  } catch (err) {
    console.error("Key register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Return decryption key after verifying NFT ownership (or creator) on-chain
app.post("/api/keys/access", async (req, res) => {
  try {
    const { contractAddress, templateId, wallet } = req.body;
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ error: "Valid contractAddress required." });
    }
    if (templateId == null || !wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "templateId and wallet required." });
    }

    const contract = readContract(contractAddress);
    const tid = Number(templateId);
    const [owns] = await contract.ownsAgent(wallet, tid);

    const t = await contract.templates(tid);
    const isCreator = String(t[5]).toLowerCase() === wallet.toLowerCase();

    if (!owns && !isCreator) {
      return res.status(403).json({ error: "Wallet does not own this agent." });
    }

    const encKey = store.getKey(contractAddress, tid);
    if (!encKey) {
      return res.status(404).json({ error: "Decryption key not registered for this agent." });
    }

    res.json({ encKey });
  } catch (err) {
    console.error("Key access error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  const shared = store.getContract();
  console.log(`\nVault → http://localhost:${PORT}`);
  console.log(`Shared contract: ${shared?.address || "(none — deploy from browser)"}`);
  console.log(`No server wallet needed — connect MetaMask in the browser.\n`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use. Stop the old server first:`);
    console.error(`  Windows: netstat -ano | findstr :${PORT}`);
    console.error(`  Then:    taskkill /PID <pid> /F\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
