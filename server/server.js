import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(root, "data");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const TICKET_REQUESTS_FILE = path.join(DATA_DIR, "ticket-requests.json");

const AGENT_SECRET = process.env.AI_AGENT_API_SECRET || "dev-agent-secret";

const MARKETPLACE_ABI = [
  "function sendAgentTicket(uint256 listingId,address recipient,string reason) external returns (uint256)",
  "function agentCreateListingFromSubmission(uint256 submissionId,uint256 priceWei,uint256 maxTickets,string ticketMetadataURI) external returns (uint256)",
  "function createListing(string title,string metadataURI,string greenfieldBucket,string greenfieldObject,string greenfieldGroup,uint256 priceWei,uint256 maxTickets,address artistWallet) external returns (uint256)"
];

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(root, "public")));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function requireAgent(req, res, next) {
  const provided = req.headers["x-ai-agent-secret"];
  if (provided !== AGENT_SECRET) {
    return res.status(401).json({ error: "Unauthorized AI agent" });
  }
  next();
}

function getMarketplaceContract() {
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL;
  const privateKey = process.env.AI_AGENT_PRIVATE_KEY;
  const contractAddress = process.env.MARKETPLACE_ADDRESS;

  if (!rpcUrl || !privateKey || !contractAddress) {
    return null;
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  return new ethers.Contract(contractAddress, MARKETPLACE_ABI, wallet);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Banshee AI music ticket backend",
    chain: "BSC Testnet",
    storage: "BNB Greenfield"
  });
});

app.get("/api/listings", (_req, res) => {
  const listings = readJson(LISTINGS_FILE, []);
  res.json({ listings });
});

/**
 * AI agent uploads/posts a music ticket listing to the platform.
 * This is the backend bridge for:
 * Artist submission -> AI review -> verified listing appears in the UI.
 */
app.post("/api/agent/listings", requireAgent, async (req, res) => {
  const {
    title,
    artistName,
    artistWallet,
    ticketMetadataURI,
    greenfieldBucket,
    greenfieldObject,
    greenfieldGroup,
    priceWei = "0",
    maxTickets = 1000,
    submissionId
  } = req.body;

  if (!title || !artistName || !ticketMetadataURI || !greenfieldBucket || !greenfieldObject) {
    return res.status(400).json({
      error: "Missing title, artistName, ticketMetadataURI, greenfieldBucket, or greenfieldObject"
    });
  }

  const listings = readJson(LISTINGS_FILE, []);
  const nextId = listings.length > 0 ? Math.max(...listings.map((item) => Number(item.id))) + 1 : 1;

  const listing = {
    id: nextId,
    title,
    artistName,
    artistWallet: artistWallet || ethers.constants.AddressZero,
    ticketMetadataURI,
    greenfieldBucket,
    greenfieldObject,
    greenfieldGroup: greenfieldGroup || `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-holders`,
    priceWei: String(priceWei),
    maxTickets: Number(maxTickets),
    submissionId: submissionId || null,
    active: true,
    createdBy: "BNB_AI_AGENT",
    createdAt: new Date().toISOString(),
    txHash: null
  };

  const contract = getMarketplaceContract();

  if (contract) {
    try {
      let tx;

      if (submissionId) {
        tx = await contract.agentCreateListingFromSubmission(
          submissionId,
          priceWei,
          maxTickets,
          ticketMetadataURI
        );
      } else {
        tx = await contract.createListing(
          title,
          ticketMetadataURI,
          greenfieldBucket,
          greenfieldObject,
          listing.greenfieldGroup,
          priceWei,
          maxTickets,
          listing.artistWallet
        );
      }

      const receipt = await tx.wait();
      listing.txHash = receipt.transactionHash;
    } catch (error) {
      return res.status(500).json({
        error: "On-chain listing failed",
        details: error.message
      });
    }
  }

  listings.push(listing);
  writeJson(LISTINGS_FILE, listings);

  res.json({
    ok: true,
    mode: contract ? "onchain-and-local" : "local-dev",
    listing
  });
});

/**
 * Frontend asks the AI agent backend to send/mint an NFT ticket to the user's wallet.
 */
app.post("/api/tickets/request", async (req, res) => {
  const { listingId, recipient, reason = "frontend-request" } = req.body;

  if (!listingId || !recipient || !ethers.utils.isAddress(recipient)) {
    return res.status(400).json({ error: "Invalid listingId or recipient" });
  }

  const listings = readJson(LISTINGS_FILE, []);
  const listing = listings.find((item) => Number(item.id) === Number(listingId) && item.active);

  if (!listing) {
    return res.status(404).json({ error: "Listing not found or inactive" });
  }

  const request = {
    id: Date.now(),
    listingId: Number(listingId),
    recipient,
    reason,
    status: "queued",
    txHash: null,
    createdAt: new Date().toISOString()
  };

  const contract = getMarketplaceContract();

  if (contract) {
    try {
      const tx = await contract.sendAgentTicket(listingId, recipient, reason);
      const receipt = await tx.wait();
      request.status = "sent";
      request.txHash = receipt.transactionHash;
    } catch (error) {
      request.status = "failed";
      request.error = error.message;
      const requests = readJson(TICKET_REQUESTS_FILE, []);
      requests.push(request);
      writeJson(TICKET_REQUESTS_FILE, requests);

      return res.status(500).json({
        error: "On-chain ticket mint failed",
        details: error.message
      });
    }
  }

  if (!contract) {
    request.status = "accepted-local-dev";
  }

  const requests = readJson(TICKET_REQUESTS_FILE, []);
  requests.push(request);
  writeJson(TICKET_REQUESTS_FILE, requests);

  res.json({
    ok: true,
    mode: contract ? "onchain" : "local-dev",
    request,
    txHash: request.txHash
  });
});

app.post("/api/agent/tickets/send", requireAgent, async (req, res) => {
  const { listingId, recipient, reason = "ai-agent-airdrop" } = req.body;

  if (!listingId || !recipient || !ethers.utils.isAddress(recipient)) {
    return res.status(400).json({ error: "Invalid listingId or recipient" });
  }

  const contract = getMarketplaceContract();
  const request = {
    id: Date.now(),
    listingId: Number(listingId),
    recipient,
    reason,
    status: "queued",
    txHash: null,
    createdAt: new Date().toISOString()
  };

  if (contract) {
    try {
      const tx = await contract.sendAgentTicket(listingId, recipient, reason);
      const receipt = await tx.wait();
      request.status = "sent";
      request.txHash = receipt.transactionHash;
    } catch (error) {
      request.status = "failed";
      request.error = error.message;
      return res.status(500).json({
        error: "On-chain ticket mint failed",
        details: error.message
      });
    }
  } else {
    request.status = "accepted-local-dev";
  }

  const requests = readJson(TICKET_REQUESTS_FILE, []);
  requests.push(request);
  writeJson(TICKET_REQUESTS_FILE, requests);

  res.json({
    ok: true,
    mode: contract ? "onchain" : "local-dev",
    request
  });
});

app.listen(PORT, () => {
  console.log(`Banshee backend running at http://localhost:${PORT}`);
});
