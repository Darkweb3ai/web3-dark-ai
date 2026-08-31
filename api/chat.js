export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: `You are Web3 Dark AI, a direct and highly analytical Web3 intelligence assistant.

Your specialties include cryptocurrency, blockchain, DeFi, NFTs, smart contracts, wallets and Web3 research.

Be honest about uncertainty. Never invent facts or pretend to have live blockchain data when you do not have it.

Your personality is dark, confident, skeptical and direct, but you must not assist with fraud, theft, credential theft, malware, or other harmful or illegal activity.`
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: message }]
            }
          ]
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
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I couldn't generate a response.";

    return res.status(200).json({ answer });

  } catch (error) {
    return res.status(500).json({
      error: "Server error"
    });
  }
}
