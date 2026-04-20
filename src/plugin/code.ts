/// <reference types="@figma/plugin-typings" />

// ─── Types (inlined — no imports needed) ─────────────────────────────────────

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
}

interface IndicatorPayload {
  frameId: string;
  label: string;
}

type PluginToUI =
  | { type: 'FLOW_DETECTED'; flow: FlowGraph }
  | { type: 'NO_FRAMES_SELECTED' }
  | { type: 'NO_REACTIONS'; frameNames: string[] }
  | { type: 'EXPORT_PROGRESS'; current: number; total: number }
  | { type: 'EXPORT_DONE'; flow: FlowGraph }
  | { type: 'EXPORT_ERROR'; message: string }
  | { type: 'SETTINGS_LOADED'; apiKey: string };

type UIToPlugin =
  | { type: 'READY' }
  | { type: 'CONFIRM_FLOW'; flow: FlowGraph; skipScreenshots: boolean }
  | { type: 'CANCEL' }
  | { type: 'SAVE_API_KEY'; apiKey: string }
  | { type: 'LOAD_SETTINGS' }
  | { type: 'REORDER_STEPS'; orderedIds: string[] }
  | { type: 'PLACE_INDICATORS'; issues: IndicatorPayload[] };

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DEPTH = 10;
const EXPORT_SCALE = 0.5;
const MAX_PAYLOAD_KB = 800;
const INDICATOR_TAG = '⚠ UX Issue';

// ─── Send to UI ───────────────────────────────────────────────────────────────

function sendToUI(msg: PluginToUI): void {
  figma.ui.postMessage(msg);
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractText(node: SceneNode): string[] {
  const texts: string[] = [];
  function walk(n: SceneNode): void {
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

// ─── Flow detection ───────────────────────────────────────────────────────────

function detectFlow(startFrame: FrameNode): FlowGraph {
  const visited = new Set<string>();
  const steps: FlowStep[] = [];

  function traverse(node: SceneNode, depth: number): void {
    if (depth > MAX_DEPTH || visited.has(node.id)) return;
    if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') return;
    visited.add(node.id);

    steps.push({
      id: node.id,
      name: node.name,
      textContent: extractText(node),
    });

    const reactions: readonly Reaction[] = (node as FrameNode).reactions ?? [];
    for (const reaction of reactions) {
      if (reaction.action && reaction.action.type === 'NODE' && 'destinationId' in reaction.action) {
        const destId = reaction.action.destinationId;
        if (destId) {
          const dest = figma.getNodeById(destId);
          if (dest) traverse(dest as SceneNode, depth + 1);
        }
      }
    }
  }

  traverse(startFrame, 0);
  return { steps, breadcrumb: steps.map(s => s.name).join(' → ') };
}

function buildManualFlow(frames: FrameNode[]): FlowGraph {
  const steps: FlowStep[] = frames.map(f => ({
    id: f.id,
    name: f.name,
    textContent: extractText(f),
  }));
  return { steps, breadcrumb: steps.map(s => s.name).join(' → ') };
}

// ─── Base64 (no btoa in plugin sandbox) ──────────────────────────────────────

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

// ─── Frame export ─────────────────────────────────────────────────────────────

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
      const bytes = await (node as FrameNode).exportAsync({
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

// ─── Indicator placer ─────────────────────────────────────────────────────────

async function placeIndicators(indicators: IndicatorPayload[]): Promise<void> {
  figma.currentPage.findAll(n => n.name.startsWith(INDICATOR_TAG)).forEach(n => n.remove());

  for (const indicator of indicators) {
    const node = figma.getNodeById(indicator.frameId);
    if (!node || node.type !== 'FRAME') continue;

    const frame = node as FrameNode;
    const badge = figma.createFrame();
    badge.name = `${INDICATOR_TAG}: ${frame.name}`;
    badge.resize(Math.min(frame.width, 240), 36);

    const bbox = frame.absoluteBoundingBox;
    if (bbox) {
      badge.x = bbox.x;
      badge.y = bbox.y - 44;
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

figma.showUI(__html__, { width: 380, height: 560, title: 'UX Flow Reviewer' });

async function init(): Promise<void> {
  const apiKey = (await figma.clientStorage.getAsync('apiKey')) ?? '';
  sendToUI({ type: 'SETTINGS_LOADED', apiKey });
}

init();

// ─── Message handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as UIToPlugin;

  switch (msg.type) {
    case 'READY': {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) { sendToUI({ type: 'NO_FRAMES_SELECTED' }); return; }

      const frames = selection.filter(n => n.type === 'FRAME') as FrameNode[];
      if (frames.length === 0) { sendToUI({ type: 'NO_FRAMES_SELECTED' }); return; }

      const flow = detectFlow(frames[0]);

      if (flow.steps.length <= 1 && frames.length > 1) {
        sendToUI({ type: 'NO_REACTIONS', frameNames: frames.map(f => f.name) });
        sendToUI({ type: 'FLOW_DETECTED', flow: buildManualFlow(frames) });
      } else {
        sendToUI({ type: 'FLOW_DETECTED', flow });
      }
      break;
    }

    case 'CONFIRM_FLOW': {
      const { flow, skipScreenshots } = msg;
      if (skipScreenshots) { sendToUI({ type: 'EXPORT_DONE', flow }); return; }
      try {
        const flowWithShots = await exportScreenshots(
          flow,
          (cur, tot) => sendToUI({ type: 'EXPORT_PROGRESS', current: cur, total: tot })
        );
        sendToUI({ type: 'EXPORT_DONE', flow: flowWithShots });
      } catch (err: unknown) {
        sendToUI({ type: 'EXPORT_ERROR', message: (err as Error)?.message ?? 'Export failed' });
      }
      break;
    }

    case 'REORDER_STEPS': {
      const reordered = msg.orderedIds
        .map(id => figma.getNodeById(id))
        .filter((n): n is FrameNode => n !== null && n.type === 'FRAME');
      sendToUI({ type: 'FLOW_DETECTED', flow: buildManualFlow(reordered) });
      break;
    }

    case 'PLACE_INDICATORS': {
      await placeIndicators(msg.issues);
      break;
    }

    case 'SAVE_API_KEY': {
      await figma.clientStorage.setAsync('apiKey', msg.apiKey);
      break;
    }

    case 'LOAD_SETTINGS': {
      const apiKey = (await figma.clientStorage.getAsync('apiKey')) ?? '';
      sendToUI({ type: 'SETTINGS_LOADED', apiKey });
      break;
    }

    case 'CANCEL': {
      figma.closePlugin();
      break;
    }
  }
};
