/**
 * Extracts plain text from an uploaded project document so the brief
 * generator can read it the same way it reads pasted raw input.
 *
 * Supported types:
 *  - PDF                            → pdf-parse
 *  - DOCX (and legacy DOC best-effort) → mammoth
 *  - TXT / MD                       → UTF-8 decode
 *  - PNG / JPG / WEBP               → vision LLM (Claude Sonnet or GPT-4o)
 *
 * Returns the extracted text. Throws on any failure with a user-readable
 * message — callers map the throw to the per-file `failed` status.
 */

const VISION_PROMPT = [
  'You are reading a document image attached to a software project intake.',
  'Extract ALL readable text verbatim, then add a brief description of any',
  'diagrams, wireframes, screenshots, flow charts, or structured layouts',
  'so a project manager could understand the document without seeing it.',
  '',
  'Format your reply as plain text (no JSON, no markdown). Start with the',
  'literal extracted text. If the image is mostly visual (e.g. a wireframe),',
  'describe it in detail with labels, regions, and visible UI elements.',
  '',
  'Do NOT add commentary like "Here is the text:" — output the content directly.',
].join('\n');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function isText(mime: string, filename: string): boolean {
  if (mime.startsWith('text/')) return true;
  // Some browsers report `.md` files as application/octet-stream — fall back
  // to extension sniffing so we don't misroute them.
  return /\.(md|markdown|txt)$/i.test(filename);
}

export async function extractAttachmentText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  provider: 'anthropic' | 'openai',
): Promise<string> {
  if (mimeType === PDF_MIME) return extractPdf(buffer);
  if (mimeType === DOCX_MIME || mimeType === DOC_MIME) return extractDocx(buffer);
  if (isText(mimeType, filename)) return extractPlainText(buffer);
  if (isImage(mimeType)) return extractImageWithVision(buffer, mimeType, provider);

  throw new Error(`Unsupported file type "${mimeType}" — accepted: PDF, DOCX, TXT, MD, PNG, JPG.`);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // pdf-parse is CJS and ships with a default export. Lazy-load so the parser
  // (which is heavy) doesn't run on every cold start when no PDFs are uploaded.
  const mod = await import('pdf-parse');
  const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text: string }> }).default
    ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
  const result = await pdfParse(buffer);
  const text = (result.text ?? '').trim();
  if (!text) throw new Error('PDF contained no extractable text (possibly a scanned image PDF — upload as PNG/JPG instead).');
  return text;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  // extractRawText preserves paragraph breaks but drops styling. Good fit for
  // feeding into the LLM where formatting just adds noise.
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value ?? '').trim();
  if (!text) throw new Error('Word document contained no readable text.');
  return text;
}

function extractPlainText(buffer: Buffer): string {
  // Strip BOM if present; tolerate CRLF / LF mixed line endings.
  const text = buffer.toString('utf8').replace(/^﻿/, '').trim();
  if (!text) throw new Error('File was empty.');
  return text;
}

/**
 * Sends the image to the configured vision LLM and returns the extracted
 * description. Uses Sonnet for Anthropic and GPT-4o for OpenAI — both have
 * the vision capability needed; cheaper models often don't.
 *
 * We pick the model dynamically from the same env-override pattern as
 * callLLM so ops can swap models without code changes.
 */
async function extractImageWithVision(
  buffer: Buffer,
  mimeType: string,
  provider: 'anthropic' | 'openai',
): Promise<string> {
  const base64 = buffer.toString('base64');

  if (provider === 'anthropic') {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured — cannot run vision extraction.');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const model = process.env['AI_MODEL_VISION_ANTHROPIC'] ?? 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    });
    const block = msg.content[0];
    if (!block || block.type !== 'text') throw new Error('Anthropic vision returned no text content.');
    const text = block.text.trim();
    if (!text) throw new Error('Vision LLM returned empty result for the image.');
    return text;
  }

  // OpenAI path
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured — cannot run vision extraction.');
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const model = process.env['AI_MODEL_VISION_OPENAI'] ?? 'gpt-4o';
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
  });
  const text = (completion.choices[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('Vision LLM returned empty result for the image.');
  return text;
}
