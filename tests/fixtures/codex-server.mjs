// Deterministic stdio fixture; never contacts a provider or opens user files.
import readline from 'node:readline'
import process from 'node:process'
const mode = process.argv[2] ?? 'success'
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const event = (method, params) => send({ method, params: { threadId: 'thread-1', turnId: 'turn-1', ...params } })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  const reply = (result) => send({ id: request.id, result })
  if (mode === 'eof') return process.exit(0)
  if (mode === 'malformed') return process.stdout.write('invalid json\n')
  if (mode === 'silent') return
  if (mode === 'approval') return send({ id: 99, method: 'item/commandExecution/requestApproval', params: {} })
  switch (request.method) {
    case 'model/list': reply({ data: [{ model: 'fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] }); break
    case 'account/read': reply({ account: mode === 'apikey' ? { type: 'apiKey' } : { type: 'chatgpt', planType: 'plus' } }); break
    case 'thread/start': reply({ modelProvider: 'openai', model: 'fixture', sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never', thread: { id: 'thread-1' } }); break
    case 'turn/start':
      // Deliberately send an early delta before the RPC response.
      event('item/agentMessage/delta', { delta: '雨落' })
      reply({ turn: { id: 'turn-1' } })
      if (mode === 'tool') event('item/started', { item: { type: 'commandExecution' } })
      else if (mode === 'overflow') event('item/agentMessage/delta', { delta: 'x'.repeat(2 * 1024 * 1024) })
      else if (mode === 'cancel') return
      else {
        event('item/agentMessage/delta', { threadId: 'stale-thread', delta: '忽略' })
        event('item/agentMessage/delta', { delta: '无声。' })
        event('turn/completed', { turn: { id: 'turn-1', status: mode === 'failure' ? 'failed' : 'completed' } })
      }
      break
    case 'turn/interrupt':
      reply({})
      event('item/agentMessage/delta', { delta: '迟到文本' })
      event('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } })
      break
    default: reply({})
  }
})
