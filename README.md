# Vault — AI Agent NFT Marketplace on 0G

Creators train AI agents on private knowledge, encrypt the training data, and publish them as NFTs on 0G Chain. Buyers acquire an agent — not the raw content — and chat with it through 0G Compute. **Everything is signed and paid from your MetaMask wallet.** No server private key required.

## Wallet-first flow

1. **Connect MetaMask** — prompted automatically on page load
2. **Deploy marketplace** — one-time `AgentNFT` deploy from the browser (if none exists yet)
3. **Create agents** — encrypt → 0G Storage → `createTemplate` on-chain
4. **Acquire agents** — `mintAgent` from Explore
5. **Chat** — ownership verified on-chain, inference via 0G Compute (your wallet pays)

## Quick start

```bash
npm install
npm run compile   # needed once so the browser can deploy AgentNFT
npm start
```

Open **http://localhost:3000** and connect MetaMask on **0G Galileo Testnet** (chain ID **16602**).

Fund your wallet from the [0G faucet](https://faucet.0g.ai) — your wallet pays for gas, storage uploads, and compute.

**No `.env` private key or contract address needed** for the web app.

## What the server does (minimal)

| Role | Details |
|------|---------|
| Static UI | Serves `public/index.html` + client JS |
| Contract artifact | `GET /api/artifact/AgentNFT` — bytecode for browser deploy |
| Shared contract | `GET/POST /api/contract` — remembers deployed address for all users |
| Decryption keys | Stores AES keys per agent; released only after on-chain ownership check |

The server never holds a wallet or signs transactions.

## Architecture

```
Browser (MetaMask)
  ├─ Deploy AgentNFT
  ├─ Encrypt + upload training data → 0G Storage
  ├─ createTemplate / mintAgent → 0G Chain
  ├─ Register decryption key → server
  └─ Chat: verify ownership → decrypt → 0G Compute inference

Server (no private key)
  ├─ Serve UI + contract artifact
  ├─ Store shared contract address
  └─ Store/release decryption keys (ownership-gated)
```

## Optional `.env`

```env
RPC_URL=https://evmrpc-testnet.0g.ai
INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
PORT=3000
```

Only needed for `scripts/upload-course.js` (legacy KnowledgeNFT flow):

```env
PRIVATE_KEY=...
KNOWLEDGE_CONTRACT_ADDRESS=...
```

## Troubleshooting

- **MetaMask doesn't pop up** — allow popups; click Connect Wallet on the overlay
- **Deploy fails** — run `npm run compile` first; ensure faucet balance on Galileo
- **"Decryption key not registered"** — creator must finish publish (key is saved after `createTemplate`)
- **0G Compute errors** — testnet provider availability fluctuates; retry or check [compute marketplace](https://compute-marketplace.0g.ai/inference)
- **Chat 403** — use the wallet that owns the agent NFT

## What's next

- Paid listings instead of free `mintAgent`
- Encrypt decryption keys per-buyer at acquire time
- On-chain agent discovery without server key store
- Verifiability badge in chat UI
