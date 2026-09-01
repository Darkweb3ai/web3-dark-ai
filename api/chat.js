const RPC_URL = "https://api.mainnet-beta.solana.com";
const DEX_URL = "https://api.dexscreener.com";

async function safeJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `External API returned a non-JSON response (HTTP ${response.status})`
    );
  }
}

async function solanaRPC(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  const data = await safeJson(response);

  if (data.error) {
    throw new Error(
      `Solana RPC: ${data.error.message || "RPC error"}`
    );
  }

  return data.result;
}

function extractAddress(message) {
  const matches = message.match(
    /[1-9A-HJ-NP-Za-km-z]{32,44}/g
  );

  return matches ? matches[0] : null;
}

async function getTokenData(mint) {

  const [supply, largest] = await Promise.all([
    solanaRPC("getTokenSupply", [mint]),
    solanaRPC("getTokenLargestAccounts", [mint])
  ]);

  let dex = null;

  try {
    const response = await fetch(
      `${DEX_URL}/tokens/v1/solana/${mint}`,
      {
        headers: {
          "Accept": "application/json"
        }
      }
    );

    dex = await safeJson(response);

  } catch (error) {
    dex = {
      unavailable: true,
      error: error.message
    };
  }

  const pairs = Array.isArray(dex)
    ? dex
    : Array.isArray(dex?.pairs)
      ? dex.pairs
      : [];

  const pair = pairs
    .filter(p => p.chainId === "solana")
    .sort(
      (a, b) =>
        Number(b?.liquidity?.usd || 0) -
        Number(a?.liquidity?.usd || 0)
    )[0];

  const liquidity = Number(
    pair?.liquidity?.usd || 0
  );

  const volume24h = Number(
    pair?.volume?.h24 || 0
  );

  const buys = Number(
    pair?.txns?.h24?.buys || 0
  );

  const sells = Number(
    pair?.txns?.h24?.sells || 0
  );

  const topAccounts =
    largest?.value || [];

  return {
    mint,

    decimals: supply?.value?.decimals ?? null,

    totalSupply:
      supply?.value?.uiAmountString ?? "Unknown",

    largestAccounts:
      topAccounts.slice(0, 10).map(a => ({
        address: a.address,
        amount: a.uiAmountString
      })),

    dexFound: !!pair,

    dex: pair?.dexId || null,

    priceUsd:
      pair?.priceUsd || "Unknown",

    liquidity,

    marketCap:
      Number(pair?.marketCap || pair?.fdv || 0),

    volume24h,

    buys,

    sells,

    pairAgeHours:
      pair?.pairCreatedAt
        ? (Date.now() - pair.pairCreatedAt) / 3600000
        : null,

    pairUrl:
      pair?.url || null,

    dexError:
      dex?.unavailable
        ? dex.error
        : null
  };
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const { message } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const address = extractAddress(message);

    let blockchainData = "";

    if (
      address &&
      /scan|token|coin|memecoin|meme|contract|mint|ape/i.test(message)
    ) {

      const token = await getTokenData(address);

      blockchainData = `
LIVE SOLANA TOKEN DATA

Token mint:
${token.mint}

Decimals:
${token.decimals}

Total supply:
${token.totalSupply}

Largest token accounts:
${JSON.stringify(token.largestAccounts, null, 2)}

DEX pair found:
${token.dexFound}

DEX:
${token.dex || "None"}

Price:
${token.priceUsd}

Liquidity USD:
${token.liquidity}

Market cap / FDV:
${token.marketCap}

24h volume:
${token.volume24h}

24h buys:
${token.buys}

24h sells:
${token.sells}

Pair age:
${
  token.pairAgeHours !== null
    ? token.pairAgeHours.toFixed(2) + " hours"
    : "Unknown"
}

Pair URL:
${token.pairUrl || "None"}

DexScreener error:
${token.dexError || "None"}

SOURCE:
Solana Mainnet RPC + DexScreener
`;

    }

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key":
            process.env.GEMINI_API_KEY
        },

        body: JSON.stringify({
          model: "gemini-3.5-flash-lite",

          input: message,

          system_instruction: `
You are Web3 Dark AI.

You specialize in Solana, cryptocurrency,
memecoins, DeFi, wallets and blockchain analysis.

Use the supplied LIVE SOLANA TOKEN DATA when available.

Never invent blockchain information.

Clearly separate:
1. VERIFIED ON-CHAIN DATA
2. MARKET DATA
3. AI INTERPRETATION

For a token scan, produce:

MEMECOIN INTELLIGENCE REPORT

TOKEN

VERIFIED DATA

MARKET DATA

POS

