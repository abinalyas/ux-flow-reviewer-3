/// <reference types="@figma/plugin-typings" />

interface FlowStep {
  id: string;
  name: string;
  textContent: string[];
  screenshot?: string;
}

interface FlowGraph {
  steps: FlowStep[];
  breadcrumb: string;
  flowPurpose?: string;
  reviewMode?: 'hybrid' | 'screenshot';
  issueClarifications?: Record<string, string>;
}

interface IndicatorPayload {
  frameId: string;
  label: string;
  targetText?: string;
  evidence?: string;
}

type AIProvider = 'ibm' | 'anthropic' | 'openai' | 'gemini';

interface AISettings {
  provider: AIProvider;
  anthropicApiKey: string;
  geminiApiKey: string;
  geminiModelId: string;
  openaiApiKey: string;
  openaiModelId: string;
  ibmApiKey: string;
  ibmProxyUrl: string;
  ibmEndpoint: string;
  ibmModelId: string;
}

type IssueSeverity = 'high' | 'medium' | 'low';

interface AnalysisIssue {
  frameId: string;
  label: string;
  severity: IssueSeverity;
  details: string;
  suggestion: string;
  evidence: string;
  confidence: number;
  targetText?: string;
}

interface AnalysisResult {
  provider: AIProvider;
  summary: string;
  issues: AnalysisIssue[];
}

type PluginToUI =
  | { type: 'FLOW_DETECTED'; flow: FlowGraph }
  | { type: 'NO_FRAMES_SELECTED' }
  | { type: 'NO_REACTIONS'; frameNames: string[] }
  | { type: 'EXPORT_PROGRESS'; current: number; total: number }
  | { type: 'EXPORT_DONE'; flow: FlowGraph }
  | { type: 'EXPORT_ERROR'; message: string }
  | { type: 'ANALYSIS_PROGRESS'; message: string }
  | { type: 'ANALYSIS_DONE'; result: AnalysisResult }
  | { type: 'ANALYSIS_ERROR'; message: string }
  | { type: 'SETTINGS_LOADED'; settings: AISettings };

type UIToPlugin =
  | { type: 'READY' }
  | { type: 'CONFIRM_FLOW'; flow: FlowGraph; skipScreenshots: boolean }
  | { type: 'ANALYZE_FLOW'; flow: FlowGraph }
  | { type: 'CANCEL' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<AISettings> }
  | { type: 'LOAD_SETTINGS' }
  | { type: 'REORDER_STEPS'; orderedIds: string[] }
  | { type: 'PLACE_INDICATORS'; issues: IndicatorPayload[] }
  | { type: 'JUMP_TO_FRAME'; frameId: string };

const MAX_DEPTH = 10;
const EXPORT_SCALE = 0.5;
const MAX_PAYLOAD_KB = 800;
const INDICATOR_TAG = '⚠ UX Issue';
const SETTINGS_KEY = 'aiSettings';
const IBM_PROXY_URL = 'https://ux-review-figma-app.29kmlt3ii3a9.us-east.codeengine.appdomain.cloud';
const IBM_ENDPOINT = 'https://us-south.ml.cloud.ibm.com';
const IBM_MODEL = 'ibm/granite-3-8b-instruct';
const GEMINI_MODEL = 'gemini-2.5-pro';
const OPENAI_MODEL = 'gpt-4.1-mini';
const NETWORK_TIMEOUT_MS = 20000;
const LEGACY_IBM_MODELS = new Set([
  'ibm/granite-3-2b-instruct',
  'ibm/granite-3-3-8b-instruct',
]);

const DEFAULT_SETTINGS: AISettings = {
  provider: 'ibm',
  anthropicApiKey: '',
  geminiApiKey: '',
  geminiModelId: GEMINI_MODEL,
  openaiApiKey: '',
  openaiModelId: OPENAI_MODEL,
  ibmApiKey: '',
  ibmProxyUrl: IBM_PROXY_URL,
  ibmEndpoint: IBM_ENDPOINT,
  ibmModelId: IBM_MODEL,
};

function debugLog(scope: string, details?: unknown): void {
  if (details === undefined) {
    console.log(`[UX Flow Reviewer] ${scope}`);
    return;
  }
  console.log(`[UX Flow Reviewer] ${scope}`, details);
}

function sendToUI(msg: PluginToUI): void {
  figma.ui.postMessage(msg);
}

function extractText(node: SceneNode): string[] {
  const texts: string[] = [];

  function walk(n: SceneNode): void {
    if ('visible' in n && !n.visible) return;
    if (n.type === 'TEXT') {
      const t = n.characters.trim();
      if (t.length > 0 && !texts.includes(t)) texts.push(t);
    }
    if ('children' in n) {
      for (const child of (n as ChildrenMixin).children) walk(child as SceneNode);
    }
  }

  walk(node);
  return texts;
}

function isFlowNode(node: BaseNode | null): node is FrameNode | ComponentNode | InstanceNode {
  return node !== null && (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE');
}

function getContainingFlowNode(node: BaseNode | null): FrameNode | ComponentNode | InstanceNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (isFlowNode(current)) return current;
    current = current.parent;
  }
  return null;
}

function getReactionDestinations(root: SceneNode): (FrameNode | ComponentNode | InstanceNode)[] {
  const destinations: (FrameNode | ComponentNode | InstanceNode)[] = [];
  const seen = new Set<string>();

  function visit(node: SceneNode): void {
    const reactions: readonly Reaction[] = ('reactions' in node ? node.reactions : []) ?? [];
    for (const reaction of reactions) {
      if (!reaction.action || reaction.action.type !== 'NODE' || !('destinationId' in reaction.action)) continue;

      const destinationId = reaction.action.destinationId;
      if (!destinationId) continue;

      const destinationNode = figma.getNodeById(destinationId);
      const destinationFrame = getContainingFlowNode(destinationNode);
      if (!destinationFrame || seen.has(destinationFrame.id)) continue;

      seen.add(destinationFrame.id);
      destinations.push(destinationFrame);
    }

    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) visit(child as SceneNode);
    }
  }

  visit(root);
  return destinations;
}

function pickStartFrame(frames: FrameNode[]): FrameNode {
  const frameIds = new Set(frames.map(frame => frame.id));
  const inboundCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();

  for (const frame of frames) {
    inboundCounts.set(frame.id, 0);
    outboundCounts.set(frame.id, 0);
  }

  for (const frame of frames) {
    const destinations = getReactionDestinations(frame)
      .filter(destination => frameIds.has(destination.id));
    outboundCounts.set(frame.id, destinations.length);

    for (const destination of destinations) {
      inboundCounts.set(destination.id, (inboundCounts.get(destination.id) ?? 0) + 1);
    }
  }

  const rootCandidate = frames.find(frame =>
    (outboundCounts.get(frame.id) ?? 0) > 0 && (inboundCounts.get(frame.id) ?? 0) === 0
  );
  if (rootCandidate) return rootCandidate;

  const hasOutgoing = frames.find(frame => (outboundCounts.get(frame.id) ?? 0) > 0);
  return hasOutgoing ?? frames[0];
}

function detectFlow(startFrame: FrameNode, selectedFrameIds?: Set<string>): FlowGraph {
  const visited = new Set<string>();
  const steps: FlowStep[] = [];

  function traverse(node: SceneNode, depth: number): void {
    if (depth > MAX_DEPTH || visited.has(node.id)) return;
    if (!isFlowNode(node)) return;
    visited.add(node.id);

    steps.push({
      id: node.id,
      name: node.name,
      textContent: extractText(node),
    });

    const destinations = getReactionDestinations(node)
      .filter(destination => !selectedFrameIds || selectedFrameIds.has(destination.id));

    for (const destination of destinations) {
      traverse(destination, depth + 1);
    }
  }

  traverse(startFrame, 0);
  return { steps, breadcrumb: steps.map(step => step.name).join(' → ') };
}

function buildManualFlow(frames: FrameNode[]): FlowGraph {
  const steps: FlowStep[] = frames.map(frame => ({
    id: frame.id,
    name: frame.name,
    textContent: extractText(frame),
  }));
  return { steps, breadcrumb: steps.map(step => step.name).join(' → ') };
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i++];
    const b1 = i < bytes.length ? bytes[i++] : 0;
    const b2 = i < bytes.length ? bytes[i++] : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += chars[((b1 & 15) << 2) | (b2 >> 6)];
    result += chars[b2 & 63];
  }

  const pad = bytes.length % 3;
  if (pad === 1) result = result.slice(0, -2) + '==';
  if (pad === 2) result = result.slice(0, -1) + '=';
  return result;
}

async function exportScreenshots(
  flow: FlowGraph,
  onProgress: (current: number, total: number) => void
): Promise<FlowGraph> {
  const updatedSteps: FlowStep[] = [];

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    onProgress(i, flow.steps.length);

    const node = figma.getNodeById(step.id);
    if (!node || node.type !== 'FRAME') {
      updatedSteps.push(step);
      continue;
    }

    try {
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: EXPORT_SCALE },
      });

      if (bytes.byteLength / 1024 > MAX_PAYLOAD_KB) {
        updatedSteps.push(step);
        continue;
      }

      updatedSteps.push({ ...step, screenshot: uint8ToBase64(bytes) });
    } catch {
      updatedSteps.push(step);
    }
  }

  onProgress(flow.steps.length, flow.steps.length);
  return { ...flow, steps: updatedSteps };
}

function findBestTextAnchor(frame: FrameNode, indicator: IndicatorPayload): TextNode | null {
  const evidenceQuery = `${indicator.targetText ?? ''} ${indicator.evidence ?? ''}`.toLowerCase();
  const tokens = evidenceQuery
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3);

  if (tokens.length === 0) return null;

  let bestNode: TextNode | null = null;
  let bestScore = 0;

  function visit(node: SceneNode): void {
    if (node.type === 'TEXT') {
      const text = node.characters.trim().toLowerCase();
      if (!text) return;

      let score = 0;
      for (const token of tokens) {
        if (text.includes(token)) score++;
      }

      if (indicator.targetText && text.includes(indicator.targetText.toLowerCase())) {
        score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  }

  visit(frame);
  return bestScore >= 2 ? bestNode : null;
}

async function placeIndicators(indicators: IndicatorPayload[]): Promise<void> {
  figma.currentPage.findAll(node => node.name.startsWith(INDICATOR_TAG)).forEach(node => node.remove());

  for (const indicator of indicators) {
    const node = figma.getNodeById(indicator.frameId);
    if (!node || node.type !== 'FRAME') continue;

    const frame = node as FrameNode;
    const badge = figma.createFrame();
    badge.name = `${INDICATOR_TAG}: ${frame.name}`;
    badge.resize(Math.min(frame.width, 240), 36);

    const frameBbox = frame.absoluteBoundingBox;
    const anchor = findBestTextAnchor(frame, indicator);
    const anchorBbox = anchor?.absoluteBoundingBox ?? null;
    if (anchorBbox && frameBbox) {
      const padding = 8;
      const maxX = frameBbox.x + Math.max(0, frame.width - badge.width - padding);
      const minX = frameBbox.x + padding;
      const maxY = frameBbox.y + Math.max(0, frame.height - badge.height - padding);
      const minY = frameBbox.y + padding;
      badge.x = Math.min(Math.max(minX, anchorBbox.x), maxX);
      badge.y = Math.min(Math.max(minY, anchorBbox.y - badge.height - 6), maxY);
    } else if (frameBbox) {
      badge.x = frameBbox.x + 8;
      badge.y = frameBbox.y + 8;
    }

    badge.fills = [{ type: 'SOLID', color: { r: 1, g: 0.76, b: 0.03 } }];
    badge.cornerRadius = 8;

    await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
    const label = figma.createText();
    label.fontName = { family: 'Inter', style: 'Medium' };
    label.fontSize = 12;
    label.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.07, b: 0 } }];
    label.characters = `⚠  ${indicator.label}`;
    label.x = 10;
    label.y = 10;

    badge.appendChild(label);
    const parent = frame.parent ?? figma.currentPage;
    (parent as FrameNode | PageNode).appendChild(badge);
  }
}

function jumpToFrame(frameId: string): void {
  const node = figma.getNodeById(frameId);
  if (!node || node.type !== 'FRAME') return;
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

function sanitizeSettings(raw: Partial<AISettings> | null | undefined): AISettings {
  const incomingModelId =
    typeof raw?.ibmModelId === 'string' && raw.ibmModelId.trim() ? raw.ibmModelId.trim() : IBM_MODEL;
  const migratedModelId = LEGACY_IBM_MODELS.has(incomingModelId) ? IBM_MODEL : incomingModelId;

  return {
    provider: raw?.provider === 'anthropic' || raw?.provider === 'openai' || raw?.provider === 'gemini' ? raw.provider : 'ibm',
    anthropicApiKey: typeof raw?.anthropicApiKey === 'string' ? raw.anthropicApiKey : '',
    geminiApiKey: typeof raw?.geminiApiKey === 'string' ? raw.geminiApiKey : '',
    geminiModelId: typeof raw?.geminiModelId === 'string' && raw.geminiModelId.trim() ? raw.geminiModelId.trim() : GEMINI_MODEL,
    openaiApiKey: typeof raw?.openaiApiKey === 'string' ? raw.openaiApiKey : '',
    openaiModelId: typeof raw?.openaiModelId === 'string' && raw.openaiModelId.trim() ? raw.openaiModelId.trim() : OPENAI_MODEL,
    ibmApiKey: typeof raw?.ibmApiKey === 'string' ? raw.ibmApiKey : '',
    ibmProxyUrl: typeof raw?.ibmProxyUrl === 'string' && raw.ibmProxyUrl.trim() ? raw.ibmProxyUrl.trim() : IBM_PROXY_URL,
    ibmEndpoint: typeof raw?.ibmEndpoint === 'string' && raw.ibmEndpoint.trim() ? raw.ibmEndpoint.trim() : IBM_ENDPOINT,
    ibmModelId: migratedModelId,
  };
}

async function loadSettings(): Promise<AISettings> {
  const stored = await figma.clientStorage.getAsync(SETTINGS_KEY);
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored as Partial<AISettings>) };
}

async function saveSettings(partial: Partial<AISettings>): Promise<AISettings> {
  const existing = await loadSettings();
  const merged = sanitizeSettings({ ...existing, ...partial });
  await figma.clientStorage.setAsync(SETTINGS_KEY, merged);
  return merged;
}

function buildAnalysisPrompt(flow: FlowGraph): string {
  const reviewMode = flow.reviewMode === 'screenshot' ? 'screenshot' : 'hybrid';
  const stepsPayload = flow.steps.map((step, index) => ({
    frameId: step.id,
    frameName: step.name,
    visibleText: reviewMode === 'screenshot' ? [] : step.textContent.slice(0, 40),
    hasScreenshot: Boolean(step.screenshot),
  }));

  return [
    'You are a senior UX reviewer auditing a Figma user flow.',
    'Review the flow for friction, clarity, trust, accessibility, and conversion issues.',
    reviewMode === 'screenshot'
      ? 'Use only what is visibly rendered in the screenshots and frame names. Ignore hidden layers, extracted text not visible on the screenshot, backend behavior, and non-visible UI.'
      : 'Focus only on concrete problems supported by the provided frame names and extracted visible text.',
    'Important: do not assume hidden UI, backend behavior, or controls that are not explicitly present in the evidence.',
    'Do not mention search, filters, tooltips, menus, sorting, notifications, ratings, reviews, or other features unless the exact feature is clearly named in the provided text evidence.',
    'If evidence is incomplete, prefer fewer issues over speculative issues.',
    'Return only valid JSON with this exact shape:',
    '{"summary":"string","issues":[{"frameId":"string","label":"string","severity":"high|medium|low","confidence":0.0,"evidence":"string","targetText":"string","details":"string","suggestion":"string"}]}',
    'Rules:',
    '- Keep summary under 120 words.',
    '- Include at most 6 issues.',
    '- label must be short, 2-6 words.',
    '- Use only frameId values from the provided steps.',
    '- If there are no meaningful issues, return an empty issues array.',
    '- Every issue must be grounded in explicit words from visibleText or frameName.',
    '- Never claim a feature exists unless its name appears in the evidence.',
    '- confidence must be a number from 0 to 1.',
    '- evidence must describe the exact visible text or screenshot cue that supports the finding.',
    '- targetText should be the most relevant visible text snippet to anchor a marker near. Use an empty string if there is no clear text anchor.',
    '',
    `Review mode: ${reviewMode}`,
    `Flow purpose: ${flow.flowPurpose || 'Not provided'}`,
    `Issue clarifications: ${flow.issueClarifications && Object.keys(flow.issueClarifications).length ? JSON.stringify(flow.issueClarifications) : 'None provided'}`,
    `Breadcrumb: ${flow.breadcrumb}`,
    `Steps: ${JSON.stringify(stepsPayload)}`,
  ].join('\n');
}

function mentionsUnsupportedFeature(issueText: string, evidenceText: string): boolean {
  const checks = [
    { keywords: ['search'], evidence: ['search'] },
    { keywords: ['tooltip'], evidence: ['tooltip'] },
    { keywords: ['filter', 'filters', 'filtering'], evidence: ['filter'] },
    { keywords: ['sort', 'sorting'], evidence: ['sort'] },
  ];

  return checks.some(check => {
    const mentionsKeyword = check.keywords.some(keyword => issueText.includes(keyword));
    if (!mentionsKeyword) return false;
    return !check.evidence.some(keyword => evidenceText.includes(keyword));
  });
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function normalizeSeverity(value: unknown): IssueSeverity {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return 0.6;
}

function parseAnalysisResult(rawText: string, flow: FlowGraph, provider: AIProvider): AnalysisResult {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) throw new Error('The AI response did not include valid JSON.');

  const parsed = JSON.parse(jsonText) as {
    summary?: unknown;
    issues?: Array<{
      frameId?: unknown;
      label?: unknown;
      severity?: unknown;
      confidence?: unknown;
      evidence?: unknown;
      targetText?: unknown;
      details?: unknown;
      suggestion?: unknown;
    }>;
  };

  const frameIds = new Set(flow.steps.map(step => step.id));
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const evidenceParts: string[] = [];
  for (const step of flow.steps) {
    evidenceParts.push(step.name, ...step.textContent);
  }
  const evidenceText = evidenceParts.join(' ').toLowerCase();

  return {
    provider,
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Analysis completed.',
    issues: issues
      .map(issue => ({
        frameId: typeof issue.frameId === 'string' && frameIds.has(issue.frameId) ? issue.frameId : flow.steps[0]?.id ?? '',
        label: typeof issue.label === 'string' && issue.label.trim() ? issue.label.trim().slice(0, 80) : 'UX issue',
        severity: normalizeSeverity(issue.severity),
        confidence: normalizeConfidence(issue.confidence),
        evidence: typeof issue.evidence === 'string' && issue.evidence.trim() ? issue.evidence.trim() : 'Based on the visible UI evidence in this frame.',
        targetText: typeof issue.targetText === 'string' && issue.targetText.trim() ? issue.targetText.trim().slice(0, 120) : '',
        details: typeof issue.details === 'string' && issue.details.trim() ? issue.details.trim() : 'Potential UX issue detected.',
        suggestion: typeof issue.suggestion === 'string' && issue.suggestion.trim() ? issue.suggestion.trim() : 'Review and simplify this step.',
      }))
      .filter(issue => issue.frameId)
      .filter(issue => {
        const combinedText = `${issue.label} ${issue.details} ${issue.suggestion}`.toLowerCase();
        return !mentionsUnsupportedFeature(combinedText, evidenceText);
      })
      .slice(0, 6),
  };
}

async function fetchWithTimeout(input: string, init: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const startedAt = Date.now();
  debugLog('fetch:start', { input, timeoutMs, method: init.method ?? 'GET' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      debugLog('fetch:timeout', { input, elapsedMs: Date.now() - startedAt, timeoutMs });
      reject(new Error('Request timed out.'));
    }, timeoutMs);
    fetch(input, init)
      .then(response => {
        clearTimeout(timer);
        debugLog('fetch:response', {
          input,
          elapsedMs: Date.now() - startedAt,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
        });
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        debugLog('fetch:error', {
          input,
          elapsedMs: Date.now() - startedAt,
          message: (error as Error)?.message ?? String(error),
        });
        reject(error);
      });
  });
}

async function getIbmAccessToken(settings: AISettings, onProgress: (message: string) => void): Promise<string> {
  debugLog('ibm:token:begin', {
    proxyUrl: settings.ibmProxyUrl,
    endpoint: settings.ibmEndpoint,
    modelId: settings.ibmModelId,
  });
  onProgress('Requesting IBM access token…');
  let response: any;
  try {
    response = await fetchWithTimeout(`${settings.ibmProxyUrl.replace(/\/$/, '')}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.ibmApiKey ? { apiKey: settings.ibmApiKey } : {}),
    }, NETWORK_TIMEOUT_MS);
  } catch (error: unknown) {
    const message = (error as Error)?.message || 'Network request failed.';
    debugLog('ibm:token:network-failure', { message });
    throw new Error(
      `The default IBM proxy is not reachable right now (${message}). ` +
      'Try again later, or switch to Anthropic in Settings.'
    );
  }

  if (!response.ok) {
    const text = await response.text();
    debugLog('ibm:token:bad-response', { status: response.status, body: text });
    throw new Error(`IBM token request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token?: string };
  debugLog('ibm:token:success', {
    hasAccessToken: Boolean(data.access_token),
    tokenPrefix: data.access_token ? `${data.access_token.slice(0, 12)}...` : '',
  });
  if (!data.access_token) throw new Error('IBM token response was missing an access token.');
  return data.access_token;
}

async function analyzeWithIbm(flow: FlowGraph, onProgress: (message: string) => void): Promise<AnalysisResult> {
  const settings = await loadSettings();
  debugLog('ibm:analysis:begin', {
    stepCount: flow.steps.length,
    breadcrumb: flow.breadcrumb,
    proxyUrl: settings.ibmProxyUrl,
    endpoint: settings.ibmEndpoint,
    modelId: settings.ibmModelId,
    hasApiKey: Boolean(settings.ibmApiKey),
  });
  const accessToken = await getIbmAccessToken(settings, onProgress);
  onProgress('Reviewing flow with IBM watsonx…');

  let response: any;
  try {
    response = await fetchWithTimeout(`${settings.ibmProxyUrl.replace(/\/$/, '')}/reviewFlow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: settings.ibmEndpoint,
        accessToken,
        prompt: buildAnalysisPrompt(flow),
        modelId: settings.ibmModelId,
      }),
    }, NETWORK_TIMEOUT_MS);
  } catch (error: unknown) {
    const message = (error as Error)?.message || 'Network request failed.';
    debugLog('ibm:analysis:network-failure', { message });
    throw new Error(`IBM watsonx could not be reached (${message}). Try again later, or update the IBM settings.`);
  }

  if (!response.ok) {
    const text = await response.text();
    debugLog('ibm:analysis:bad-response', { status: response.status, body: text });
    if (text.includes('model_not_supported')) {
      throw new Error(
        `IBM watsonx rejected the model "${settings.ibmModelId}". Try a supported chat model in Settings, such as ` +
          'ibm/granite-3-8b-instruct, ibm/granite-3-2-8b-instruct, meta-llama/llama-3-1-8b-instruct, or mistralai/mistral-small-24b-instruct-2501.'
      );
    }
    throw new Error(`IBM watsonx request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { rawText?: string };
  const rawText = data.rawText ?? '';

  debugLog('ibm:analysis:success', {
    hasResults: Boolean(rawText),
    rawTextPreview: rawText.slice(0, 200),
  });
  if (!rawText) throw new Error('IBM watsonx returned an empty response.');
  return parseAnalysisResult(rawText, flow, 'ibm');
}

async function analyzeWithAnthropic(
  flow: FlowGraph,
  apiKey: string,
  onProgress: (message: string) => void
): Promise<AnalysisResult> {
  if (!apiKey) throw new Error('Add an Anthropic API key in Settings to use the custom provider.');

  onProgress('Reviewing flow with Anthropic…');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 900,
      temperature: 0.2,
      system: 'You are a strict JSON UX review assistant.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildAnalysisPrompt(flow),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const rawText = (data.content ?? [])
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n');

  if (!rawText) throw new Error('Anthropic returned an empty response.');
  return parseAnalysisResult(rawText, flow, 'anthropic');
}

async function analyzeWithOpenAI(
  flow: FlowGraph,
  apiKey: string,
  modelId: string,
  onProgress: (message: string) => void
): Promise<AnalysisResult> {
  if (!apiKey) throw new Error('Add an OpenAI API key in Settings to use OpenAI for testing.');

  onProgress('Reviewing flow with OpenAI…');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON UX review assistant.',
        },
        {
          role: 'user',
          content: buildAnalysisPrompt(flow),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawText = data.choices?.[0]?.message?.content ?? '';
  if (!rawText) throw new Error('OpenAI returned an empty response.');
  return parseAnalysisResult(rawText, flow, 'openai');
}

async function analyzeWithGemini(
  flow: FlowGraph,
  apiKey: string,
  modelId: string,
  onProgress: (message: string) => void
): Promise<AnalysisResult> {
  if (!apiKey) throw new Error('Add a Gemini API key in Settings to use Gemini for testing.');

  onProgress('Reviewing flow with Gemini…');

  const parts: Array<Record<string, unknown>> = [
    { text: buildAnalysisPrompt(flow) },
  ];

  for (const step of flow.steps) {
    if (!step.screenshot) continue;
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: step.screenshot,
      },
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts,
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Short summary of the UX review.' },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  frameId: { type: 'string', description: 'One of the provided frame ids.' },
                  label: { type: 'string', description: 'Short issue label.' },
                  severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                  confidence: { type: 'number', description: 'Confidence from 0 to 1.' },
                  evidence: { type: 'string', description: 'Visible text or screenshot cue supporting the finding.' },
                  targetText: { type: 'string', description: 'Best visible text snippet to anchor a marker near.' },
                  details: { type: 'string', description: 'Why this issue matters.' },
                  suggestion: { type: 'string', description: 'Suggested improvement.' },
                },
                required: ['frameId', 'label', 'severity', 'confidence', 'evidence', 'targetText', 'details', 'suggestion'],
              },
            },
          },
          required: ['summary', 'issues'],
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawText = (data.candidates?.[0]?.content?.parts ?? [])
    .map(part => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim();

  if (!rawText) throw new Error('Gemini returned an empty response.');
  return parseAnalysisResult(rawText, flow, 'gemini');
}

async function analyzeFlow(flow: FlowGraph): Promise<AnalysisResult> {
  const settings = await loadSettings();
  debugLog('analysis:dispatch', {
    provider: settings.provider,
    stepCount: flow.steps.length,
  });
  const onProgress = (message: string): void => sendToUI({ type: 'ANALYSIS_PROGRESS', message });

  if (settings.provider === 'anthropic') {
    return analyzeWithAnthropic(flow, settings.anthropicApiKey, onProgress);
  }

  if (settings.provider === 'openai') {
    return analyzeWithOpenAI(flow, settings.openaiApiKey, settings.openaiModelId, onProgress);
  }

  if (settings.provider === 'gemini') {
    return analyzeWithGemini(flow, settings.geminiApiKey, settings.geminiModelId, onProgress);
  }

  return analyzeWithIbm(flow, onProgress);
}

figma.showUI(__html__, { width: 480, height: 760, title: 'UX Flow Reviewer' });

async function init(): Promise<void> {
  const settings = await loadSettings();
  debugLog('init:settings-loaded', {
    provider: settings.provider,
    geminiModelId: settings.geminiModelId,
    openaiModelId: settings.openaiModelId,
    ibmProxyUrl: settings.ibmProxyUrl,
    ibmEndpoint: settings.ibmEndpoint,
    ibmModelId: settings.ibmModelId,
    hasAnthropicKey: Boolean(settings.anthropicApiKey),
    hasGeminiKey: Boolean(settings.geminiApiKey),
    hasOpenAIKey: Boolean(settings.openaiApiKey),
    hasIbmApiKey: Boolean(settings.ibmApiKey),
  });
  sendToUI({ type: 'SETTINGS_LOADED', settings });
}

init();

figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as UIToPlugin;
  debugLog('ui:message', { type: msg.type });

  switch (msg.type) {
    case 'READY': {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        sendToUI({ type: 'NO_FRAMES_SELECTED' });
        return;
      }

      const frames = selection.filter(node => node.type === 'FRAME') as FrameNode[];
      if (frames.length === 0) {
        sendToUI({ type: 'NO_FRAMES_SELECTED' });
        return;
      }

      const startFrame = pickStartFrame(frames);
      const flow = detectFlow(
        startFrame,
        frames.length > 1 ? new Set(frames.map(frame => frame.id)) : undefined
      );

      if (flow.steps.length <= 1 && frames.length > 1) {
        sendToUI({ type: 'NO_REACTIONS', frameNames: frames.map(frame => frame.name) });
        sendToUI({ type: 'FLOW_DETECTED', flow: buildManualFlow(frames) });
      } else {
        sendToUI({ type: 'FLOW_DETECTED', flow });
      }
      break;
    }

    case 'CONFIRM_FLOW': {
      const { flow, skipScreenshots } = msg;
      if (skipScreenshots) {
        sendToUI({ type: 'EXPORT_DONE', flow });
        return;
      }

      try {
        const flowWithShots = await exportScreenshots(
          flow,
          (current, total) => sendToUI({ type: 'EXPORT_PROGRESS', current, total })
        );
        sendToUI({ type: 'EXPORT_DONE', flow: flowWithShots });
      } catch (err: unknown) {
        sendToUI({ type: 'EXPORT_ERROR', message: (err as Error)?.message ?? 'Export failed' });
      }
      break;
    }

    case 'ANALYZE_FLOW': {
      try {
        const result = await analyzeFlow(msg.flow);
        sendToUI({ type: 'ANALYSIS_DONE', result });
      } catch (err: unknown) {
        debugLog('analysis:error', { message: (err as Error)?.message ?? 'Analysis failed' });
        sendToUI({ type: 'ANALYSIS_ERROR', message: (err as Error)?.message ?? 'Analysis failed' });
      }
      break;
    }

    case 'REORDER_STEPS': {
      const reordered = msg.orderedIds
        .map(id => figma.getNodeById(id))
        .filter((node): node is FrameNode => node !== null && node.type === 'FRAME');
      sendToUI({ type: 'FLOW_DETECTED', flow: buildManualFlow(reordered) });
      break;
    }

    case 'PLACE_INDICATORS': {
      await placeIndicators(msg.issues);
      figma.notify(`Placed ${msg.issues.length} UX indicator${msg.issues.length === 1 ? '' : 's'}.`);
      break;
    }

    case 'JUMP_TO_FRAME': {
      jumpToFrame(msg.frameId);
      break;
    }

    case 'SAVE_SETTINGS': {
      const settings = await saveSettings(msg.settings);
      debugLog('settings:saved', {
        provider: settings.provider,
        geminiModelId: settings.geminiModelId,
        openaiModelId: settings.openaiModelId,
        ibmProxyUrl: settings.ibmProxyUrl,
        ibmEndpoint: settings.ibmEndpoint,
        ibmModelId: settings.ibmModelId,
        hasAnthropicKey: Boolean(settings.anthropicApiKey),
        hasGeminiKey: Boolean(settings.geminiApiKey),
        hasOpenAIKey: Boolean(settings.openaiApiKey),
        hasIbmApiKey: Boolean(settings.ibmApiKey),
      });
      sendToUI({ type: 'SETTINGS_LOADED', settings });
      break;
    }

    case 'LOAD_SETTINGS': {
      const settings = await loadSettings();
      sendToUI({ type: 'SETTINGS_LOADED', settings });
      break;
    }

    case 'CANCEL': {
      figma.closePlugin();
      break;
    }
  }
};
