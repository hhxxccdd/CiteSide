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
const { ResearchExecution } = require(path.join(dist, 'research/research-execution'));
const { ReadWebPageTool } = require(path.join(dist, 'research/tools/read-web-page.tool'));

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
    const previousCalls = data.messages.flatMap((message) => message.tool_calls ?? []);
    const searchCalls = previousCalls.filter((call) => call.function.name === 'web_search').length;
    const readCalls = previousCalls.filter((call) => call.function.name === 'read_web_page').length;
    if (data.tools?.length) {
      let planned;
      const tool = (name, args) => ({ id: `call-${name}-${previousCalls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      if (currentMode === 'invalid-loop') planned = [tool('unknown', {})];
      else if (currentMode === 'exhaust') planned = searchCalls === 0
        ? [tool('web_search', { query: 'first' }), tool('web_search', { query: 'second' }), tool('web_search', { query: 'over-limit' })]
        : [1, 2, 3, 4].map((index) => ({ ...tool('read_web_page', { sourceIndex: index }), id: 'read-' + index }));
      else if (['follow-up', 'slow-follow-up-search'].includes(currentMode)) {
        if (searchCalls === 0) planned = [tool('web_search', { query: 'KeepAlive 实际项目' })];
        else if (readCalls === 0) planned = [tool('read_web_page', { sourceIndex: 1 })];
        else if (searchCalls === 1) planned = [tool('web_search', { query: 'vue-element-admin cachedViews 官方文档' })];
        else if (readCalls === 1) planned = [tool('read_web_page', { sourceIndex: 2 })];
      } else if (currentMode === 'read-next') {
        if (searchCalls === 0) planned = [tool('web_search', { query: '实际项目文档' })];
        else if (readCalls < 2) planned = [tool('read_web_page', { sourceIndex: readCalls + 1 })];
      } else if (currentMode === 'duplicate') {
        if (previousCalls.length < 2) planned = [tool('web_search', { query: '泛型' })];
        else if (previousCalls.length < 4) planned = [tool('read_web_page', { sourceIndex: 1 })];
      } else if (currentMode !== 'no-search') {
        if (!searchCalls) planned = [tool('web_search', { query: '泛型' })];
        else if (!readCalls) planned = [tool('read_web_page', { sourceIndex: 1 })];
      }
      if (!planned) {
        frame(response, { choices: [{ delta: { content: '[泛型保留类型关系][S1]。' }, finish_reason: 'stop' }] });
        frame(response, '[DONE]'); response.end(); return;
      }
      frame(response, { choices: [{ delta: { tool_calls: planned.map((call, index) => ({ index, id: call.id,
        function: { name: call.function.name, arguments: call.function.arguments.slice(0, 5) } })) } }] });
      frame(response, { choices: [{ delta: { tool_calls: planned.map((call, index) => ({ index,
        function: { arguments: call.function.arguments.slice(5) } })) }, finish_reason: 'tool_calls' }] });
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
    if (['follow-up', 'slow-follow-up-search'].includes(mode)) {
      const second = _args.query.includes('cachedViews');
      if (second && mode === 'slow-follow-up-search') await abortable(signal, () => searchAborted++);
      return { summary: second ? '找到了官方项目文档' : '只有无关教程', sources: second
        ? [{ title: '重复教程', url: 'https://example.com/tutorial#again' }, { title: '官方项目文档', url: 'https://project.example/docs' }]
        : [{ title: '无关教程', url: 'https://example.com/tutorial' }] };
    }
    if (['exhaust', 'read-next'].includes(mode)) return { summary: '候选资料', sources: [1, 2, 3, 4].map((index) => ({
      title: '网页' + index, url: `https://example.com/page-${index}`,
    })) };
    return { summary: '搜索总结', sources: [{ title: 'TS 原文', url: 'https://example.com/ts' }] };
  } }, { execute: async (_args, signal) => {
    reads++; if (mode === 'slow-read') await abortable(signal, () => readAborted++);
    if (mode === 'failed-read') throw Error('网站要求安全验证');
    if (mode === 'read-next' && _args.url.endsWith('page-1')) throw Error('第一篇需要登录');
    if (['follow-up', 'slow-follow-up-search', 'exhaust', 'read-next'].includes(mode)) return {
      title: '实际读取的网页', url: _args.url, text: _args.url.includes('project.example') ? '官方项目使用 KeepAlive 和 cachedViews。' : '没有所需案例的教程。',
    };
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
    ['判断是否需要联网', '联网搜索', '判断资料是否足够', '读取网页原文', '判断资料是否足够']);
  assert.equal(events.at(-1).result.readPage.title, 'TS 原文');
  assert.equal(events.filter((e) => e.type === 'step.completed').length, 5);
  const startedSteps = events.filter((event) => event.type === 'step.started');
  const searchStep = startedSteps.find((event) => event.label === '联网搜索');
  assert.equal(searchStep.detail, '第 1/2 次搜索：泛型');
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

test('首篇无关后换词补查，来源去重且两篇已读原文引用都保留', async () => {
  mode = 'follow-up'; requests = []; const beforeSearch = searches, beforeRead = reads;
  const events = await collect(input(true));
  const result = events.at(-1).result;
  assert.equal(searches - beforeSearch, 2); assert.equal(reads - beforeRead, 2);
  assert.deepEqual(result.webSources.map((source) => source.url), ['https://example.com/tutorial', 'https://project.example/docs']);
  assert.equal(result.readPages.length, 2);
  assert.equal(result.readPage.url, 'https://project.example/docs');
  const sources = result.sources.filter((source) => source.kind === 'web');
  assert.deepEqual(sources.map((source) => [source.id, source.evidence]), [['W1', 'page-text'], ['W2', 'page-text']]);
  assert.match(sources[1].excerpt, /官方项目使用 KeepAlive/);
  const searchSteps = events.filter((event) => event.type === 'step.started' && event.label === '联网搜索');
  assert.match(searchSteps[1].detail, /第 2\/2 次搜索：vue-element-admin cachedViews 官方文档/);
  const finalTools = requests.at(-1).messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
  assert.ok(finalTools.some((item) => item.text === '没有所需案例的教程。'));
  assert.ok(finalTools.some((item) => item.text === '官方项目使用 KeepAlive 和 cachedViews。'));
  assert.deepEqual(finalTools[2].sources.map((source) => [source.sourceId, source.sourceIndex]), [['W1', 1], ['W2', 2]]);
});

test('单篇阅读失败后可换另一篇，失败信息和已读来源分别保留', async () => {
  mode = 'read-next'; const beforeRead = reads;
  const events = await collect(input(true)); const result = events.at(-1).result;
  assert.equal(reads - beforeRead, 2); assert.equal(result.readPages.length, 1);
  assert.equal(result.readPages[0].url, 'https://example.com/page-2');
  assert.equal(result.webPageReadErrors[0].reason, '第一篇需要登录');
  assert.equal(result.sources.find((source) => source.id === 'W1').evidence, 'search-result');
  assert.equal(result.sources.find((source) => source.id === 'W2').evidence, 'page-text');
});

test('同一批工具调用也受整次任务的 2 次搜索和 3 篇阅读限制', async () => {
  mode = 'exhaust'; requests = []; const beforeSearch = searches, beforeRead = reads;
  const events = await collect(input(true)); const result = events.at(-1).result;
  assert.equal(searches - beforeSearch, 2); assert.equal(reads - beforeRead, 3);
  assert.equal(result.readPages.length, 3);
  assert.equal(requests.at(-1).tools, undefined);
  const feedback = requests.at(-1).messages.filter((message) => message.role === 'tool').map((message) => message.content).join('\n');
  assert.match(feedback, /最多搜索 2 次/); assert.match(feedback, /最多阅读 3 篇/);
  assert.equal(events.at(-1).type, 'run.completed');
});

test('重复搜索词与已尝试网页不重复执行，无效调用受决策轮数限制', async () => {
  mode = 'duplicate'; let beforeSearch = searches, beforeRead = reads;
  await collect(input(true));
  assert.equal(searches - beforeSearch, 1); assert.equal(reads - beforeRead, 1);
  mode = 'invalid-loop'; requests = []; beforeSearch = searches; beforeRead = reads;
  const events = await collect(input(true));
  assert.equal(events.at(-1).type, 'run.completed');
  assert.equal(searches, beforeSearch); assert.equal(reads, beforeRead);
  assert.equal(requests.filter((request) => request.tools?.length).length, 7);
  assert.equal(requests.at(-1).tools, undefined);
});

test('停止第二轮补查后取消真实搜索，不再阅读或生成答案', async () => {
  mode = 'slow-follow-up-search'; requests = []; const beforeAbort = searchAborted;
  const controller = new AbortController();
  await assert.rejects(collect(input(true), { signal: controller.signal, receive: (event) => {
    if (event.type === 'step.started' && event.label === '联网搜索' && event.detail.includes('第 2/2 次')) controller.abort();
  } }), /abort/i);
  await until(() => searchAborted > beforeAbort);
  assert.equal(requests.length, 3);
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

test('联网长文末尾、直接文字和表格完整进入模型请求，HTML 可超过旧 1 MB 限制', async () => {
  mode = 'normal'; requests = [];
  const tail = 'LONG_ARTICLE_FINAL_EVIDENCE';
  const html = `<html><title>长文章</title><body><nav>REMOVE_NAV</nav><article>
    <h1>正文</h1><p>${'正文内容。'.repeat(4000)}</p>
    <div>DIRECT_TEXT_EVIDENCE</div><table><tr><td>TABLE_EVIDENCE</td></tr></table>
    <blockquote><p>NESTED_EVIDENCE</p></blockquote><p>${tail}</p>
    <!--${'padding'.repeat(160000)}--></article><script>REMOVE_SCRIPT</script></body></html>`;
  assert.ok(Buffer.byteLength(html) > 1_000_000);
  const reader = new ReadWebPageTool();
  // 仅替换下载连接，仍执行真实的容量检查、HTML 提取和工具消息组装。
  reader.fetchHtml = async () => new Response(html, { headers: {
    'content-type': 'text/html', 'content-length': String(Buffer.byteLength(html)),
  } });
  const values = { DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
    QWEN_CHAT_MODEL: 'fixture', QWEN_MAX_OUTPUT_TOKENS: '100' };
  const qwen = new QwenClient({ get: (key) => values[key], getOrThrow: (key) => values[key] });
  const runner = new ResearchToolRunner(qwen, { execute: async () => ({ summary: '长文线索',
    sources: [{ title: '长文章', url: 'https://example.com/ts' }] }) }, reader);
  const execution = new ResearchExecution('full-web-page-test', new AbortController().signal, () => {});
  const result = await runner.answer([{ role: 'user', content: '请核对文章末尾的依据' }], true, execution);
  assert.equal(result.webPageReadFailed, false);
  assert.ok(result.readPage.text.length > 12000);
  assert.ok(result.readPage.text.endsWith(tail));
  assert.match(result.readPage.text, /DIRECT_TEXT_EVIDENCE/);
  assert.match(result.readPage.text, /TABLE_EVIDENCE/);
  assert.equal(result.readPage.text.split('NESTED_EVIDENCE').length - 1, 1);
  assert.doesNotMatch(result.readPage.text, /REMOVE_NAV|REMOVE_SCRIPT/);
  const toolMessages = requests.at(-1).messages.filter((message) => message.role === 'tool');
  const received = JSON.parse(toolMessages.at(-1).content);
  assert.equal(received.text, result.readPage.text);
  assert.ok(received.text.endsWith(tail));
});

test('联网 HTML 超过 8 MiB 时明确失败并取消下载，不返回截断正文', async () => {
  const maxBytes = 8 * 1024 * 1024;
  for (const declared of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        if (!declared) { controller.enqueue(new Uint8Array(maxBytes)); controller.enqueue(new Uint8Array(1)); }
      },
      cancel() { cancelled = true; },
    });
    const reader = new ReadWebPageTool();
    reader.fetchHtml = async () => new Response(body, { headers: {
      'content-type': 'text/html', ...(declared ? { 'content-length': String(maxBytes + 1) } : {}),
    } });
    await assert.rejects(reader.execute({ url: 'https://example.com/long', allowedUrls: ['https://example.com/long'] }),
      /HTML 超过 8 MiB 下载上限，本次未截取正文/);
    assert.equal(cancelled, true);
  }
});
