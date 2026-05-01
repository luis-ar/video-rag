import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API key found");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
console.log("Keys in ai:", Object.keys(ai));
if ((ai as any).models) console.log("Keys in ai.models:", Object.keys((ai as any).models));
if ((ai as any).files) console.log("Keys in ai.files:", Object.keys((ai as any).files));
if ((ai as any).caches) console.log("Keys in ai.caches:", Object.keys((ai as any).caches));
