import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { YoutubeTranscript } from 'youtube-transcript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  const app = express();
  
  // Middleware to parse JSON
  app.use(express.json());

  // API Route for YouTube Transcript
  app.get("/api/transcript", async (req, res) => {
    const videoId = req.query.videoId as string;

    if (!videoId) {
      return res.status(400).json({ error: "Missing videoId parameter" });
    }

    try {
      console.log(`Fetching transcript for videoId: ${videoId}`);
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      
      if (!transcript || transcript.length === 0) {
        return res.status(404).json({ 
          error: "Transcript is empty or not found for this video.",
          code: "TRANSCRIPT_NOT_FOUND"
        });
      }

      const text = transcript.map(t => t.text).join(' ');
      res.json({ transcript: text });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      const errorName = error.constructor?.name || "";
      console.warn(`YouTube Transcript issue for video ${videoId}:`, errorMessage);
      
      if (errorMessage.includes("Transcript is disabled") || 
          errorName.includes("TranscriptDisabled") ||
          errorMessage.includes("disabled on this video")) {
        return res.status(400).json({ 
          error: "Transcripts are explicitly disabled for this video by the creator.",
          code: "TRANSCRIPT_DISABLED"
        });
      }

      if (errorMessage.includes("Could not find transcript") || errorName.includes("TranscriptNotFound")) {
        return res.status(404).json({ 
          error: "No transcript found for this video. It might not have captions.",
          code: "TRANSCRIPT_NOT_FOUND"
        });
      }

      res.status(500).json({ 
        error: "YouTube transcript fetch failed. The video might be restricted or captions are missing.",
        details: errorMessage,
        code: "FETCH_ERROR"
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('(.*)', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

// For local development and standard Node.js environments
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  createServer().then(app => {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

// Export the creation function for Vercel
export default async (req: any, res: any) => {
  const app = await createServer();
  return app(req, res);
};
