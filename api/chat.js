const RPC_URL = "https://api.mainnet-beta.solana.com";
const DEX_URL = "https://api.dexscreener.com";

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  return await response.json();
}

function isSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function extractAddress(message) {
  const matches = message.match(
    /[1-9A-HJ-NP-Za-km-z]{32,44}/g
  );

  if (!matches) return null;

  return matches.find(isSolanaAddress) || null;
}

async function analyzeToken(mint) {

  const [
    accountInfo,
    supplyInfo,
    largestInfo,
    dexResponse
  ] = await Promise.all([

    rpc("getAccountInfo", [
      mint,
      {
        encoding: "jsonParsed",
        commitment: "finalized"
      }
    ]),

    rpc("getTokenSupply", [
      mint,
      {
        commitment: "finalized"
      }
    ]),

    rpc("getTokenLargestAccounts", [
      mint,
      {
        commitment: "finalized"
      }
    ]),

    fetch(
      `${DEX_URL}/latest/dex/tokens/${mint}`
    ).then(r => r.json()).catch(() => null)

  ]);

  const parsed =
    accountInfo?.result?.value?.data?.parsed?.info || {};

  const supply =
    supplyInfo?.result?.value || {};

  const largest =
    largestInfo?.result?.value || [];

  /*
   * Resolve the owners of the largest token accounts.
   */
  const largestAddresses =
    largest
      .slice(0, 20)
      .map(item => item.address);

  let ownerMap = {};

  if (largestAddresses.length > 0) {

    const multipleAccounts = await rpc(
      "getMultipleAccounts",
      [
        largestAddresses,
        {
          encoding: "jsonParsed",
          commitment: "finalized"
        }
      ]
    );

    const accounts =
      multipleAccounts?.result?.value || [];

    accounts.forEach((account, index) => {

      const owner =
        account?.data?.parsed?.info?.owner;

      if (owner) {
        ownerMap[largestAddresses[index]] = owner;
      }

    });
  }

  /*
   * Calculate concentration by owner.
   */

  const ownerBalances = {};

  largest.forEach(item => {

    const tokenAccount = item.address;
    const owner = ownerMap[tokenAccount] || tokenAccount;

    const amount =
      BigInt(item.amount || "0");

    if (!ownerBalances[owner]) {
      ownerBalances[owner] = 0n;
    }

    ownerBalances[owner] += amount;

  });

  const supplyRaw =
    BigInt(supply.amount || "0");

  const ownerConcentration =
    Object.entries(ownerBalances)
      .map(([owner, amount]) => ({
        owner,
        amount,
        percentage:
          supplyRaw > 0n
            ? Number(amount * 10000n / supplyRaw) / 100
            : 0
      }))
      .sort((a, b) => b.percentage - a.percentage);

  const top10Percentage =
    ownerConcentration
      .slice(0, 10)
      .reduce(
        (total, item) => total + item.percentage,
        0
      );

  /*
   * DEX information.
   */

  const pairs =
    dexResponse?.pairs || [];

  const solanaPairs =
    pairs.filter(
      pair => pair.chainId === "solana"
    );

  const bestPair =
    solanaPairs.sort(
      (a, b) =>
        Number(b?.liquidity?.usd || 0) -
        Number(a?.liquidity?.usd || 0)
    )[0] || null;

  const liquidity =
    Number(
      bestPair?.liquidity?.usd || 0
    );

  const marketCap =
    Number(
      bestPair?.marketCap ||
      bestPair?.fdv ||
      0
    );

  const volume24h =
    Number(
      bestPair?.volume?.h24 || 0
    );

  const buys =
    Number(
      bestPair?.txns?.h24?.buys || 0
    );

  const sells =
    Number(
      bestPair?.txns?.h24?.sells || 0
    );

  const priceUsd =
    bestPair?.priceUsd || "Unknown";

  const pairCreatedAt =
    bestPair?.pairCreatedAt || null;

  let pairAgeHours = null;

  if (pairCreatedAt) {

    pairAgeHours =
      (Date.now() - pairCreatedAt) /
      3600000;

  }

  /*
   * Risk scoring.
   */

  let riskScore = 0;
  const riskSignals = [];

  if (parsed.mintAuthority) {
    riskScore += 20;

    riskSignals.push(
      "Mint authority is still active."
    );
  }

  if (parsed.freezeAuthority) {
    riskScore += 20;

    riskSignals.push(
      "Freeze authority is still active."
    );
  }

  if (top10Percentage >= 50) {

    riskScore += 25;

    riskSignals.push(
      `Top 10 owners control approximately ${top10Percentage.toFixed(2)}% of supply.`
    );

  } else if (top10Percentage >= 30) {

    riskScore += 15;

    riskSignals.push(
      `Top 10 owners control approximately ${top10Percentage.toFixed(2)}% of supply.`
    );
  }

  if (!bestPair) {

    riskScore += 30;

    riskSignals.push(
      "No Solana DEX pair was found."
    );

  } else {

    if (liquidity < 25000) {

      riskScore += 20;

      riskSignals.push(
        "Very low liquidity."
      );

    } else if (liquidity < 100000) {

      riskScore += 10;

      riskSignals.push(
        "Liquidity is relatively low."
      );
    }

    if (
      pairAgeHours !== null &&
      pairAgeHours < 6
    ) {

      riskScore += 10;

      riskSignals.push(
        "Trading pair is extremely new."
      );

    } else if (
      pairAgeHours !== null &&
      pairAgeHours < 24
    ) {

      riskScore += 5;

      riskSignals.push(
        "Trading pair is less than 24 hours old."
      );
    }

    if (
      sells > 0 &&
      buys > 0 &&
      sells > buys * 1.5
    ) {

      riskScore += 10;

      riskSignals.push(
        "Recent 24h transactions show elevated sell pressure."
      );
    }
  }

  riskScore =
    Math.min(100, riskScore);

  let riskLevel;

  if (riskScore >= 75) {

    riskLevel = "VERY HIGH";

  } else if (riskScore >= 50) {

    riskLevel = "HIGH";

  } else if (riskScore >= 25) {

    riskLevel = "MODERATE";

  } else {

    riskLevel = "LOWER";

  }

  return {

    mint,

    decimals: supply.decimals,

    supply: supply.uiAmountString,

    mintAuthority:
      parsed.mintAuthority || null,

    freezeAuthority:
      parsed.freezeAuthority || null,

    top10Percentage,

    largestAccounts:
      largest.slice(0, 10).map(item => ({
        address: item.address,
        amount: item.uiAmountString,
        owner:
          ownerMap[item.address] || "Unknown"
      })),

    priceUsd,

    liquidity,

    marketCap,

    volume24h,

    buys,

    sells,

    pairAgeHours,

    dex:
      bestPair?.dexId || null,

    pairUrl:
      bestPair?.url || null,

    riskScore,

    riskLevel,

    riskSignals

  };
}


export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Method not allowed"
    });

  }

  try {

    const { message } = req.body;

    if (!message || !message.trim()) {

      return res.status(400).json({
        error: "Message is required"
      });

    }

    let liveWeb3Data = "";

    const address =
      extractAddress(message);

    const tokenRequest =
      /token|coin|memecoin|meme|contract|mint|ape|scan/i
        .test(message);

    /*
     * TOKEN SCANNER
     */

    if (address && tokenRequest) {

      const tokenData =
        await analyzeToken(address);

      liveWeb3Data = `
LIVE MEMECOIN SCAN

Token mint:
${tokenData.mint}

Decimals:
${tokenData.decimals}

Total supply:
${tokenData.supply}

Mint authority:
${tokenData.mintAuthority || "REVOKED / NONE"}

Freeze authority:
${tokenData.freezeAuthority || "REVOKED / NONE"}

Top 10 owner concentration:
${tokenData.top10Percentage.toFixed(2)}%

DEX:
${tokenData.dex || "No DEX found"}

Price USD:
${tokenData.priceUsd}

Liquidity USD:
${tokenData.liquidity}

Market cap / FDV:
${tokenData.marketCap}

24h volume:
${tokenData.volume24h}

24h buys:
${tokenData.buys}

24h sells:
${tokenData.sells}

Pair age hours:
${tokenData.pairAgeHours !== null
  ? tokenData.pairAgeHours.toFixed(2)
  : "Unknown"}

Preliminary risk score:
${tokenData.riskScore}/100

Preliminary risk level:
${tokenData.riskLevel}

Detected risk signals:
${tokenData.riskSignals.length
  ? tokenData.riskSignals.join("\n")
  : "No major automated risk signals detected."}

Source:
Solana Mainnet RPC + DexScreener
`;

    }

    /*
     * WALLET ANALYSIS
     */

    else if (
      address &&
      /wallet|balance|address/i.test(message)
    ) {

      const balanceResponse =
        await rpc("getBalance", [
          address,
          {
            commitment: "finalized"
          }
        ]);

      const lamports =
        balanceResponse?.result?.value || 0;

      const sol =
        lamports / 1000000000;

      const signatures =
        await rpc(
          "getSignaturesForAddress",
          [
            address,
            {
              commitment: "finalized",
              limit: 10
            }
          ]
        );

      const transactions =
        signatures?.result || [];

      liveWeb3Data = `
LIVE SOLANA WALLET DATA

Wallet:
${address}

SOL balance:
${sol} SOL

Lamports:
${lamports}

Recent transaction signatures:
${transactions.length}

Latest transaction status:
${
  transactions[0]?.confirmationStatus ||
  "No recent transactions"
}

Source:
Solana Mainnet RPC
`;

    }

    /*
     * GEMINI
     */

    const response = await fetch(
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

You are a Web3 intelligence and research assistant.

Your specialties include:

- Solana
- memecoins
- cryptocurrency
- DeFi
- smart contracts
- token analysis
- wallet analysis
- on-chain intelligence

Your personality is direct, skeptical, analytical and concise.

IMPORTANT:

Never invent blockchain data.

When LIVE WEB3 DATA is provided, use it as the factual foundation of your analysis.

Separate verified blockchain facts from your interpretation.

For memecoin scans:

1. Explain the strongest positive signals.
2. Explain the strongest risk signals.
3. Discuss liquidity.
4. Discuss holder concentration.
5. Discuss mint/freeze authority.
6. Discuss market activity.
7. Explain whether the token passes the initial risk screen.
8. Give a clear research verdict.

Do NOT claim that a token is guaranteed to pump.

Do NOT present the risk score as a probability of profit.

If evidence is incomplete, say so.

Use this verdict format:

MEMECOIN INTELLIGENCE REPORT

TOKEN:
RISK LEVEL:
RISK SCORE:

ON-CHAIN FACTS

MARKET DATA

POSITIVE SIGNALS

RED FLAGS

VERDICT

TRADE READINESS:
- PASS INITIAL SCREEN
- WATCH
- HIGH RISK
- AVOID

The trade-readiness label is only a screening result based on available data, not a guarantee or personalized financial advice.

LIVE WEB3 DATA:

${liveWeb3Data}
`

        })

      );

      const data =
        await response.json();

      if (!response.ok) {

        return res.status(
          response.status
        ).json({

          error:
            data.error?.message ||
            "Gemini request failed"

        });

      }

      const answer =
        data.output_text ||
        data.steps
          ?.find(
            step =>
              step.type === "model_output"
          )
          ?.content
          ?.find(
            item =>
              item.type === "text"
          )
          ?.text ||
        "I couldn't generate a response.";

      return res.status(200).json({
        answer
      });

    }

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        error.message ||
        "Server error"

    });

  }

          }

