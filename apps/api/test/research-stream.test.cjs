// 使用本地 HTTP 模型替身和真实 Nest 控制器；不访问百炼、不写入知识库。
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
require('reflect-metadata');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { createParser } = require('eventsource-parser');
const dist = process.env.RESEARCH_TEST_DIST || path.join(__dirname, '../dist');
const { QwenClient } = require(path.join(dist, 'llm/qwen.client'));
const { ResearchController } = require(path.join(dist, 'research/research.controller'));
const { ResearchService } = require(path.join(dist, 'research/research.service'));
const { ResearchToolRunner } = require(path.join(dist, 'research/research-tool-runner.service'));
const { ResearchContextService } = require(path.join(dist, 'research/research-context.service'));
const { ResearchCitationsService } = require(path.join(dist, 'research/research-citations.service'));

let app, provider, url, mode = 'normal', searchAborted = 0, readAborted = 0, modelAborted = 0;
let requests = [], searches = 0, reads = 0;
const page = { title: 'TS 教程', url: 'https://example.com/ts', text: '泛型保留类型之间的关系。',
  completeness: 'full', capturedAt: '2026-10-19T00:00:00Z' };
const input = (web = false, knowledge = false) => ({ question: '解释泛型', materials: { pages: [page], noteIds: [] },
  options: { allowWebSearch: web, searchKnowledgeBase: knowledge } });
const frame = (response, data) => response.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
const until = async (condition) => {
  for (let tries = 0; tries < 100; tries++) { if (condition()) return; await delay(20); }
  assert.fail('等待状态变化超时');
};
const abortable = async (signal, onAbort) => {
  try { await delay(10_000, undefined, { signal }); }
  catch (error) { if (signal.aborted) onAbort(); throw error; }
};

before(async () => {
  provider = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const data = JSON.parse(body); requests.push(data);
    const currentMode = mode;
    response.on('close', () => { if (!response.writableEnded) modelAborted++; });
    if (!data.stream) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '[泛型保留类型关系][S1]。' } }] })); return;
    }
    response.setHeader('Content-Type', 'text/event-stream');
    if (data.tools?.length) {
      if (currentMode === 'no-search') {
        frame(response, { choices: [{ delta: { content: '[泛型保留类型关系][S1]。' }, finish_reason: 'stop' }] });
        frame(response, '[DONE]'); response.end(); return;
      }
      const name = data.tools[0].function.name;
      const args = name === 'web_search' ? '{"query":"泛型"}' : '{"sourceIndex":1}';
      frame(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-' + name, function: { name, arguments: args.slice(0, 5) } }] } }] });
      frame(response, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, finish_reason: 'tool_calls' }] });
    } else {
      frame(response, { choices: [{ delta: { content: '[泛型保留' } }] });
      if (currentMode === 'slow-model') { await delay(10_000, undefined, { signal: AbortSignal.timeout(200) }).catch(() => {}); if (response.destroyed) return; }
      else await delay(70);
      if (currentMode === 'early-end') { response.end(); return; }
      frame(response, { choices: [{ delta: { content: '类型关系][S1]。' }, finish_reason: currentMode === 'length' ? 'length' : 'stop' }] });
    }
    frame(response, '[DONE]'); response.end();
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const values = { DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
    QWEN_CHAT_MODEL: 'fixture', QWEN_MAX_OUTPUT_TOKENS: '100' };
  const qwen = new QwenClient({ get: (key) => values[key], getOrThrow: (key) => values[key] });
  const runner = new ResearchToolRunner(qwen, { execute: async (_args, signal) => {
    searches++; if (mode === 'slow-search') await abortable(signal, () => searchAborted++);
    return { summary: '搜索总结', sources: [{ title: 'TS 原文', url: 'https://example.com/ts' }] };
  } }, { execute: async (_args, signal) => {
    reads++; if (mode === 'slow-read') await abortable(signal, () => readAborted++);
    if (mode === 'failed-read') throw Error('网站要求安全验证');
    return { title: 'TS 原文', url: 'https://example.com/ts', text: '泛型保留类型关系。' };
  } });
  const research = new ResearchService({ execute: (value) => value }, { execute: async () => {
    if (mode === 'failed-knowledge') throw Error('知识库暂不可用'); return [];
  } }, runner, new ResearchContextService({}), new ResearchCitationsService(qwen));
  class Fixture {}
  Module({ controllers: [ResearchController], providers: [{ provide: ResearchService, useValue: research }] })(Fixture);
  app = await NestFactory.create(Fixture, { logger: false });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1'); url = await app.getUrl();
});
after(async () => {
  await app?.close();
  provider?.closeAllConnections();
  if (provider) await new Promise((resolve) => provider.close(resolve));
});

async function collect(body, options = {}) {
  const response = await fetch(url + '/api/research/run/stream', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /event-stream/);
  const events = [], reader = response.body.getReader(), decoder = new TextDecoder();
  const parser = createParser({ onEvent: ({ data }) => {
    const event = JSON.parse(data); assert.equal(event.sequence, events.length + 1);
    if (events.length) assert.equal(event.runId, events[0].runId);
    events.push(event); options.receive?.(event);
  } });
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; parser.feed(decoder.decode(chunk.value, { stream: true })); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return events;
}

test('真实片段在最终结果前到达；关闭工具时没有虚构工具进度', async () => {
  mode = 'normal'; requests = []; const beforeSearch = searches;
  let firstDelta, completed;
  const events = await collect(input(), { receive: (event) => {
    if (event.type === 'answer.delta') firstDelta ??= Date.now();
    if (event.type === 'run.completed') completed = Date.now();
  } });
  assert.ok(completed - firstDelta >= 40);
  assert.equal(events[0].type, 'run.started'); assert.equal(events.at(-1).type, 'run.completed');
  assert.equal(events.at(-1).result.answer, '[泛型保留类型关系][S1]。');
  assert.equal(events.filter((e) => e.type === 'answer.delta').map((e) => e.text).join(''), '[泛型保留类型关系][S1]。');
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.label), ['生成回答']);
  assert.equal(searches, beforeSearch); assert.equal(requests[0].stream, true);
  assert.ok(requests[0].messages[0].content.endsWith('不需要写后续的建议和操作。'));
});

test('工具参数按片段组装，进度对应真实搜索和阅读', async () => {
  mode = 'normal'; const beforeSearch = searches, beforeRead = reads;
  const events = await collect(input(true));
  assert.equal(searches - beforeSearch, 1); assert.equal(reads - beforeRead, 1);
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.label),
    ['判断是否需要联网', '联网搜索', '判断是否需要阅读原文', '读取网页原文', '生成回答']);
  assert.equal(events.at(-1).result.readPage.title, 'TS 原文');
  assert.equal(events.filter((e) => e.type === 'step.completed').length, 5);
  const startedSteps = events.filter((event) => event.type === 'step.started');
  const searchStep = startedSteps.find((event) => event.label === '联网搜索');
  assert.equal(searchStep.detail, '搜索：泛型');
  const searchDone = events.find((event) => event.type === 'step.completed' && event.stepId === searchStep.stepId);
  assert.deepEqual(searchDone.links, [{ title: 'TS 原文', url: 'https://example.com/ts' }]);
  const readStep = startedSteps.find((event) => event.label === '读取网页原文');
  assert.deepEqual(readStep.links, searchDone.links);
  assert.ok(readStep.sequence > searchDone.sequence);
});

test('允许联网但模型直接作答时，记录跳过搜索而不伪造执行', async () => {
  mode = 'no-search'; const beforeSearch = searches, beforeRead = reads;
  const events = await collect(input(true));
  assert.equal(searches, beforeSearch); assert.equal(reads, beforeRead);
  assert.equal(events.at(-1).type, 'run.completed');
  assert.deepEqual(events.at(-1).result.webSources, []);
  assert.equal(events.at(-1).result.options.allowWebSearch, true);
  assert.ok(!events.some((event) => event.type === 'step.started' && event.label === '联网搜索'));
  assert.ok(events.some((event) => event.type === 'step.completed' && event.detail === '模型未请求联网搜索，本次直接作答'));
});

test('工具失败有真实失败事件，同时可以使用已有资料完成回答', async () => {
  mode = 'failed-read'; let events = await collect(input(true));
  assert.ok(events.some((e) => e.type === 'step.failed' && /安全验证/.test(e.message)));
  assert.equal(events.at(-1).result.webPageReadError.reason, '网站要求安全验证');
  mode = 'failed-knowledge'; events = await collect(input(false, true));
  assert.ok(events.some((e) => e.type === 'step.failed' && /知识库/.test(e.message)));
  assert.equal(events.at(-1).result.knowledgeSearchFailed, true);
});

for (const [scenario, step, count] of [
  ['slow-search', '联网搜索', () => searchAborted], ['slow-read', '读取网页原文', () => readAborted],
]) test('断开连接取消真实执行且不启动后续步骤：' + step, async () => {
  mode = scenario; const controller = new AbortController(); const previous = count(); requests = [];
  await assert.rejects(collect(input(true), { signal: controller.signal, receive: (event) => {
    if (event.type === 'step.started' && event.label === step) controller.abort();
  } }), /abort/i);
  await until(() => count() > previous);
  assert.equal(requests.length, scenario === 'slow-search' ? 1 : 2);
});

test('停止生成会断开上游模型请求，新请求拥有新运行 ID', async () => {
  mode = 'slow-model'; const controller = new AbortController(); const beforeAbort = modelAborted;
  let firstId;
  await assert.rejects(collect(input(), { signal: controller.signal, receive: (event) => {
    firstId ??= event.runId; if (event.type === 'answer.delta') controller.abort();
  } }), /abort/i);
  await until(() => modelAborted > beforeAbort);
  mode = 'normal'; const events = await collect(input());
  assert.notEqual(events[0].runId, firstId); assert.equal(events.at(-1).type, 'run.completed');
});

test('提前 EOF 和输出截断均为失败，不能把部分内容标记为完成', async () => {
  for (const scenario of ['early-end', 'length']) {
    mode = scenario; const events = await collect(input());
    assert.equal(events.at(-1).type, 'run.failed');
    assert.ok(events.some((e) => e.type === 'answer.delta'));
    assert.ok(!events.some((e) => e.type === 'run.completed'));
  }
});

test('旧 JSON 接口仍可请求；非法输入在发送事件流前返回 400', async () => {
  mode = 'normal'; const response = await fetch(url + '/api/research/run', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(response.status, 201); assert.equal((await response.json()).answer, '[泛型保留类型关系][S1]。');
  const invalid = await fetch(url + '/api/research/run/stream', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '' }) });
  assert.equal(invalid.status, 400); assert.match(invalid.headers.get('content-type'), /application\/json/);
});
