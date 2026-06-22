const hre = require("hardhat");

async function main() {
  console.log("Deploying AgentNFT to 0G Galileo Testnet...");
  const AgentNFT = await hre.ethers.getContractFactory("AgentNFT");
  const contract = await AgentNFT.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("\nAgentNFT deployed to:", address);
  console.log("Chainscan:           https://chainscan-galileo.0g.ai/address/" + address);
  console.log("\nNext: add this to your .env as CONTRACT_ADDRESS=" + address);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
