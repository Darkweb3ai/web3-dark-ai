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
          system_instruction:
            "You are Web3 Dark AI, a direct, analytical Web3 intelligence assistant. You specialize in cryptocurrency, blockchain, DeFi, NFTs, smart contracts, wallets and Web3 research. Be skeptical, precise and honest about uncertainty. Never invent live blockchain data. Do not assist with fraud, theft, credential theft, malware or other harmful or illegal activity."
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
