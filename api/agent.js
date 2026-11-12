// Vercel serverless function: POST /api/agent
import { handleAgentRequest } from './_agent.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const { status, json } = await handleAgentRequest(body, process.env);
  res.status(status).json(json);
}
