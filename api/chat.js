export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Find a Solana wallet address anywhere in the message.
    const walletMatch = message.match(
      /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/
    );

    let liveWeb3Data = "";

    if (walletMatch) {
      const wallet = walletMatch[0];

      const rpc = async (method, params) => {
        const response = await fetch(
          "https://api.mainnet-beta.solana.com",
          {
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
          }
        );

        return await response.json();
      };

      // 1. SOL BALANCE
      const balanceData = await rpc(
        "getBalance",
        [wallet]
      );

      let solBalance = null;

      if (balanceData.result?.value !== undefined) {
        solBalance =
          balanceData.result.value / 1000000000;
      }

      // 2. TOKEN ACCOUNTS
      const tokenData = await rpc(
        "getTokenAccountsByOwner",
        [
          wallet,
          {
            programId:
              "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          },
          {
            encoding: "jsonParsed"
          }
        ]
      );

      const tokenAccounts =
        tokenData.result?.value || [];

      const tokens = tokenAccounts
        .map((account) => {
          const info =
            account.account?.data?.parsed?.info;

          const tokenAmount =
            info?.tokenAmount;

          return {
            mint: info?.mint || "Unknown",
            amount:
              tokenAmount?.uiAmountString || "0",
            decimals:
              tokenAmount?.decimals ?? 0
          };
        })
        .filter(
          (token) =>
            token.amount !== "0"
        );

      // 3. RECENT TRANSACTIONS
      const transactionData = await rpc(
        "getSignaturesForAddress",
        [
          wallet,
          {
            limit: 10
          }
        ]
      );

      const transactions =
        transactionData.result || [];

      const recentTransactions =
        transactions.map((tx) => ({
          signature: tx.signature,
          status:
            tx.err === null
              ? "SUCCESS"
              : "FAILED",
          blockTime:
            tx.blockTime
              ? new Date(
                  tx.blockTime * 1000
                ).toISOString()
              : null
        }));

      liveWeb3Data = `
VERIFIED LIVE SOLANA DATA

Network:
Solana Mainnet

Wallet:
${wallet}

SOL Balance:
${solBalance !== null ? solBalance : "Unable to retrieve"}

Lamports:
${
  balanceData.result?.value ??
  "Unable to retrieve"
}

Non-zero SPL Token Accounts:
${tokens.length}

Token Holdings:
${JSON.stringify(tokens, null, 2)}

Recent Transaction Count Retrieved:
${recentTransactions.length}

Recent Transactions:
${JSON.stringify(
  recentTransactions,
  null,
  2
)}

Data Source:
Solana Mainnet RPC

IMPORTANT:
This information was retrieved directly from
the Solana blockchain RPC endpoint.
Treat these values as verified retrieved data.
Do not invent missing information.
`;

    } else {
      liveWeb3Data = `
No Solana wallet address was detected in the user's message.

Answer the user's question normally.
If they want a wallet investigation, ask them
to provide a public Solana wallet address.

Never ask for or accept a seed phrase,
private key, password, or recovery phrase.
`;
    }

    // Send the blockchain evidence to Gemini.
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

          input: `
USER REQUEST:
${message}

${liveWeb3Data}
`,

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

Your job is to analyze verified blockchain evidence
and explain it clearly.

IMPORTANT RULES:

1. Never invent blockchain data.

2. Clearly distinguish:
   - verified blockchain facts
   - reasonable interpretations
   - speculation

3. A low SOL balance does NOT automatically mean
   a wallet is inactive.

4. Token accounts may exist even when SOL balance
   is low.

5. Do not claim that a wallet is a scammer,
   hacker, whale, bot, or criminal based only on
   limited blockchain information.

6. When transaction data is available, explain:
   - number of transactions retrieved
   - successful vs failed transactions
   - recency
   - observable activity patterns

7. When token data is available, list important
   token holdings using the mint addresses provided.

8. If the available data is insufficient for a
   conclusion, explicitly say so.

9. NEVER request a user's:
   - seed phrase
   - private key
   - password
   - recovery phrase

10. You may analyze PUBLIC blockchain addresses.

Use the following verified blockchain data
when it is provided:

${liveWeb3Data}
`
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error?.message ||
          "Gemini request failed"
      });
    }

    const answer =
      data.output_text ||
      data.steps
        ?.find(
          (step) =>
            step.type === "model_output"
        )
        ?.content
        ?.find(
          (item) =>
            item.type === "text"
        )?.text ||
      "I couldn't generate a response.";

    return res.status(200).json({
      answer
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Server error"
    });
  }
        }
