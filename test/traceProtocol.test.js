'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TraceRowParser, decodeValue } = require('../src/traceProtocol');
const { normalizeMaxDuration } = require('../src/traceClient');

test('decodes common trace values', () => {
  assert.equal(decodeValue(1, Buffer.from('SELECT 1', 'utf16le')), 'SELECT 1');
  const integer = Buffer.alloc(4); integer.writeInt32LE(42);
  assert.equal(decodeValue(12, integer), 42);
  const long = Buffer.alloc(8); long.writeBigInt64LE(9000n);
  assert.equal(decodeValue(13, long), 9000);
});

test('assembles events at protocol boundary rows', () => {
  const events = [];
  const parser = new TraceRowParser((event) => events.push(event));
  const marker = (id) => { const value = Buffer.alloc(2); value.writeUInt16LE(id); return value; };
  parser.push(65526, marker(10));
  parser.push(1, Buffer.from('exec dbo.test @id=7', 'utf16le'));
  parser.push(11, Buffer.from('cubeerp', 'utf16le'));
  parser.push(65526, marker(12));
  parser.push(1, Buffer.from('select 1', 'utf16le'));
  parser.flush();
  assert.deepEqual(events.map((event) => event.eventClass), ['RPC:Completed', 'SQL:BatchCompleted']);
  assert.equal(events[0].textData, 'exec dbo.test @id=7');
  assert.equal(events[0].loginName, 'cubeerp');
});

test('normalizes trace safety duration', () => {
  assert.equal(normalizeMaxDuration(15), 15);
  assert.equal(normalizeMaxDuration(5), 5);
  assert.equal(normalizeMaxDuration(30), 30);
  assert.equal(normalizeMaxDuration(7), 30);
  assert.equal(normalizeMaxDuration(0), 30);
  assert.equal(normalizeMaxDuration(35), 30);
  assert.equal(normalizeMaxDuration('invalid'), 30);
});
