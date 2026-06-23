const hre = require("hardhat");

async function main() {
  console.log("Deploying KnowledgeNFT to 0G Galileo Testnet...");
  const KnowledgeNFT = await hre.ethers.getContractFactory("KnowledgeNFT");
  const contract = await KnowledgeNFT.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("\nKnowledgeNFT deployed to:", address);
  console.log("Chainscan:              https://chainscan-galileo.0g.ai/address/" + address);
  console.log("\nNext: add this to your .env as KNOWLEDGE_CONTRACT_ADDRESS=" + address);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
