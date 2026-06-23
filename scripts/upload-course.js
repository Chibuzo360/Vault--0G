/**
 * upload-course.js
 * 
 * Encrypts a course, uploads it to 0G Storage, then mints an NFT that
 * anchors the content hash on 0G Chain. Run this once per course before
 * launching the server.
 * 
 * Usage: node scripts/upload-course.js
 * 
 * On success it prints the rootHash and AES key. Add them to .env:
 *   COURSE_1_HASH=<rootHash>
 *   COURSE_1_KEY=<hexKey>
 *   (repeat for additional courses)
 */
require("dotenv").config();
const { ethers } = require("ethers");
const { Indexer, MemData, newSymmetricEncryptedFile } = require("@0gfoundation/0g-ts-sdk");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RPC_URL      = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const INDEXER_URL  = process.env.INDEXER_URL || "https://indexer-storage-testnet-turbo.0g.ai";
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.KNOWLEDGE_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;

const CONTRACT_ABI = [
  "function mintCourse(uint256 courseId, string contentHash, string title) returns (uint256)",
];

// The plaintext course content — swap these out for your real courses.
const COURSES = [
  {
    id: 1,
    title: "How Blockchains Reach Consensus",
    content: `A blockchain is a shared ledger copied across many independent computers, called nodes. The hard problem it solves is consensus: how do thousands of nodes that don't trust each other agree on the exact same order of transactions, with no single party in charge?

Proof of Work solves this by making nodes compete to solve a computationally expensive puzzle; whoever solves it first proposes the next block, and the cost of the puzzle makes it expensive to cheat. Proof of Stake solves it differently: instead of burning electricity, validators lock up (stake) their own tokens as collateral, and lose that stake if they try to approve fraudulent blocks.

Once a block is added and enough later blocks are built on top of it, rewriting history would require redoing all that work or stake, which becomes practically impossible. This is why blockchains are described as immutable.

Layer 1 chains like Ethereum or 0G handle this consensus directly; Layer 2s and modular chains instead split jobs like execution, data availability, and storage across specialized networks to scale further, which is the design 0G itself uses by separating its Chain, Storage, and Compute layers.`
  },
  {
    id: 2,
    title: "Special Relativity in Plain Language",
    content: `Special relativity rests on two simple postulates. First: the laws of physics are the same for every observer moving at a constant speed — there's no special 'rest frame' for the universe. Second, and the strange one: the speed of light in a vacuum is the same for every observer, no matter how fast they themselves are moving.

That second postulate breaks our intuition. If you're on a train moving at half the speed of light and you shine a flashlight forward, common sense says the light should travel at light-speed plus your train's speed. Experiments show it doesn't — light still measures as moving at exactly the same speed for you and for someone standing still on the platform.

The only way both postulates can be true at once is if time and space themselves stretch to compensate. Someone moving relative to you experiences time more slowly (time dilation) and measures lengths in the direction of motion as shorter (length contraction), from your point of view. Neither observer feels 'wrong' — each is correct in their own reference frame.

This isn't just theory: GPS satellites have to correct for relativistic time dilation every day, or your phone's location would drift by kilometers.`
  }
];

async function uploadCourse(course, indexer, signer) {
  console.log(`\n--- Uploading: "${course.title}" ---`);

  // 1. Generate a fresh AES-256 key for this course
  const key = crypto.randomBytes(32);
  console.log("Generated AES-256 key:", key.toString("hex"));

  // 2. Wrap the plaintext in MemData and encrypt it
  const memData = new MemData(Buffer.from(course.content, "utf8"));
  const encryptedFile = newSymmetricEncryptedFile(memData, key);
  console.log(`Encrypted content (${course.content.length} bytes plaintext)`);

  // 3. Upload to 0G Storage
  console.log("Uploading to 0G Storage...");
  const [tx, err] = await indexer.upload(encryptedFile, RPC_URL, signer);
  if (err !== null) throw new Error("Upload failed: " + err.message);

  const rootHash = "rootHash" in tx ? tx.rootHash : tx.rootHashes[0];
  console.log("Uploaded. Root hash:", rootHash);
  console.log("Storage tx hash:", "txHash" in tx ? tx.txHash : tx.txHashes[0]);

  // 4. Mint the NFT with the root hash baked in
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  console.log("Minting NFT on 0G Chain...");
  const mintTx = await contract.mintCourse(course.id, rootHash, course.title);
  const receipt = await mintTx.wait();
  console.log("NFT minted. Chain tx:", receipt.hash);
  console.log("View on chainscan: https://chainscan-galileo.0g.ai/tx/" + receipt.hash);

  return { courseId: course.id, rootHash, keyHex: key.toString("hex") };
}

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY in .env first.");
    process.exit(1);
  }
  if (!process.env.KNOWLEDGE_CONTRACT_ADDRESS && !process.env.CONTRACT_ADDRESS) {
    console.error("Set KNOWLEDGE_CONTRACT_ADDRESS in .env.");
    console.error("Deploy KnowledgeNFT with: npx hardhat run scripts/deploy-knowledge.js --network galileo");
    console.error("(Do not use the AgentNFT CONTRACT_ADDRESS — this script calls mintCourse on KnowledgeNFT.)");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
  const indexer  = new Indexer(INDEXER_URL);

  const results = [];
  for (const course of COURSES) {
    const result = await uploadCourse(course, indexer, signer);
    results.push(result);
  }

  console.log("\n=== DONE — add these to your .env ===");
  for (const r of results) {
    console.log(`COURSE_${r.courseId}_HASH=${r.rootHash}`);
    console.log(`COURSE_${r.courseId}_KEY=${r.keyHex}`);
  }
  console.log("\nThen restart the server: npm start");
}

main().catch(e => { console.error(e); process.exit(1); });
