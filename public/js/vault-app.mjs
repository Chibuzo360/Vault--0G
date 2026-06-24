const ethers = window.ethers;

function getStorage() {
  if (!window.zgstorage) {
    throw new Error("0G Storage SDK failed to load. Hard-refresh the page (Ctrl+Shift+R).");
  }
  return window.zgstorage;
}

function getIndexer() {
  if (!indexer) {
    const storage = getStorage();
    const IndexerClass = storage?.Indexer;
    if (typeof IndexerClass !== "function") {
      throw new Error("0G Storage Indexer not available");
    }
    indexer = new IndexerClass(config.indexerUrl);
  }
  return indexer;
}

async function loadComputeSdk() {
  try {
    return await import("https://esm.sh/@0gfoundation/0g-compute-ts-sdk@0.8.4?bundle");
  } catch (err) {
    throw new Error(`Failed to load 0G Compute SDK: ${err.message}`);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let provider, signer, userAddress, contract, config;
let contractAddress = null;
let currentChatTemplateId = null;
let activeModalTemplate = null;
let allAgents = [];
let brokerPromise = null;
let chatProviderAddress = null;
let indexer = null;

const ABI = [
  "function createTemplate(string name, string description, string personality, string contentHash) returns (uint256)",
  "function mintAgent(uint256 templateId) returns (uint256)",
  "function ownsAgent(address owner, uint256 templateId) view returns (bool, uint256)",
  "function ownedTemplates(address owner) view returns (uint256[])",
  "function totalTemplates() view returns (uint256)",
  "function templates(uint256 templateId) view returns (uint256,string,string,string,string,address,uint256)",
  "event TemplateCreated(uint256 indexed templateId, address indexed creator, string name, string contentHash)",
];

const AVATARS = ["🤖", "🧠", "📡", "🔮", "⚡", "🦾", "🌐", "🛸", "💡", "🔬"];
//
const DEFAULT_PERSONALITIES = [
  { label: "Choose a personality preset or leave blank for the default AI response", prompt: "" },
  { label: "Plain AI Response (no custom personality)", prompt: "" },
  { label: "Concise Crypto Analyst", prompt: "You are a concise crypto analyst. Always back claims with data. Never speculate beyond what your training data supports." },
  { label: "Friendly Tutor", prompt: "You are a friendly, patient tutor. Explain concepts clearly and step-by-step, using simple language and examples when needed." },
  { label: "Careful Legal Advisor", prompt: "You are a careful legal advisor. Provide answers in formal, precise language. Cite only what is in the training data and avoid giving specific legal advice." },
  { label: "Creative Storyteller", prompt: "You are a creative storyteller. Answer in an engaging, imaginative way while staying faithful to the training data." },
];
//
function applyPersonalityPreset() {
  const select = document.getElementById("c-personality-select");
  const textarea = document.getElementById("c-personality");
  if (!select || !textarea) return;
  const preset = DEFAULT_PERSONALITIES[Number(select.value)];
  if (!preset) return;
  textarea.value = preset.prompt;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function avatarFor(id) { return AVATARS[Number(id) % AVATARS.length]; }
function colorFor(id) {
  const c = ["#0f2a1e", "#1a1030", "#1a1400", "#1a0f2a", "#0f1a2a"];
  return c[Number(id) % c.length];
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error fetching ${url}: ${err.message}`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Server returned HTML instead of JSON for ${url}. ` +
      "Stop any old server on port 3000, then run: npm start"
    );
  }
  return { res, data };
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function setGateStatus(msg, type = "") {
  const el = document.getElementById("wallet-gate-status");
  el.textContent = msg;
  el.className = "wallet-gate-status" + (type ? " " + type : "");
}
function showWalletGate() { document.getElementById("wallet-gate").classList.add("open"); }
function hideWalletGate() { document.getElementById("wallet-gate").classList.remove("open"); }

function bindContract(addr) {
  contractAddress = addr;
  contract = new ethers.Contract(addr, ABI, signer);
  localStorage.setItem("vault_contract_address", addr);
}

// ── 0G Storage (browser wallet pays) ─────────────────────────────────────────
async function uploadTrainingData(text) {
  const { MemData, newSymmetricEncryptedFile } = getStorage();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const memData = new MemData(new TextEncoder().encode(text));
  const encryptedFile = newSymmetricEncryptedFile(memData, key);
  const [tx, err] = await getIndexer().upload(encryptedFile, config.rpcUrl, signer);
  if (err) throw new Error("0G Storage upload failed: " + err.message);
  const rootHash = tx.rootHash ?? tx.rootHashes?.[0];
  return { rootHash, keyHex: bytesToHex(key) };
}

async function fetchTrainingData(contentHash, keyHex) {
  const key = hexToBytes(keyHex);
  const [blob, err] = await getIndexer().downloadToBlob(contentHash, {
    proof: true,
    decryption: { symmetricKey: key },
  });
  if (err) throw new Error("0G Storage download failed: " + (err.message || JSON.stringify(err)));
  return new TextDecoder().decode(await blob.arrayBuffer());
}

// ── 0G Compute (browser wallet pays) ──────────────────────────────────────────
async function ensureComputeAccount(broker) {
  const isMissingAccount = (err) =>
    err?.message?.match(/account.*does not.*exist|add-account/i);

  if (typeof broker.inference?.getAccount === "function") {
    try {
      await broker.inference.getAccount();
      return;
    } catch (err) {
      if (!isMissingAccount(err)) throw err;
    }
  }

  const depositAmount = 0.1;
  try {
    if (typeof broker.ledger?.depositFund === "function") {
      await broker.ledger.depositFund(depositAmount);
    } else if (typeof broker.ledger?.addLedger === "function") {
      await broker.ledger.addLedger(depositAmount);
    } else {
      throw new Error("Unable to initialize 0G Compute account: missing ledger creation method.");
    }
  } catch (err) {
    if (isMissingAccount(err)) {
      throw new Error(
        "0G Compute account registration failed. " +
        "Make sure your wallet has 0G funds, then try again."
      );
    }
    throw err;
  }
}

async function getBroker() {
  if (!brokerPromise) {
    brokerPromise = (async () => {
      const { createZGComputeNetworkBroker } = await loadComputeSdk();
      const broker = await createZGComputeNetworkBroker(signer);
      await ensureComputeAccount(broker);
      const services = await broker.inference.listService();
      const chat = services.find(s => s.serviceType === "chatbot");
      if (!chat) throw new Error("No chatbot provider on 0G Compute.");
      chatProviderAddress = chat.provider;
      await broker.inference.acknowledgeProviderSigner(chatProviderAddress);
      return broker;
    })().catch(err => {
      brokerPromise = null;
      throw err;
    });
  }
  return brokerPromise;
}

async function runInference(personality, trainingContent, question) {
  const broker = await getBroker();
  const { endpoint, model } = await broker.inference.getServiceMetadata(chatProviderAddress);
  if (!endpoint) {
    throw new Error("0G Compute endpoint unavailable. Please retry or check your network.");
  }
  const systemPrompt = personality.trim()
    ? `${personality.trim()}\n\nYou have been trained on the following knowledge. Answer questions using ONLY this knowledge. If something cannot be answered from it, say so clearly.\n\nKNOWLEDGE BASE:\n${trainingContent}`
    : `You are a knowledgeable AI agent. Answer questions using ONLY the knowledge base below. If something cannot be answered from it, say so clearly.\n\nKNOWLEDGE BASE:\n${trainingContent}`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ];
  const headers = await broker.inference.getRequestHeaders(chatProviderAddress, question);
  let res;
  try {
    res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ model, messages }),
    });
  } catch (err) {
    throw new Error(`0G Compute network error: ${err.message}`);
  }
  if (!res.ok) throw new Error(`0G Compute error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "(no answer)";
  const chatID = res.headers.get("ZG-Res-Key") || data.id;
  let verified = null;
  try { verified = await broker.inference.processResponse(chatProviderAddress, chatID, answer); }
  catch { /* optional */ }
  return { answer, model, provider: chatProviderAddress, verified };
}

// ── Contract deploy / resolve ─────────────────────────────────────────────────
async function resolveContractAddress() {
  const cached = localStorage.getItem("vault_contract_address");
  if (cached && ethers.isAddress(cached)) {
    const code = await provider.getCode(cached);
    if (code && code !== "0x") return cached;
  }
  try {
    const { res, data: shared } = await fetchJson("/api/contract");
    if (res.ok && shared?.address && ethers.isAddress(shared.address)) {
      const code = await provider.getCode(shared.address);
      if (code && code !== "0x") return shared.address;
    }
  } catch (e) {
    console.warn("Shared contract lookup skipped:", e.message);
  }
  return null;
}

async function deployContract() {
  setGateStatus("Fetching contract bytecode…");
  const { res: artRes, data: artifact } = await fetchJson("/api/artifact/AgentNFT");
  if (!artRes.ok || artifact.error) {
    throw new Error(artifact.error || "Contract artifact not found. Run: npm run compile");
  }

  setGateStatus("Confirm deployment in MetaMask…");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const deployed = await factory.deploy();
  setGateStatus("Deploying AgentNFT to 0G Chain…");
  await deployed.waitForDeployment();
  const addr = await deployed.getAddress();

  await fetch("/api/contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: addr, deployer: userAddress }),
  });

  bindContract(addr);
  return addr;
}

async function ensureContract() {
  let addr = await resolveContractAddress();
  if (addr) {
    bindContract(addr);
    return addr;
  }

  document.getElementById("gate-connect-btn").style.display = "none";
  const deployBtn = document.getElementById("gate-deploy-btn");
  deployBtn.style.display = "block";
  setGateStatus("No marketplace contract yet. Deploy one to get started (one MetaMask tx).");

  return new Promise((resolve, reject) => {
    deployBtn.onclick = async () => {
      deployBtn.disabled = true;
      deployBtn.textContent = "Deploying…";
      try {
        addr = await deployContract();
        deployBtn.style.display = "none";
        resolve(addr);
      } catch (e) {
        deployBtn.disabled = false;
        deployBtn.textContent = "Deploy Marketplace Contract";
        setGateStatus(e.code === 4001 ? "Deployment rejected in MetaMask." : e.message, "err");
        reject(e);
      }
    };
  });
}

async function loadAgentsFromChain() {
  if (!contract) return [];
  const total = Number(await contract.totalTemplates());
  const agents = [];
  for (let i = 1; i <= total; i++) {
    const t = await contract.templates(i);
    const creator = t[5];
    if (!creator || creator === ethers.ZeroAddress) continue;
    agents.push({
      templateId: i,
      name: t[1],
      description: t[2],
      personality: t[3],
      contentHash: t[4],
      creatorAddress: creator,
      totalMinted: Number(t[6]),
    });
  }
  return agents;
}

function parseTemplateIdFromReceipt(receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "TemplateCreated") return Number(parsed.args.templateId);
    } catch { /* skip */ }
  }
  return null;
}

// ── Boot & wallet ─────────────────────────────────────────────────────────────
async function boot() {
  if (!window.ethers) {
    setGateStatus("Failed to load ethers.js. Check your internet connection and refresh.", "err");
    return;
  }

  config = (await fetchJson("/api/config")).data;
  config.indexerUrl = config.indexerUrl || "https://indexer-storage-testnet-turbo.0g.ai";
  setupFileDrop();
  bindUiHandlers();

  if (!window.ethereum) {
    setGateStatus("MetaMask not detected. Install it from metamask.io, then reload.", "err");
    document.getElementById("gate-connect-btn").textContent = "Install MetaMask";
    document.getElementById("gate-connect-btn").onclick = () => window.open("https://metamask.io/download/", "_blank");
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts.length) {
      setGateStatus("Restoring session…");
      await connectWallet(true);
    } else {
      setGateStatus("Click Connect Wallet to open MetaMask.");
    }
  } catch (e) {
    setGateStatus("Click Connect Wallet to open MetaMask.");
    console.warn("eth_accounts:", e.message);
  }
}

function bindUiHandlers() {
  document.getElementById("gate-connect-btn").addEventListener("click", () => connectWallet(false));
  document.getElementById("connect-btn").addEventListener("click", () => connectWallet(false));
  const personalitySelect = document.getElementById("c-personality-select");
  if (personalitySelect) personalitySelect.addEventListener("change", applyPersonalityPreset);
}

async function connectWallet(silent = false) {
  if (!window.ethereum) return;
  try {
    const btn = document.getElementById("gate-connect-btn");
    const headerBtn = document.getElementById("connect-btn");
    if (!silent) {
      btn.disabled = true;
      btn.textContent = "Connecting…";
      setGateStatus("Approve the connection in MetaMask…");
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    if (!silent) {
      // Must be triggered by user click — MetaMask blocks automatic prompts
      await provider.send("eth_requestAccounts", []);
    } else if (!(await provider.listAccounts()).length) {
      throw new Error("Wallet session expired. Click Connect Wallet again.");
    }
    setGateStatus("Switching to 0G Galileo Testnet…");
    await ensureNetwork();
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    brokerPromise = null;

    setGateStatus("Checking marketplace contract…");
    await ensureContract();

    document.getElementById("wallet-pill").classList.add("connected");
    document.getElementById("wallet-addr").textContent = userAddress.slice(0, 6) + "…" + userAddress.slice(-4);
    headerBtn.textContent = "Connected";
    headerBtn.disabled = true;
    document.getElementById("tabs").style.display = "flex";

    hideWalletGate();
    switchTab("explore");

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());
  } catch (e) {
    showWalletGate();
    const btn = document.getElementById("gate-connect-btn");
    btn.disabled = false;
    btn.textContent = "Connect Wallet";
    btn.style.display = "block";
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => connectWallet(false));
    }
    if (e.code === 4001) {
      setGateStatus("Connection rejected. Click Connect Wallet to try again.", "err");
    } else {
      setGateStatus(e.message || "Connection failed. Try again.", "err");
      if (!silent) console.error("Connect:", e.message);
    }
  }
}

async function ensureNetwork() {
  const hexId = "0x" + config.chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: "0G Galileo Testnet",
          nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: ["https://chainscan-galileo.0g.ai"],
        }],
      });
    } else throw e;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t, i) => {
    t.classList.toggle("active", ["explore", "my-agents", "create", "lab"][i] === name);
  });
  const map = { explore: "screen-explore", "my-agents": "screen-my-agents", create: "screen-create", lab: "screen-lab" };
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(map[name])?.classList.add("active");
  if (name === "explore") renderExplore();
  if (name === "my-agents") renderMyAgents();
  if (name === "lab") renderLab();
}

// ── Explore ───────────────────────────────────────────────────────────────────
async function renderExplore() {
  const grid = document.getElementById("agents-grid");
  allAgents = await loadAgentsFromChain();
  document.getElementById("agent-count").textContent =
    allAgents.length + " agent" + (allAgents.length !== 1 ? "s" : "") + " available";

  if (allAgents.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>No agents yet</strong>Be the first — go to Create Agent.</div>`;
    return;
  }

  grid.innerHTML = "";
  for (const a of allAgents) {
    let owned = false;
    if (contract && userAddress) {
      try { [owned] = await contract.ownsAgent(userAddress, a.templateId); } catch { /* */ }
    }
    const card = document.createElement("div");
    card.className = "agent-card";
    card.onclick = () => openModal(a, owned);
    card.innerHTML = `
      <div class="agent-card-top">
        <div class="agent-avatar" style="background:${colorFor(a.templateId)}">${avatarFor(a.templateId)}</div>
        <div class="agent-card-info">
          <h3>${esc(a.name)}</h3>
          <div class="agent-creator">${a.creatorAddress ? a.creatorAddress.slice(0, 8) + "…" : "unknown"}</div>
        </div>
      </div>
      <div class="agent-desc">${esc(a.description || "No description provided.")}</div>
      <div class="agent-footer">
        <span class="agent-stats">⬡ 0G Storage · ${a.totalMinted || 0} acquired</span>
        <div style="display:flex;gap:6px">
          ${owned ? '<span class="tag tag-owned">✓ Owned</span>' : ""}
          <span class="tag tag-storage">⬡ Encrypted</span>
        </div>
      </div>`;
    grid.appendChild(card);
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(agent, owned) {
  activeModalTemplate = agent;
  document.getElementById("m-avatar").textContent = avatarFor(agent.templateId);
  document.getElementById("m-avatar").style.background = colorFor(agent.templateId);
  document.getElementById("m-name").textContent = agent.name;
  document.getElementById("m-creator").textContent = agent.creatorAddress?.slice(0, 10) + "…" || "unknown";
  document.getElementById("m-minted").textContent = (agent.totalMinted || 0) + " times";
  document.getElementById("m-desc").textContent = agent.description || "No description.";
  document.getElementById("m-personality").textContent = agent.personality || "(no custom personality set)";
  document.getElementById("m-hash").textContent = agent.contentHash || "(not yet on 0G Storage)";
  document.getElementById("m-chainscan").href = "https://chainscan-galileo.0g.ai/address/" + contractAddress;
  document.getElementById("modal-err").style.display = "none";

  const btn = document.getElementById("m-acquire-btn");
  if (owned) {
    btn.textContent = "Open Agent";
    btn.onclick = () => { closeModalBtn(); switchTab("my-agents"); openChat(agent); };
  } else {
    btn.textContent = "Acquire Agent";
    btn.onclick = acquireFromModal;
  }
  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModalBtn();
}
function closeModalBtn() {
  document.getElementById("modal-overlay").classList.remove("open");
}

async function acquireFromModal() {
  const agent = activeModalTemplate;
  if (!agent || !contract) return;
  const btn = document.getElementById("m-acquire-btn");
  btn.disabled = true;
  btn.textContent = "Waiting for MetaMask…";
  document.getElementById("modal-err").style.display = "none";
  try {
    const tx = await contract.mintAgent(agent.templateId);
    btn.textContent = "Acquiring…";
    await tx.wait();
    btn.textContent = "Acquired ✓";
    setTimeout(() => { closeModalBtn(); switchTab("my-agents"); }, 1200);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Acquire Agent";
    const err = document.getElementById("modal-err");
    err.textContent = e.code === 4001 ? "Rejected in MetaMask." : e.message;
    err.style.display = "block";
  }
}

// ── My agents ─────────────────────────────────────────────────────────────────
async function renderMyAgents() {
  closeChat();
  const grid = document.getElementById("owned-grid");
  const empty = document.getElementById("owned-empty");
  grid.innerHTML = "";

  let templateIds = [];
  try { templateIds = await contract.ownedTemplates(userAddress); } catch (e) { console.warn(e); }

  document.getElementById("owned-count").textContent =
    templateIds.length + " agent" + (templateIds.length !== 1 ? "s" : "");

  if (templateIds.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  if (!allAgents.length) allAgents = await loadAgentsFromChain();

  for (const tid of templateIds) {
    const agent = allAgents.find(a => a.templateId === Number(tid));
    if (!agent) continue;
    const card = document.createElement("div");
    card.className = "owned-agent-card";
    card.innerHTML = `
      <div class="owned-card-avatar" style="background:${colorFor(agent.templateId)}">${avatarFor(agent.templateId)}</div>
      <div class="owned-card-name">${esc(agent.name)}</div>
      <div class="owned-card-desc">${esc(agent.description || "")}</div>
      <div class="owned-card-actions">
        <button class="btn btn-accent btn-sm">Open Agent</button>
      </div>`;
    card.querySelector("button").onclick = () => openChat(agent);
    grid.appendChild(card);
  }
}

// ── Chat (all in browser) ─────────────────────────────────────────────────────
function openChat(agent) {
  currentChatTemplateId = agent.templateId;
  document.getElementById("my-agents-view").style.display = "none";
  document.getElementById("chat-view").style.display = "block";
  document.getElementById("chat-avatar").textContent = avatarFor(agent.templateId);
  document.getElementById("chat-avatar").style.background = colorFor(agent.templateId);
  document.getElementById("chat-name").textContent = agent.name;
  document.getElementById("chat-history").innerHTML = "";
  appendMsg("chat-history", "msg-agent",
    `Hi! I'm ${agent.name}. Ask me anything — I'll answer based on what I've been trained on.`);
  document.getElementById("chat-input").focus();
}

function closeChat() {
  currentChatTemplateId = null;
  document.getElementById("my-agents-view").style.display = "block";
  document.getElementById("chat-view").style.display = "none";
}

function handleChatEnter(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

async function getEncKey(templateId) {
  const { res, data } = await fetchJson("/api/keys/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contractAddress, templateId, wallet: userAddress }),
  });
  if (!res.ok) throw new Error(data.error || "Could not get decryption key. Check that the server is running and the contract address is correct.");
  return data.encKey;
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const q = input.value.trim();
  if (!q || !currentChatTemplateId) return;

  const agent = allAgents.find(a => a.templateId === Number(currentChatTemplateId));
  if (!agent) return;

  appendMsg("chat-history", "msg-user", q);
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;

  const thinking = addThinking("chat-history");
  try {
    const [owns] = await contract.ownsAgent(userAddress, currentChatTemplateId);
    if (!owns) throw new Error("You don't own this agent.");

    const encKey = await getEncKey(currentChatTemplateId);
    const trainingContent = await fetchTrainingData(agent.contentHash, encKey);
    const result = await runInference(agent.personality, trainingContent, q);
    thinking.remove();
    const meta = `0G Compute · ${result.model} · ${result.provider?.slice(0, 10)}…${result.verified ? " · ✓ verified" : ""}`;
    appendMsg("chat-history", "msg-agent", result.answer, meta);
  } catch (e) {
    thinking.remove();
    appendMsg("chat-history", "msg-err", e.message);
  } finally {
    sendBtn.disabled = false;
    const h = document.getElementById("chat-history");
    h.scrollTop = h.scrollHeight;
  }
}

// ── Create ────────────────────────────────────────────────────────────────────
function setupFileDrop() {
  const zone = document.getElementById("file-drop");
  if (!zone) return;
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("drag");
    handleFile({ target: { files: e.dataTransfer.files } });
  });
}

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500_000) { showCreateErr("File too large — max 500KB."); return; }
  const r = new FileReader();
  r.onload = ev => {
    document.getElementById("c-content").value = ev.target.result;
    document.getElementById("file-name").textContent = "📄 " + file.name;
    updateCharCount();
  };
  r.readAsText(file);
}

function updateCharCount() {
  document.getElementById("char-ct").textContent =
    document.getElementById("c-content").value.length.toLocaleString();
}

function setStep(id, state) {
  const el = document.getElementById(id);
  el.className = "step " + state;
  if (state === "done") el.querySelector(".step-icon").textContent = "✓";
  if (state === "active") el.querySelector(".step-icon").textContent = ["s1", "s2", "s3", "s4", "s5"].indexOf(id) + 1;
}

async function publishAgent() {
  const name = document.getElementById("c-name").value.trim();
  const desc = document.getElementById("c-desc").value.trim();
  const personality = document.getElementById("c-personality").value.trim();
  const content = document.getElementById("c-content").value.trim();

  document.getElementById("create-err").style.display = "none";
  document.getElementById("success-box").classList.remove("on");

  if (!name) return showCreateErr("Agent name is required.");
  if (!content) return showCreateErr("Training content is required.");
  if (content.length > 500_000) return showCreateErr("Content too large (max 500KB).");
  if (!contract) return showCreateErr("Marketplace contract not ready. Reconnect your wallet.");

  const btn = document.getElementById("pub-btn");
  btn.disabled = true;
  btn.textContent = "Publishing…";
  const steps = document.getElementById("pub-steps");
  steps.classList.add("on");
  ["s1", "s2", "s3", "s4", "s5"].forEach(s => setStep(s, "idle"));
  setStep("s1", "active");

  try {
    setStep("s1", "active");
    setStep("s2", "active");
    const { rootHash, keyHex } = await uploadTrainingData(content);
    setStep("s1", "done");
    setStep("s2", "done");
    setStep("s3", "active");

    const tx = await contract.createTemplate(name, desc, personality, rootHash);
    const receipt = await tx.wait();
    setStep("s3", "done");
    setStep("s4", "active");

    const templateId = parseTemplateIdFromReceipt(receipt);
    if (templateId == null) throw new Error("Could not read template ID from chain transaction.");

    const { res: regRes, data: regData } = await fetchJson("/api/keys/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, templateId, encKey: keyHex, creatorAddress: userAddress }),
    });
    if (!regRes.ok) throw new Error(regData.error || "Failed to register decryption key.");

    setStep("s4", "done");
    setStep("s5", "done");

    ["c-name", "c-desc", "c-personality", "c-content"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("file-name").textContent = "";
    updateCharCount();

    document.getElementById("success-txt").innerHTML =
      `<strong>${esc(name)}</strong> is live on the marketplace. ` +
      `<a href="https://chainscan-galileo.0g.ai/tx/${receipt.hash}" target="_blank">View on chainscan ↗</a>`;
    document.getElementById("success-box").classList.add("on");
    allAgents = await loadAgentsFromChain();
  } catch (e) {
    steps.classList.remove("on");
    showCreateErr(e.code === 4001 ? "Transaction rejected in MetaMask." : e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Train & Publish Agent →";
  }
}

function showCreateErr(msg) {
  const e = document.getElementById("create-err");
  e.textContent = msg;
  e.style.display = "block";
}

// ── Lab ───────────────────────────────────────────────────────────────────────
async function renderLab() {
  const list = document.getElementById("lab-list");
  const empty = document.getElementById("lab-empty");
  list.innerHTML = "";

  if (!allAgents.length) allAgents = await loadAgentsFromChain();
  const myAgents = allAgents.filter(
    a => a.creatorAddress?.toLowerCase() === userAddress?.toLowerCase()
  );

  if (myAgents.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  for (const a of myAgents) {
    const row = document.createElement("div");
    row.className = "lab-agent-row";
    row.innerHTML = `
      <div class="lab-avatar" style="background:${colorFor(a.templateId)}">${avatarFor(a.templateId)}</div>
      <div class="lab-info">
        <div class="lab-name">${esc(a.name)}</div>
        <div class="lab-meta">${a.totalMinted || 0} acquired · 0G Storage · <span style="color:var(--yellow);font-size:10px">${a.contentHash?.slice(0, 16)}…</span></div>
      </div>
      <div class="lab-actions">
        <div class="upgrade-btn">+ Upgrade NFT · v2</div>
        <a href="https://chainscan-galileo.0g.ai/address/${contractAddress}" target="_blank" class="btn btn-ghost btn-sm">View ↗</a>
      </div>`;
    list.appendChild(row);
  }
}

// ── Misc ──────────────────────────────────────────────────────────────────────
function showHowItWorks() {
  alert(
    "1. Connect MetaMask on 0G Galileo Testnet.\n\n" +
    "2. Deploy the marketplace contract (first time only).\n\n" +
    "3. Creators encrypt training data → 0G Storage → mint agent NFT.\n\n" +
    "4. Buyers acquire agent NFTs and chat via 0G Compute.\n\n" +
    "Everything is signed and paid from your wallet — no server keys needed."
  );
}

function appendMsg(histId, cls, text, meta) {
  const h = document.getElementById(histId);
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  if (meta) { const m = document.createElement("div"); m.className = "msg-meta"; m.textContent = meta; d.appendChild(m); }
  h.appendChild(d);
  h.scrollTop = h.scrollHeight;
}

function addThinking(histId) {
  const h = document.getElementById(histId);
  const d = document.createElement("div");
  d.className = "msg-thinking";
  d.textContent = "Thinking…";
  h.appendChild(d);
  h.scrollTop = h.scrollHeight;
  return d;
}

// Expose handlers for inline HTML onclick attributes
Object.assign(window, {
  connectWallet, switchTab, closeModal, closeModalBtn, acquireFromModal,
  closeChat, handleChatEnter, sendChat, publishAgent, showHowItWorks,
  handleFile, updateCharCount,
});

boot().catch(err => {
  console.error("Vault boot error:", err);
  const el = document.getElementById("wallet-gate-status");
  if (el) {
    el.textContent = "App failed to load: " + err.message;
    el.className = "wallet-gate-status err";
  }
});
