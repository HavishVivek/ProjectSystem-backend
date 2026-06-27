import { Router } from "express";

const router = Router();

const SYSTEM_PROMPT = `You are a semantic search engine for a project management app called Eden Board.

Your job is to find folders (projects) that match a user's natural-language query.
Search across ALL content inside each folder: topic, type, tags, status, board items, scripts, thumbnails, filmed sections, canvas cards, subtasks, BOM parts, build logs, links, whiteboard notes, schematics, and code subfolders.

Do NOT limit matches to the folder name/topic only.
A folder matches if ANY of its nested content is relevant.
If a match is found inside a board item, link, or subfolder, return the parent folderId.

IMPORTANT — links:
Each link entry contains the URL itself PLUS extracted URL path keywords.
Treat URL path keywords as meaningful searchable content.

Return ONLY a valid JSON object with this exact shape and no other text:
{
  "summary": "<one sentence describing what you found>",
  "matches": [
    {
      "folderId": "<id string>",
      "relevance": "high" | "medium" | "low",
      "reason": "<one sentence explaining why this folder matches>",
      "matchedItems": [
        {
          "type": "script" | "thumbnail" | "section" | "note" | "link" | "part" | "log" | "subtask" | "schematic" | "code" | "canvas",
          "name": "<item title or short label>",
          "snippet": "<10-20 word excerpt from the content that matched>"
        }
      ]
    }
  ]
}

Rules:
- Include ALL folders that are relevant, even loosely.
- matchedItems should list the specific pieces of content inside the folder that matched.
- Sort matches from highest to lowest relevance.
- If nothing matches, return { "summary": "No matching folders found.", "matches": [] }.`;

function safeJsonParse(raw) {
  const clean = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse AI response.");
    return JSON.parse(match[0]);
  }
}

router.post("/", async (req, res) => {
  const { query, corpus } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Missing query" });
  }
  if (!Array.isArray(corpus)) {
    return res.status(400).json({ error: "Missing or invalid corpus" });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${SYSTEM_PROMPT}

Additional rules:
- Match folders by content inside board items, links, subfolders, notes, and any nested content.
- If any nested item matches, return the parent folderId.
- Do not omit a folder just because its topic/title does not match.
- Prefer the exact folder that contains the strongest nested match.`,
          },
          {
            role: "user",
            content: `Search query: "${query}"

Folders:
${JSON.stringify(corpus, null, 2)}`,
          },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.json().catch(() => ({}));
      return res
        .status(502)
        .json({ error: errBody?.error?.message || `Groq HTTP ${groqRes.status}` });
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(raw);

    // Return the raw AI result; the frontend re-attaches folder objects
    res.json({
      summary: parsed.summary || "",
      matches: parsed.matches || [],
    });
  } catch (err) {
    console.error("aiSearch error:", err);
    res.status(500).json({ error: "Search failed. Please try again." });
  }
});

export default router;