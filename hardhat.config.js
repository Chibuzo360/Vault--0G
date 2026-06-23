require("@nomicfoundation/hardhat-toolbox");
// This safely loads a local .env file if it exists, but won't crash if it doesn't
try {
  require("dotenv").config();
} catch (e) {
  // Silent catch for production environments where dotenv isn't needed
}

// Fallback logic that checks system memory first, then hardcoded values
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""; 

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    galileo: {
      url: process.env.RPC_URL || "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};