const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID || '';
const MODEL_ID = process.env.MODEL_ID || 'ibm/granite-3-2b-instruct';
const WATSON_API_KEY = process.env.WATSON_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function log(scope, details) {
  if (details === undefined) {
    console.log(`[ux-flow-reviewer-proxy] ${scope}`);
    return;
  }
  console.log(`[ux-flow-reviewer-proxy] ${scope}`, details);
}

function requireSetting(name, value) {
  if (!value) {
    throw new Error(`Missing required setting: ${name}`);
  }
}

function extractGeneratedText(data) {
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data?.results?.[0]?.generated_text) return data.results[0].generated_text;
  return String(data?.output || '');
}

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ux-flow-reviewer-proxy',
    hasProjectId: Boolean(PROJECT_ID),
    hasApiKey: Boolean(WATSON_API_KEY),
    modelId: MODEL_ID,
  });
});

app.post('/token', async (req, res) => {
  try {
    const apiKey = WATSON_API_KEY || req.body.apiKey;
    requireSetting('WATSON_API_KEY', apiKey);

    log('token:start', { usingEnvKey: Boolean(WATSON_API_KEY) });
    const tokenRes = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`IAM token request failed: ${tokenRes.status} ${text}`);
    }

    const tokenData = await tokenRes.json();
    log('token:success');
    res.json({ access_token: tokenData.access_token });
  } catch (error) {
    log('token:error', { message: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/reviewFlow', async (req, res) => {
  try {
    requireSetting('PROJECT_ID', PROJECT_ID);

    const { endpoint, accessToken, prompt, modelId } = req.body;
    if (!endpoint || !accessToken || !prompt) {
      res.status(400).json({ error: 'endpoint, accessToken, and prompt are required' });
      return;
    }

    const effectiveModelId = modelId || MODEL_ID;
    const genUrl = `${String(endpoint).replace(/\/$/, '')}/ml/v1/text/chat?version=2023-05-29`;

    log('reviewFlow:start', {
      endpoint,
      modelId: effectiveModelId,
      promptPreview: String(prompt).slice(0, 160),
    });

    const wxBody = {
      model_id: effectiveModelId,
      project_id: PROJECT_ID,
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON UX review assistant.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      parameters: {
        decoding_method: 'sample',
        temperature: 0.2,
        top_p: 0.9,
        top_k: 50,
        repetition_penalty: 1.05,
        max_new_tokens: 700,
      },
    };

    const genRes = await fetch(genUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(wxBody),
    });

    if (!genRes.ok) {
      const text = await genRes.text();
      throw new Error(`watsonx error: ${genRes.status} ${text}`);
    }

    const genData = await genRes.json();
    const rawText = extractGeneratedText(genData);

    log('reviewFlow:success', {
      rawTextPreview: String(rawText).slice(0, 200),
    });
    res.json({ rawText });
  } catch (error) {
    log('reviewFlow:error', { message: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  log('server:start', {
    port: PORT,
    hasProjectId: Boolean(PROJECT_ID),
    hasApiKey: Boolean(WATSON_API_KEY),
    modelId: MODEL_ID,
  });
});
