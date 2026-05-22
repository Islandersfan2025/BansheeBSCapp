# Banshee Connected Frontend + Backend

This package connects the graffiti HTML frontend to a simple Express backend.

## What works

- Frontend loads ticket listings from `/api/listings`.
- Clicking a drop connects to MetaMask and requests a ticket through `/api/tickets/request`.
- The BNB AI agent can post verified Greenfield music listings through `/api/agent/listings`.
- The BNB AI agent can airdrop/send tickets through `/api/agent/tickets/send`.
- If contract env values are not configured, the backend runs in local-dev mode and stores listings/requests in JSON files.
- If contract env values are configured, the backend calls the marketplace contract with `ethers`.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Optional environment

This can run without `.env`, but on-chain ticket minting needs:

```bash
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545
AI_AGENT_PRIVATE_KEY=0x...
MARKETPLACE_ADDRESS=0x...
AI_AGENT_API_SECRET=dev-agent-secret
PORT=3000
```

## AI agent posts a listing

```bash
curl -X POST http://localhost:3000/api/agent/listings \
  -H "Content-Type: application/json" \
  -H "x-ai-agent-secret: dev-agent-secret" \
  -d '{
    "title": "Nova Alley",
    "artistName": "Nova.exe",
    "artistWallet": "0x0000000000000000000000000000000000000000",
    "ticketMetadataURI": "greenfield://banshee-demo/metadata/nova-alley.json",
    "greenfieldBucket": "banshee-demo",
    "greenfieldObject": "music/nova-alley.mp3",
    "greenfieldGroup": "nova-alley-ticket-holders",
    "priceWei": "0",
    "maxTickets": 500
  }'
```

## AI agent sends a ticket

```bash
curl -X POST http://localhost:3000/api/agent/tickets/send \
  -H "Content-Type: application/json" \
  -H "x-ai-agent-secret: dev-agent-secret" \
  -d '{
    "listingId": 1,
    "recipient": "0xYourWallet",
    "reason": "demo-airdrop"
  }'
```

## Frontend mint/request flow

The frontend calls:

```text
POST /api/tickets/request
```

with:

```json
{
  "listingId": 1,
  "recipient": "0xFanWallet",
  "reason": "frontend-play-mint"
}
```

The backend either:
- calls `sendAgentTicket(...)` on-chain, or
- accepts it in local-dev mode.
