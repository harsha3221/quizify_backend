// controllers/aiQuestionController.js

const generateAiQuestion = async (req, res) => {
    const { quizId } = req.params;
    const { topic, difficulty = "medium", num_options = 4, num_correct = 1 } = req.body;

    if (!topic || !topic.trim()) {
        return res.status(400).json({ message: "Topic is required." });
    }

    const parsedOptions = parseInt(num_options, 10);
    const parsedCorrect = parseInt(num_correct, 10);

    if (isNaN(parsedOptions) || parsedOptions < 2 || parsedOptions > 6) {
        return res.status(400).json({ message: "num_options must be between 2 and 6." });
    }

    if (isNaN(parsedCorrect) || parsedCorrect < 1 || parsedCorrect >= parsedOptions) {
        return res.status(400).json({ message: "num_correct must be at least 1 and less than num_options." });
    }

    if (!["easy", "medium", "hard"].includes(difficulty)) {
        return res.status(400).json({ message: "difficulty must be easy, medium, or hard." });
    }

    const prompt = `You are a quiz question generator for an educational platform.

Generate exactly ONE multiple-choice quiz question based on the following parameters:
- Topic: ${topic.trim()}
- Difficulty: ${difficulty}
- Total number of options: ${parsedOptions}
- Number of correct options: ${parsedCorrect}

Rules:
1. The question must be clear, unambiguous, and appropriate for the difficulty level.
2. Easy: basic recall. Medium: understanding and application. Hard: analysis or complex reasoning.
3. All options must be plausible and relevant to the topic.
4. Correct options must be factually accurate.
5. Incorrect options (distractors) must be believable but clearly wrong.

Respond ONLY with a valid JSON object in exactly this format, no extra text, no markdown, no code fences:
{
  "question_text": "Your question here?",
  "options": [
    { "option_text": "Option A text", "is_correct": true },
    { "option_text": "Option B text", "is_correct": false },
    { "option_text": "Option C text", "is_correct": false },
    { "option_text": "Option D text", "is_correct": false }
  ]
}

Make sure the JSON has exactly ${parsedOptions} options, with exactly ${parsedCorrect} having "is_correct": true.`;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
                "X-Title": "Quiz App",
            },
            body: JSON.stringify({
                model: "openrouter/free",
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error("OpenRouter error:", errData);
            return res.status(502).json({ message: "AI service error. Please try again." });
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || "";

        // Strip accidental backticks and extract pure JSON boundaries
        const cleaned = rawText
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();

        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("No JSON block found inside response:", rawText);
            return res.status(502).json({ message: "AI returned an invalid text format. Please try again." });
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch {
            console.error("AI returned non-JSON structure:", rawText);
            return res.status(502).json({ message: "AI returned an invalid response. Please try again." });
        }

        if (
            !parsed.question_text ||
            !Array.isArray(parsed.options) ||
            parsed.options.length !== parsedOptions
        ) {
            return res.status(502).json({ message: "AI response structure is invalid. Please try again." });
        }

        const correctCount = parsed.options.filter((o) => o.is_correct).length;
        if (correctCount !== parsedCorrect) {
            return res.status(502).json({
                message: `AI generated ${correctCount} correct option(s) instead of ${parsedCorrect}. Please try again.`,
            });
        }

        return res.status(200).json({
            question_text: parsed.question_text,
            options: parsed.options.map((o) => ({
                option_text: String(o.option_text),
                is_correct: Boolean(o.is_correct),
            })),
        });
    } catch (err) {
        console.error("OpenRouter API error:", err);
        return res.status(500).json({ message: "AI service error. Please try again." });
    }
};

module.exports = { generateAiQuestion };