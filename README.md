# Vault — Knowledge NFTs with AI agents on 0G

A Zero Cup MVP. Mint an NFT to unlock a course, then an AI agent — running through
0G Compute — answers questions using only that course's content. Ownership is
checked on-chain (0G Chain) before the agent will respond.

This is deliberately scoped down: no encryption, no marketplace, no badge system yet.
Those are documented in "What's next" below — add them between rounds if you clear
the cut, that's literally how the tournament is designed to work.

## What's real here (not a mock)

- **0G Chain**: `KnowledgeNFT.sol` is a real ERC-721 deployed to the Galileo testnet.
  Minting is a real on-chain transaction your wallet signs — judges can verify it on
  [chainscan-galileo.0g.ai](https://chainscan-galileo.0g.ai).
- **0G Compute**: the agent's answers come from an actual inference call routed
  through the 0G Compute Network broker (`@0gfoundation/0g-compute-ts-sdk`), not a
  hardcoded response or a call to a centralized API.
- **Access gating**: the backend calls `holdsCourse(wallet, courseId)` on the deployed
  contract before it will let the agent answer — if you don't own the NFT, you get a
  403, not a fallback answer.

## One-time setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create your `.env`** (copy `.env.example`) and fill in `PRIVATE_KEY` with the
   private key of the wallet you funded from the faucet. Leave `CONTRACT_ADDRESS`
   blank for now.

3. **Deploy the contract**
   ```bash
   npm run deploy
   ```
   This prints a contract address and a chainscan link. Copy the address into
   `CONTRACT_ADDRESS` in your `.env`.

4. **Fund your wallet for 0G Compute** — separate from the gas you used to deploy,
   the same wallet needs a small balance to pay for inference. The server creates
   this automatically on first run (`broker.ledger.addLedger(0.1)`), so as long as
   your wallet has testnet 0G tokens, no extra manual step is needed.

## Run it

```bash
npm start
```

Open `http://localhost:3000`. Connect your wallet (it'll prompt you to add/switch
to the Galileo testnet automatically), mint a course, then ask the agent something
about it. Try asking it something the course material doesn't cover — it should
say it can't answer from the material, not make something up.

## Demoing this for judges

The single most convincing thing you can show: mint, then immediately ask a
question that's clearly answered using your course content and nothing else,
then point at the mint transaction on chainscan. That's "0G doing real work"
in under 60 seconds, which is exactly what the submission criteria reward.

A short demo video covering connect → mint → ask → chainscan proof is enough;
you don't need a polished script, just don't fake any step.

## What's next (add between rounds, not before June 23)

- **0G Storage**: instead of `server/courses.json`, upload course content
  (encrypted) to 0G Storage and store the CID on the NFT. This is the natural
  next pillar to add and strengthens the "0G does real work" story further.
- **Badges as agent capabilities**: a second NFT contract where owning a
  "Quiz Master" badge changes the agent's system prompt to generate quizzes
  instead of just answering questions. Same gating pattern as courses, just
  a second `holdsBadge()` check that swaps which system prompt gets used.
- **A real marketplace**: fixed-price listing and buying instead of free mint,
  so course creators can actually charge for access.
- **Verifiability in the UI**: the agent's answer already gets verified via
  `processResponse` — surface that more visibly ("response cryptographically
  verified" badge) since 0G's TEE-based verification is a feature judges
  who know the stack will specifically look for.

## Troubleshooting

- **"No chatbot provider currently available"**: 0G Compute provider
  availability can fluctuate on testnet — check
  `https://compute-marketplace.0g.ai/inference` to see what's currently live,
  or just retry.
- **Mint transaction fails**: check your wallet is on the Galileo testnet
  (chain ID 16602) and has a balance from `faucet.0g.ai`.
- **`/api/ask` returns 403 even after minting**: make sure the wallet you're
  connected with in the browser is the same one that minted — ownership is
  checked per-wallet, not per-browser-session.
