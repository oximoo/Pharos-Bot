const axios = require("axios");
const crypto = require("crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const chalk = require("chalk").default || require("chalk");
const UserAgent = require("fake-useragent");
const ethers = require("ethers");

// ---- CONSTANTS ----
const PUBLIC_KEY_PEM = `
-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDWPv2qP8+xLABhn3F/U/hp76HP
e8dD7kvPUh70TC14kfvwlLpCTHhYf2/6qulU1aLWpzCz3PJr69qonyqocx8QlThq
5Hik6H/5fmzHsjFvoPeGN5QRwYsVUH07MbP7MNbJH5M2zD5Z1WEp9AHJklITbS1z
h23cf2WfZ0vwDYzZ8QIDAQAB
-----END PUBLIC KEY-----
`;

const RPC_URL = "https://testnet.dplabs-internal.com/";
const USDC_CONTRACT_ADDRESS = "0x72df0bcd7276f2dFbAc900D1CE63c272C4BCcCED";
const USDT_CONTRACT_ADDRESS = "0xD4071393f8716661958F766DF660033b3d35fD29";
const MUSD_CONTRACT_ADDRESS = "0x7F5e05460F927Ee351005534423917976F92495e";
const mvMUSD_CONTRACT_ADDRESS = "0xF1CF5D79bE4682D50f7A60A047eACa9bD351fF8e";
const STAKING_ROUTER_ADDRESS = "0x11cD3700B310339003641Fdce57c1f9BD21aE015";
const HOST_URL = "https://autostaking.pro";
const FALLBACK_BASE_API = "https://asia-east2-auto-staking.cloudfunctions.net";

const ERC20_CONTRACT_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "address", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "claimFaucet",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const AUTOSTAKING_CONTRACT_ABI = [
  {
    type: "function",
    name: "getNextFaucetClaimTime",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const PROMPT = `1. Mandatory Requirement: The product's TVL must be higher than one million USD.
2. Balance Preference: Prioritize products that have a good balance of high current APY and high TVL.
3. Portfolio Allocation: Select the 3 products with the best combined ranking in terms of current APY and TVL among those with TVL > 1,000,000 USD. To determine the combined ranking, rank all eligible products by current APY (highest to lowest) and by TVL (highest to lowest), then sum the two ranks for each product. Choose the 3 products with the smallest sum of ranks. Allocate the investment equally among these 3 products, with each receiving approximately 33.3% of the investment.`;

// ---- UTILITY FUNCTIONS ----
function formatLogMessage(msg) {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " WIB";
  msg = (msg || "").toString().trim();
  if (!msg) return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.whiteBright(" | Empty log");

  const parts = msg.split("|").map((s) => s?.trim() || "");
  const walletName = parts[0] || "System";
  const message = parts.slice(1).join(" | ").trim();

  // System messages
  if (walletName === "System") {
    if (message.includes("Starting") || message.includes("Base API URL") || message.includes("All Accounts")) {
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.whiteBright(` | ${message}`);
    }
    if (message.includes("Warning")) {
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.yellowBright.bold(` | ${message}`);
    }
    if (message.includes("Error") || message.includes("Failed")) {
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.redBright.bold(` | ${message}`);
    }
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.whiteBright(` | ${message}`);
  }

  // Wallet-specific messages
  if (message.includes("=====")) {
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` | ${message}`);
  }
  if (message.startsWith("Faucet:") || message.startsWith("Staking:") || message.startsWith("Balance:") || message.startsWith("Amount:")) {
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.blueBright.bold(` | ${message}`);
  }
  if (message.startsWith("1.") || message.startsWith("2.") || message.startsWith("3.")) {
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.whiteBright(` |     ${message.replace(/^\d\./, "   " + chalk.magentaBright.bold(`${message[0]}.`))}`);
  }
  if (message.startsWith("Stake ")) {
    const stakeInfo = message.match(/Stake (\d+) of (\d+)/);
    if (stakeInfo) {
      const [_, current, total] = stakeInfo;
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.greenBright.bold(` | ●`) + chalk.blueBright.bold(` Stake `) + chalk.whiteBright(`${current}`) + chalk.magentaBright.bold(` Of `) + chalk.whiteBright(`${total}                                   `);
    }
  }
  if (message.includes("Success")) {
    if (message.includes("Block:") || message.includes("Tx Hash:") || message.includes("Explorer:")) {
      const [key, value] = message.split(": ").map(s => s.trim());
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     ${key}:`) + chalk.greenBright.bold(` Success`) + (value ? chalk.whiteBright(` ${value}`) : "");
    }
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     Status:`) + chalk.greenBright.bold(` Success`);
  }
  if (message.includes("Approved")) {
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     Approve:`) + chalk.greenBright.bold(` Success`);
  }
  if (message.includes("Warning") || message.includes("Already Claimed") || message.includes("Insufficient")) {
    if (message.includes("Next Claim at")) {
      const [status, nextClaim] = message.split(" - ");
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     Status:`) + chalk.yellowBright.bold(` Already Claimed`) + chalk.cyanBright.bold(` -`) + chalk.cyanBright.bold(` Next Claim at `) + chalk.whiteBright(nextClaim);
    }
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     Status:`) + chalk.yellowBright.bold(` ${message.replace("Warning: ", "")}`);
  }
  if (message.includes("Error") || message.includes("Failed")) {
    return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.cyanBright.bold(` |     Status:`) + chalk.redBright.bold(` ${message.replace("Error: ", "")}`);
  }
  if (message.includes("Wait For")) {
    const delay = message.match(/Wait For (\d+) Seconds/);
    if (delay) {
      return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.blueBright.bold(` | Wait For`) + chalk.whiteBright(` ${delay[1]} `) + chalk.blueBright.bold(`Seconds For Next Tx...`);
    }
  }

  return chalk.cyanBright.bold(`[${timestamp}]`) + chalk.whiteBright(` | ${message}`);
}

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    if (proxyUrl.startsWith("socks")) {
      return new SocksProxyAgent(proxyUrl);
    } else if (proxyUrl.startsWith("http")) {
      return new HttpsProxyAgent(proxyUrl);
    }
    return null;
  } catch (error) {
    return null;
  }
}

function getEthersProvider(proxyUrl = null) {
  const options = {
    headers: { "User-Agent": "Mozilla/5.0" },
  };
  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    if (agent) options.agent = agent;
  }
  return new ethers.JsonRpcProvider(RPC_URL, undefined, options);
}

async function checkConnection(proxyUrl = null) {
  try {
    const config = {
      method: "get",
      url: "https://api.ipify.org?format=json",
      headers: { "User-Agent": new UserAgent().random },
      timeout: 10000,
    };
    if (proxyUrl) {
      const agent = createProxyAgent(proxyUrl);
      if (agent) {
        config.httpsAgent = agent;
        config.httpAgent = agent;
      }
    }
    await axios(config);
    return true;
  } catch (error) {
    return false;
  }
}

async function fetchBaseApi(retries = 5, proxyUrl = null) {
  const url = `${HOST_URL}/_next/static/chunks/5603-ca6c90d1ea776b3f.js`;
  const config = {
    method: "get",
    url,
    headers: { "User-Agent": new UserAgent().random },
    timeout: 60000,
  };
  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    if (agent) {
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      const match = response.data.match(/r\s*=\s*o\.Z\s*\?\s*"([^"]+)"/);
      if (match && match[1]) {
        formatLogMessage(`System | Base API URL: ${match[1]}/auto_staking_pharos_v6`);
        return `${match[1]}/auto_staking_pharos_v6`;
      }
      throw new Error("Base API URL not found in response");
    } catch (error) {
      formatLogMessage(`System | Warning: Failed to fetch Base API URL (attempt ${attempt}/${retries}): ${error.message}`);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        formatLogMessage(`System | Warning: Using fallback Base API URL: ${FALLBACK_BASE_API}/auto_staking_pharos_v6`);
        return `${FALLBACK_BASE_API}/auto_staking_pharos_v6`;
      }
    }
  }
}

async function makeApiRequest(method, url, data = null, headers = {}, proxyUrl = null, rotateProxy = false, proxies = [], retries = 5) {
  const userAgent = new UserAgent();
  const defaultHeaders = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: "https://autostaking.pro",
    Referer: "https://autostaking.pro/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent": userAgent.random,
    ...headers,
  };
  const config = { method, url, headers: defaultHeaders, timeout: 60000 };
  if (data) {
    config.data = data;
    config.headers["Content-Length"] = Buffer.byteLength(JSON.stringify(data));
  }
  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    if (agent) {
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }
  }
  let currentProxy = proxyUrl;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      const errorMsg = error.response
        ? `HTTP ${error.response.status}: ${error.response.data?.msg || error.message}`
        : error.message;
      formatLogMessage(`System | Warning: API request failed (attempt ${attempt}/${retries}): ${errorMsg}`);
      if (error.response && error.response.status === 429) {
        const delay = Math.pow(2, attempt) * 2000;
        formatLogMessage(`System | Warning: Rate limit hit (429), retrying after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (rotateProxy && proxies.length > 1) {
          const proxyIndex = proxies.indexOf(currentProxy);
          currentProxy = proxies[(proxyIndex + 1) % proxies.length] || null;
          config.httpsAgent = createProxyAgent(currentProxy);
          config.httpAgent = createProxyAgent(currentProxy);
        }
        continue;
      }
      if (error.response && error.response.status === 404) {
        formatLogMessage(`System | Warning: API request failed with 404, retrying without Authorization`);
        config.headers.Authorization = undefined;
        try {
          const response = await axios(config);
          return response.data;
        } catch (retryError) {
          formatLogMessage(`System | Warning: Retry without Authorization failed: ${retryError.message}`);
        }
      }
      if (attempt === retries) {
        throw new Error(errorMsg);
      }
      if (rotateProxy && proxies.length > 1) {
        const proxyIndex = proxies.indexOf(currentProxy);
        currentProxy = proxies[(proxyIndex + 1) % proxies.length] || null;
        config.httpsAgent = createProxyAgent(currentProxy);
        config.httpAgent = createProxyAgent(currentProxy);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// ---- MAIN FUNCTION ----
async function performAutoStakingTask(
  logger,
  privateKeys,
  proxies,
  stakingCount,
  minDelay,
  maxDelay,
  usdcAmount,
  usdtAmount,
  musdAmount,
  useProxy,
  rotateProxy,
  usedNonces
) {
  logger("System | Starting AutoStaking Task...");

  // Try fetching BASE_API with and without proxy
  let BASE_API = await fetchBaseApi(5, useProxy ? proxies[0] || null : null);
  if (!BASE_API) {
    logger("System | Warning: Failed to fetch Base API URL with proxy, trying without proxy...");
    BASE_API = await fetchBaseApi(5, null);
  }
  if (!BASE_API) {
    logger("System | Error: Failed to fetch Base API URL after all attempts");
    return;
  }

  const generateAddress = (privateKey) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } catch (error) {
      logger(`System | Error: Invalid Private Key or Library Version Not Supported: ${error.message}`);
      return null;
    }
  };

  const getShortAddress = (address) => {
    return address ? `${address.slice(0, 6)}******${address.slice(-6)}` : "N/A";
  };

  const generateAuthToken = (address) => {
    try {
      const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
      const ciphertext = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(address)
      );
      return ciphertext.toString("base64");
    } catch (error) {
      logger(`System | Error: Cryptography Library Version Not Supported: ${error.message}`);
      return null;
    }
  };

  const generateRecommendationPayload = (address) => {
    try {
      const usdcAssets = Math.floor(usdcAmount * 10 ** 6);
      const usdtAssets = Math.floor(usdtAmount * 10 ** 6);
      const musdAssets = Math.floor(musdAmount * 10 ** 6);

      return {
        user: address,
        profile: PROMPT,
        userPositions: [],
        userAssets: [
          {
            chain: { id: 688688 },
            name: "USDC",
            symbol: "USDC",
            decimals: 6,
            address: USDC_CONTRACT_ADDRESS,
            assets: usdcAssets.toString(),
            price: 1,
            assetsUsd: usdcAmount,
          },
          {
            chain: { id: 688688 },
            name: "USDT",
            symbol: "USDT",
            decimals: 6,
            address: USDT_CONTRACT_ADDRESS,
            assets: usdtAssets.toString(),
            price: 1,
            assetsUsd: usdtAmount,
          },
          {
            chain: { id: 688688 },
            name: "MockUSD",
            symbol: "MockUSD",
            decimals: 6,
            address: MUSD_CONTRACT_ADDRESS,
            assets: musdAssets.toString(),
            price: 1,
            assetsUsd: musdAmount,
          },
        ],
        chainIds: [688688],
        tokens: ["USDC", "USDT", "MockUSD"],
        protocols: ["MockVault"],
        env: "pharos",
      };
    } catch (error) {
      throw new Error(`Generate Recommendation Payload Failed: ${error.message}`);
    }
  };

  const generateTransactionsPayload = (address, changeTx) => {
    try {
      return {
        user: address,
        changes: changeTx,
        prevTransactionResults: {},
      };
    } catch (error) {
      throw new Error(`Generate Transactions Payload Failed: ${error.message}`);
    }
  };

  const getEthersWithCheck = async (address, proxyUrl, retries = 3) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const provider = getEthersProvider(proxyUrl);
        await provider.getBlockNumber();
        return provider;
      } catch (error) {
        if (attempt < retries - 1) {
          logger(`${getShortAddress(address)} | Warning: RPC connection attempt ${attempt + 1} failed: ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        throw new Error(`Failed to Connect to RPC: ${error.message}`);
      }
    }
  };

  const getTokenBalance = async (address, contractAddress, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const contract = new ethers.Contract(contractAddress, ERC20_CONTRACT_ABI, provider);
      const balance = await contract.balanceOf(address);
      const decimals = await contract.decimals();
      return Number(ethers.formatUnits(balance, decimals));
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Get Token Balance Failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  };

  const sendTransactionWithRetries = async (wallet, tx, address, retries = 5) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const latestNonce = await wallet.getNonce("pending");
        tx.nonce = Math.max(latestNonce, usedNonces[address] || 0);
        const txResponse = await wallet.sendTransaction(tx);
        const receipt = await txResponse.wait(1, 300000);
        usedNonces[address] = tx.nonce + 1;
        return { transactionHash: txResponse.hash, blockNumber: receipt.blockNumber };
      } catch (error) {
        if (error.message.includes("nonce too low") || error.message.includes("transaction underpriced")) {
          tx.maxFeePerGas = ethers.parseUnits("1", "gwei");
          tx.maxPriorityFeePerGas = ethers.parseUnits("1", "gwei");
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
          continue;
        }
        logger(`${getShortAddress(address)} | Warning: [Attempt ${attempt + 1}] Send TX Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
    }
    throw new Error("Transaction Hash Not Found After Maximum Retries");
  };

  const getNextFaucetClaimTime = async (address, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const contract = new ethers.Contract(mvMUSD_CONTRACT_ADDRESS, AUTOSTAKING_CONTRACT_ABI, provider);
      const nextClaimTime = await contract.getNextFaucetClaimTime(address);
      return Number(nextClaimTime);
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Get Next Faucet Claim Time Failed: ${error.message}`);
      return null;
    }
  };

  const performClaimFaucet = async (privateKey, address, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(mvMUSD_CONTRACT_ADDRESS, ERC20_CONTRACT_ABI, wallet);

      // Check if claimFaucet function exists
      try {
        await contract.estimateGas.claimFaucet();
      } catch (error) {
        logger(`${getShortAddress(address)} | Warning: claimFaucet function not available in contract at ${mvMUSD_CONTRACT_ADDRESS}, skipping faucet claim`);
        return { txHash: null, blockNumber: null };
      }

      const gasEstimate = await contract.estimateGas.claimFaucet();
      const tx = await contract.claimFaucet({
        gasLimit: Math.floor(Number(gasEstimate) * 1.2),
        maxFeePerGas: ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        nonce: usedNonces[address] || await wallet.getNonce("pending"),
      });
      const receipt = await tx.wait(1, 300000);
      usedNonces[address] = (usedNonces[address] || 0) + 1;
      const explorer = `https://testnet.pharosscan.xyz/tx/${tx.hash}`;
      logger(`${getShortAddress(address)} |     Status: Success`);
      logger(`${getShortAddress(address)} |     Block: ${receipt.blockNumber}`);
      logger(`${getShortAddress(address)} |     Tx Hash: ${tx.hash}`);
      logger(`${getShortAddress(address)} |     Explorer: ${explorer}`);
      return { txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Perform Claim Faucet Failed: ${error.message}`);
      return { txHash: null, blockNumber: null };
    }
  };

  const approvingToken = async (privateKey, address, routerAddress, assetAddress, amount, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(assetAddress, ERC20_CONTRACT_ABI, wallet);
      const decimals = await contract.decimals();
      const amountToWei = ethers.parseUnits(amount.toString(), decimals);

      const allowance = await contract.allowance(address, routerAddress);
      if (allowance < amountToWei) {
        logger(`${getShortAddress(address)} | Approving token ${assetAddress}...`);
        const gasEstimate = await contract.estimateGas.approve(routerAddress, ethers.MaxUint256);
        const approveTx = await contract.approve(routerAddress, ethers.MaxUint256, {
          gasLimit: Math.floor(Number(gasEstimate) * 1.2),
          maxFeePerGas: ethers.parseUnits("1", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
          nonce: usedNonces[address] || await wallet.getNonce("pending"),
        });
        const receipt = await approveTx.wait(1, 300000);
        usedNonces[address] = (usedNonces[address] || 0) + 1;
        const explorer = `https://testnet.pharosscan.xyz/tx/${approveTx.hash}`;
        logger(`${getShortAddress(address)} |     Approve: Success`);
        logger(`${getShortAddress(address)} |     Block: ${receipt.blockNumber}`);
        logger(`${getShortAddress(address)} |     Tx Hash: ${approveTx.hash}`);
        logger(`${getShortAddress(address)} |     Explorer: ${explorer}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return true;
    } catch (error) {
      throw new Error(`Approving Token Contract Failed for ${assetAddress}: ${error.message}`);
    }
  };

  const financialPortfolioRecommendation = async (address, proxyUrl) => {
    try {
      const url = `${BASE_API}/investment/financial-portfolio-recommendation`;
      const data = generateRecommendationPayload(address);
      let response = await makeApiRequest(
        "post",
        url,
        data,
        {
          Authorization: authTokens[address],
          "Content-Type": "application/json",
        },
        proxyUrl,
        rotateProxy,
        proxies,
        5
      );
      if (!response || !response.data) {
        logger(`${getShortAddress(address)} | Warning: Retrying portfolio recommendation without Authorization...`);
        response = await makeApiRequest(
          "post",
          url,
          data,
          { "Content-Type": "application/json" },
          proxyUrl,
          rotateProxy,
          proxies,
          5
        );
      }
      if (!response || !response.data) {
        throw new Error("Invalid API Response");
      }
      return response;
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Fetch Financial Portfolio Recommendation Failed: ${error.message}`);
      return null;
    }
  };

  const generateChangeTransactions = async (address, changeTx, proxyUrl) => {
    try {
      const url = `${BASE_API}/investment/generate-change-transactions`;
      const data = generateTransactionsPayload(address, changeTx);
      const response = await makeApiRequest(
        "post",
        url,
        data,
        {
          Authorization: authTokens[address],
          "Content-Type": "application/json",
        },
        proxyUrl,
        rotateProxy,
        proxies,
        5
      );
      if (!response || !response.data) {
        throw new Error("Invalid API Response");
      }
      return response;
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Fetch Transaction Calldata Failed: ${error.message}`);
      return null;
    }
  };

  const performStaking = async (privateKey, address, changeTx, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);

      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, USDC_CONTRACT_ADDRESS, usdcAmount, proxyUrl);
      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, USDT_CONTRACT_ADDRESS, usdtAmount, proxyUrl);
      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, MUSD_CONTRACT_ADDRESS, musdAmount, proxyUrl);

      const transactions = await generateChangeTransactions(address, changeTx, proxyUrl);
      if (!transactions || !transactions.data || !transactions.data["688688"]) {
        throw new Error("Generate Transaction Calldata Failed or Invalid Response");
      }

      const calldata = transactions.data["688688"].data;
      const gasEstimate = await provider.estimateGas({
        from: address,
        to: STAKING_ROUTER_ADDRESS,
        data: calldata,
      });
      const tx = {
        to: STAKING_ROUTER_ADDRESS,
        data: calldata,
        gasLimit: Math.floor(Number(gasEstimate) * 1.2),
        maxFeePerGas: ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        nonce: usedNonces[address] || await wallet.getNonce("pending"),
      };

      const { transactionHash, blockNumber } = await sendTransactionWithRetries(wallet, tx, address);
      const explorer = `https://testnet.pharosscan.xyz/tx/${transactionHash}`;
      logger(`${getShortAddress(address)} |     Status: Success`);
      logger(`${getShortAddress(address)} |     Block: ${blockNumber}`);
      logger(`${getShortAddress(address)} |     Tx Hash: ${transactionHash}`);
      logger(`${getShortAddress(address)} |     Explorer: ${explorer}`);
      return { txHash: transactionHash, blockNumber };
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Perform On-Chain Staking Failed: ${error.message}`);
      return { txHash: null, blockNumber: null };
    }
  };

  const authTokens = {};
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxyUrl = useProxy ? proxies[i % proxies.length] || null : null;
    const address = generateAddress(privateKey);
    if (!address) {
      logger(`${getShortAddress("N/A")} | Error: Invalid Private Key or Library Version Not Supported`);
      continue;
    }

    logger(`System | =========================[${getShortAddress(address)}]=========================`);

    if (useProxy && proxyUrl) {
      logger(`${getShortAddress(address)} | Proxy: ${proxyUrl}`);
      const isValid = await checkConnection(proxyUrl);
      if (!isValid) {
        if (rotateProxy && proxies.length > 1) {
          const proxyIndex = proxies.indexOf(proxyUrl);
          const newProxy = proxies[(proxyIndex + 1) % proxies.length] || null;
          logger(`${getShortAddress(address)} | Warning: Connection Not 200 OK - Rotating to ${newProxy}`);
          proxies[i % proxies.length] = newProxy;
          continue;
        }
        logger(`${getShortAddress(address)} | Error: Connection Not 200 OK`);
        continue;
      }
    }

    authTokens[address] = generateAuthToken(address);
    if (!authTokens[address]) {
      logger(`${getShortAddress(address)} | Error: Cryptography Library Version Not Supported`);
      continue;
    }

    const provider = await getEthersWithCheck(address, proxyUrl);
    if (!provider) {
      logger(`${getShortAddress(address)} | Error: Web3 Not Connected`);
      continue;
    }

    usedNonces[address] = await new ethers.Wallet(privateKey, provider).getNonce("pending");

    // Claim Faucet
    logger(`${getShortAddress(address)} | Faucet:`);
    const nextClaimTime = await getNextFaucetClaimTime(address, proxyUrl);
    if (nextClaimTime === null) {
      logger(`${getShortAddress(address)} | Error: Get Next Faucet Claim Time Failed`);
    } else if (Math.floor(Date.now() / 1000) >= nextClaimTime) {
      const { txHash, blockNumber } = await performClaimFaucet(privateKey, address, proxyUrl);
      if (!txHash || !blockNumber) {
        logger(`${getShortAddress(address)} | Warning: Perform On-Chain Failed`);
      }
    } else {
      const nextClaimDate = new Date(nextClaimTime * 1000).toLocaleString("en-US", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      logger(`${getShortAddress(address)} | Warning: Already Claimed - Next Claim at ${nextClaimDate} WIB`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Perform Staking
    logger(`${getShortAddress(address)} | Staking:`);
    for (let j = 0; j < stakingCount; j++) {
      logger(`${getShortAddress(address)} | Stake ${j + 1} of ${stakingCount}`);

      logger(`${getShortAddress(address)} | Balance:`);
      const usdcBalance = await getTokenBalance(address, USDC_CONTRACT_ADDRESS, proxyUrl);
      logger(`${getShortAddress(address)} | 1. ${usdcBalance !== null ? usdcBalance.toFixed(6) : "N/A"} USDC`);
      const usdtBalance = await getTokenBalance(address, USDT_CONTRACT_ADDRESS, proxyUrl);
      logger(`${getShortAddress(address)} | 2. ${usdtBalance !== null ? usdtBalance.toFixed(6) : "N/A"} USDT`);
      const musdBalance = await getTokenBalance(address, MUSD_CONTRACT_ADDRESS, proxyUrl);
      logger(`${getShortAddress(address)} | 3. ${musdBalance !== null ? musdBalance.toFixed(6) : "N/A"} MockUSD`);

      logger(`${getShortAddress(address)} | Amount:`);
      logger(`${getShortAddress(address)} | 1. ${usdcAmount} USDC`);
      logger(`${getShortAddress(address)} | 2. ${usdtAmount} USDT`);
      logger(`${getShortAddress(address)} | 3. ${musdAmount} MockUSD`);

      if (usdcBalance === null || usdcBalance < usdcAmount) {
        logger(`${getShortAddress(address)} | Warning: Insufficient USDC Token Balance`);
        break;
      }
      if (usdtBalance === null || usdtBalance < usdtAmount) {
        logger(`${getShortAddress(address)} | Warning: Insufficient USDT Token Balance`);
        break;
      }
      if (musdBalance === null || musdBalance < musdAmount) {
        logger(`${getShortAddress(address)} | Warning: Insufficient MockUSD Token Balance`);
        break;
      }

      const portfolio = await financialPortfolioRecommendation(address, proxyUrl);
      if (portfolio) {
        const changeTx = portfolio.data.changes;
        const { txHash, blockNumber } = await performStaking(privateKey, address, changeTx, proxyUrl);
        if (txHash && blockNumber) {
          logger(`${getShortAddress(address)} |     Status: Success`);
        } else {
          logger(`${getShortAddress(address)} | Warning: Perform On-Chain Failed`);
        }
      } else {
        logger(`${getShortAddress(address)} | Error: Fetch Financial Portfolio Recommendation Failed`);
      }

      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
      logger(`${getShortAddress(address)} | Wait For ${delay} Seconds For Next Tx...`);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }

    if (i < privateKeys.length - 1) {
      const accountDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
      logger(`System | Wait For ${accountDelay} Seconds For Next Account...`);
      await new Promise((resolve) => setTimeout(resolve, accountDelay * 1000));
    }
  }

  logger("System | All Accounts Have Been Processed.");
}

module.exports = { performAutoStakingTask };
