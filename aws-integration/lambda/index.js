'use strict'

const { DynamoDBClient, PutItemCommand, ScanCommand, QueryCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb')
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns')
const { findMatches, buildExplanation } = require('./matching.js')

const client = new DynamoDBClient({})
const sns = new SNSClient({})
const TABLE_NAME = process.env.TABLE_NAME || 'TutoringMatchRequests'
const TOPIC_ARN = process.env.TOPIC_ARN || ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(body) }
}

function marshal(item) {
  const out = {}
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined) continue
    if (value === null) out[key] = { NULL: true }
    else if (typeof value === 'number') out[key] = { N: String(value) }
    else if (typeof value === 'boolean') out[key] = { BOOL: value }
    else out[key] = { S: String(value) }
  }
  return out
}

function unmarshal(av) {
  const out = {}
  for (const [key, value] of Object.entries(av || {})) {
    if ('S' in value) out[key] = value.S
    else if ('N' in value) out[key] = Number(value.N)
    else if ('BOOL' in value) out[key] = value.BOOL
    else if ('NULL' in value) out[key] = null
  }
  return out
}

exports.handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod
    const path = event.requestContext?.http?.path || event.rawPath || event.path || ''

    if (method === 'OPTIONS') return respond(200, {})

    if (method === 'POST' && path.endsWith('/compute-matches')) return await handleComputeMatches(event)
    if (method === 'POST' && path.endsWith('/match-requests')) return await handleCreateMatchRequest(event)
    if (method === 'GET' && path.endsWith('/match-requests')) return await handleListMatchRequests(event)
    if (method === 'PATCH' && path.includes('/match-requests/')) return await handleUpdateMatchRequest(event, path)

    return respond(404, { error: `No route for ${method} ${path}` })
  } catch (err) {
    console.error('Unhandled error', err)
    return respond(500, { error: err.message || 'Internal error' })
  }
}

async function handleComputeMatches(event) {
  const input = JSON.parse(event.body || '{}')
  const required = ['student', 'request', 'studentSlots', 'candidates', 'teachingSubjects', 'availability']
  for (const key of required) {
    if (!(key in input)) return respond(400, { error: `Missing "${key}" in request body` })
  }

  const matches = findMatches(input)
  const withExplanations = matches.map((match) => ({ ...match, explanation: buildExplanation(match, input.request) }))
  return respond(200, { matches: withExplanations })
}

async function handleCreateMatchRequest(event) {
  const matchRequest = JSON.parse(event.body || '{}')
  if (!matchRequest.matchId || !matchRequest.studentId || !matchRequest.tutorId) {
    return respond(400, { error: 'matchId, studentId and tutorId are required' })
  }
  await client.send(new PutItemCommand({ TableName: TABLE_NAME, Item: marshal(matchRequest) }))

  if (TOPIC_ARN) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: TOPIC_ARN,
          Subject: 'New tutoring match request',
          Message: `A new match request was sent for "${matchRequest.moduleName || 'a module'}".

From student: ${matchRequest.studentId}
To tutor: ${matchRequest.tutorId}
Message: ${matchRequest.message || '(none)'}
Status: ${matchRequest.status}`,
        }),
      )
    } catch (err) {
      console.error('SNS publish failed (non-fatal)', err)
    }
  }

  return respond(200, matchRequest)
}

async function handleListMatchRequests(event) {
  const userId = event.queryStringParameters?.userId

  if (!userId) {
    const scan = await client.send(new ScanCommand({ TableName: TABLE_NAME }))
    return respond(200, (scan.Items || []).map(unmarshal))
  }

  const [incoming, outgoing] = await Promise.all([
    client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tutorId-index',
        KeyConditionExpression: 'tutorId = :uid',
        ExpressionAttributeValues: { ':uid': { S: userId } },
      }),
    ),
    client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'studentId-index',
        KeyConditionExpression: 'studentId = :uid',
        ExpressionAttributeValues: { ':uid': { S: userId } },
      }),
    ),
  ])

  return respond(200, {
    incoming: (incoming.Items || []).map(unmarshal),
    outgoing: (outgoing.Items || []).map(unmarshal),
  })
}

async function handleUpdateMatchRequest(event, path) {
  const matchId = decodeURIComponent(path.split('/match-requests/')[1] || '')
  if (!matchId) return respond(400, { error: 'matchId missing from path' })

  const body = JSON.parse(event.body || '{}')
  if (!body.status) return respond(400, { error: '"status" is required' })

  await client.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { matchId: { S: matchId } },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': { S: body.status } },
    }),
  )
  return respond(200, { matchId, status: body.status })
}