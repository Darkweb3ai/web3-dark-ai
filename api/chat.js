export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    let liveWeb3Data = "";

    // Detect a Solana wallet address after "check" or "balance"
    const walletMatch = message.match(
      /(?:check|balance|analyze)\s+(?:this\s+)?(?:solana\s+)?wallet[:\s]+([1-9A-HJ-NP-Za-km-z]{32,44})/i
    );

    if (walletMatch) {
      const wallet = walletMatch[1];

      const rpcResponse = await fetch(
        "https://api.mainnet-beta.solana.com",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [wallet]
          })
        }
      );

      const rpcData = await rpcResponse.json();

      if (rpcData.result?.value !== undefined) {
        const lamports = rpcData.result.value;
        const sol = lamports / 1000000000;

        liveWeb3Data = `
LIVE SOLANA DATA:
Wallet: ${wallet}
SOL balance: ${sol} SOL
Lamports: ${lamports}
Network: Solana Mainnet
Source: Solana RPC
`;
      }
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          model: "gemini-3.5-flash-lite",
          input: message,

          system_instruction: `
You are Web3 Dark AI.

You are a direct, analytical Web3 intelligence assistant specializing in:
- cryptocurrency
- blockchain
- Solana
- DeFi
- smart contracts
- wallets
- tokens
- Web3 infrastructure

Be skeptical of hype and clearly distinguish verified information from assumptions.

When LIVE WEB3 DATA is provided below, treat it as blockchain data retrieved by the application and use it in your analysis.

Do not invent blockchain data.

${liveWeb3Data}
`
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini request failed"
      });
    }

    const answer =
      data.output_text ||
      data.steps?.find(
        step => step.type === "model_output"
      )?.content?.find(
        item => item.type === "text"
      )?.text ||
      "I couldn't generate a response.";

    return res.status(200).json({ answer });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
