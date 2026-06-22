# Vault — AI Agents on 0G Network

> **Don't sell your knowledge. Sell access to an AI trained on it.**

Vault is a knowledge NFT marketplace built natively on 0G's three infrastructure layers. Creators train AI agents on private knowledge and mint them as NFTs. Buyers own the agent — not the raw content. The raw content stays encrypted on 0G Storage forever.

**The agent IS the product. Remove the AI, there is nothing to sell.**

---

## Why This is 0G-Native

| Remove this | What breaks |
|---|---|
| **0G Chain** | No ownership record. The access gate has no source of truth. |
| **0G Storage** | Encrypted training content has nowhere to live. The NFT's content hash points to nothing. |
| **0G Compute** | No inference. The entire value proposition disappears. |

This is not a bolt-on. Every pillar does real work.

---

## How It Works

### For Creators
1. Write training content — research, analysis, a book chapter, trading signals, anything
2. Hit **Train & Publish** — content is AES-256 encrypted and uploaded to **0G Storage**
3. A root hash (the immutable address of the encrypted blob) is returned
4. MetaMask signs a transaction calling `createTemplate(name, description, personality, contentHash)` on **0G Chain**
5. The agent is live on the marketplace

### For Buyers
1. Browse the marketplace, find an agent you want
2. Click **Acquire** — MetaMask signs `mintAgent(templateId)` on **0G Chain**
3. Open the agent and start asking questions
4. The server calls `ownsAgent(wallet, templateId)` to verify ownership on-chain
5. If verified: fetches encrypted content from **0G Storage**, decrypts it, sends to **0G Compute** for inference
6. The answer comes back — the raw content never left the server unencrypted

---

## Smart Contract

**`AgentNFT.sol`** — deployed to 0G Galileo Testnet (Chain ID 16602)

```solidity
// Creator publishes a trained agent
function createTemplate(string name, string description, string personality, string contentHash) returns (uint256 templateId)

// Buyer acquires a copy
function mintAgent(uint256 templateId) returns (uint256 tokenId)

// Ownership check (called by server before every inference)
function ownsAgent(address owner, uint256 templateId) view returns (bool, uint256)

// Get all template IDs a wallet owns
function ownedTemplates(address owner) view returns (uint256[])
```

---

## Tech Stack

- **0G Chain** — ERC-721 NFT contract (`AgentNFT.sol`), Solidity 0.8.24
- **0G Storage** — AES-256 encrypted training data via `@0gfoundation/0g-ts-sdk`
- **0G Compute** — LLM inference via `@0gfoundation/0g-compute-ts-sdk`
- **Backend** — Node.js / Express
- **Frontend** — Plain HTML/JS (no framework)

---

## Setup

### Prerequisites
- Node.js 18+
- MetaMask with 0G Galileo testnet added (Chain ID: 16602, RPC: `https://evmrpc-testnet.0g.ai`)
- Testnet 0G tokens from [faucet.0g.ai](https://faucet.0g.ai)

### Install
```bash
git clone <your-repo>
cd vault
npm install
cp .env.example .env
# Fill in PRIVATE_KEY in .env
```

### Deploy Contract
```bash
npm run deploy
# Copy the printed address into .env as CONTRACT_ADDRESS
```

### Run
```bash
npm start
# Open http://localhost:3000
```

---

## Project Structure

```
vault/
├── contracts/
│   └── AgentNFT.sol          # ERC-721 agent NFT contract
├── scripts/
│   └── deploy.js             # Hardhat deploy to 0G Galileo
├── server/
│   ├── server.js             # Express API (train, chat, ownership check)
│   └── store.js              # File-backed agent + key store
├── public/
│   └── index.html            # Full frontend (7 screens)
├── hardhat.config.js
└── .env.example
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/config` | Returns contract address + chain config for frontend |
| `GET /api/agents` | Lists all published agents |
| `GET /api/agents/:id` | Single agent metadata |
| `POST /api/train` | Encrypt content → upload to 0G Storage → save key |
| `POST /api/chat` | Verify NFT ownership → fetch from 0G Storage → 0G Compute inference |

---

## Roadmap (Post Group Stage)

- **Upgrade NFTs** — creators publish new capability modules as separate NFTs. Owning an upgrade changes the agent's system prompt and knowledge context. Recurring revenue for creators.

- **Agent Trading** — sell your configured agent (with all its knowledge NFTs) as a bundle, cheaper than buying each piece individually.
- **Dynamic Agent NFT Art** — the NFT's visual representation evolves as the agent accumulates more knowledge, while the original art is permanently preserved on 0G Storage.

- **Trustless Decryption** — wallet-signed decryption requests so the server never holds the key.

__ Refinement, polishing and detailing of code. (making it look less of an "AI slop"

      
