export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const walletMatch = message.match(
      /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/
    );

    let liveWeb3Data = "";

    if (walletMatch) {
      const wallet = walletMatch[0];

      const rpc = async (method, params) => {
        const response = await fetch(
          "https://api.mainnet.solana.com",
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

      // SOL BALANCE
      const balanceData = await rpc(
        "getBalance",
        [wallet, { commitment: "finalized" }]
      );

      const lamports =
        balanceData.result?.value ?? null;

      const solBalance =
        lamports !== null
          ? lamports / 1000000000
          : null;

      // TOKEN ACCOUNTS
      const tokenData = await rpc(
        "getTokenAccountsByOwner",
        [
          wallet,
          {
            programId:
              "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          },
          {
            encoding: "jsonParsed",
            commitment: "finalized"
          }
        ]
      );

      const tokenAccounts =
        tokenData.result?.value || [];

      const tokens = tokenAccounts
        .map((account) => {
          const info =
            account.account?.data?.parsed?.info;

          const amount =
            info?.tokenAmount;

          return {
            mint: info?.mint || "Unknown",
            amount:
              amount?.uiAmountString || "0",
            decimals:
              amount?.decimals ?? 0
          };
        })
        .filter(
          (token) => token.amount !== "0"
        );

      // RECENT TRANSACTION SIGNATURES
      const signatureData = await rpc(
        "getSignaturesForAddress",
        [
          wallet,
          {
            limit: 10,
            commitment: "finalized"
          }
        ]
      );

      const signatures =
        signatureData.result || [];

      // FETCH ACTUAL TRANSACTION DETAILS
      const transactionDetails = [];

      for (const item of signatures) {
        const txData = await rpc(
          "getTransaction",
          [
            item.signature,
            {
              encoding: "jsonParsed",
              commitment: "finalized",
              maxSupportedTransactionVersion: 1
            }
          ]
        );

        const tx = txData.result;

        if (!tx) {
          transactionDetails.push({
            signature: item.signature,
            status:
              item.err === null
                ? "SUCCESS"
                : "FAILED",
            details:
              "Transaction details unavailable"
          });

          continue;
        }

        const accountKeys =
          tx.transaction?.message?.accountKeys || [];

        const programs =
          accountKeys
            .map((account) => {
              if (typeof account === "string") {
                return account;
              }

              return account.pubkey;
            })
            .filter(Boolean);

        transactionDetails.push({
          signature: item.signature,

          status:
            item.err === null
              ? "SUCCESS"
              : "FAILED",

          blockTime:
            tx.blockTime
              ? new Date(
                  tx.blockTime * 1000
                ).toISOString()
              : null,

          slot: tx.slot,

          feeLamports:
            tx.meta?.fee ?? null,

          feeSOL:
            tx.meta?.fee !== undefined
              ? tx.meta.fee / 1000000000
              : null,

          programsInteractedWith:
            programs.slice(-10),

          logMessages:
            tx.meta?.logMessages
              ? tx.meta.logMessages.slice(0, 20)
              : []
        });
      }

      liveWeb3Data = `
VERIFIED LIVE SOLANA DATA

Network:
Solana Mainnet

Wallet:
${wallet}

SOL Balance:
${solBalance !== null
  ? solBalance
  : "Unable to retrieve"}

Lamports:
${lamports !== null
  ? lamports
  : "Unable to retrieve"}

Non-zero SPL Token Accounts:
${tokens.length}

Token Holdings:
${JSON.stringify(tokens, null, 2)}

Recent Transactions Retrieved:
${transactionDetails.length}

Transaction Details:
${JSON.stringify(
  transactionDetails,
  null,
  2
)}

Data Source:
Solana Mainnet RPC

IMPORTANT:
This information was retrieved from the Solana
blockchain RPC.

Do not invent missing information.
`;

    } else {
      liveWeb3Data = `
No Solana wallet address was detected.

If the user wants a wallet investigation,
ask for a PUBLIC Solana wallet address.

Never request:
- seed phrases
- private keys
- passwords
- recovery phrases
`;
    }

    // GEMINI ANALYSIS
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

You are a direct and analytical Web3 intelligence
assistant specializing in:

- cryptocurrency
- blockchain
- Solana
- DeFi
- wallets
- tokens
- smart contracts
- Web3 infrastructure

Analyze the supplied blockchain evidence.

Separate your answer into:

1. VERIFIED FACTS
2. OBSERVABLE ACTIVITY
3. TRANSACTION ANALYSIS
4. POSSIBLE INTERPRETATIONS
5. LIMITATIONS
6. CONCLUSION

Important:

Never invent blockchain data.

Do not claim to know the identity or intent of a
wallet owner from blockchain data alone.

Do not automatically label an address as a scammer,
hacker, bot, whale, or criminal.

If a program address appears, identify it only when
the available evidence supports the identification.

Explain transaction fees when available.

Explain which programs appear in the transaction
data, but distinguish program interaction from user
intent.

If the evidence is insufficient, say so.

Never request private keys, seed phrases,
passwords, or recovery phrases.

The blockchain data supplied below is the source
of truth for this investigation:

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
