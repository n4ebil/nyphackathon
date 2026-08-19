#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="TutoringMatchRequests"
FUNCTION_NAME="tutoring-match-api"
API_NAME="tutoring-match-api"
TOPIC_NAME="tutoring-match-notifications"
NOTIFY_EMAIL="${NOTIFY_EMAIL:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR/lambda"

echo "== Checking AWS identity =="
aws sts get-caller-identity --region "$REGION"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")

echo "== Locating LabRole =="
ROLE_ARN=$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text 2>/dev/null || true)
if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" = "None" ]; then
  ROLE_ARN=$(aws iam list-roles --query "Roles[?contains(RoleName, 'LabRole') || contains(RoleName, 'voclabs')].Arn | [0]" --output text)
fi
if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" = "None" ]; then
  echo "ERROR: Could not find LabRole." >&2
  exit 1
fi
echo "Using role: $ROLE_ARN"

echo "== Creating DynamoDB table ($TABLE_NAME) =="
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Table already exists, skipping creation."
else
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions \
        AttributeName=matchId,AttributeType=S \
        AttributeName=tutorId,AttributeType=S \
        AttributeName=studentId,AttributeType=S \
    --key-schema AttributeName=matchId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --global-secondary-indexes \
      '[
        {"IndexName":"tutorId-index","KeySchema":[{"AttributeName":"tutorId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}},
        {"IndexName":"studentId-index","KeySchema":[{"AttributeName":"studentId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}
      ]' \
    --region "$REGION"
  echo "Waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
fi

echo "== Setting up SNS topic ($TOPIC_NAME) =="
TOPIC_ARN=$(aws sns list-topics --query "Topics[?contains(TopicArn, ':$TOPIC_NAME')].TopicArn | [0]" --output text --region "$REGION")
if [ -z "$TOPIC_ARN" ] || [ "$TOPIC_ARN" = "None" ]; then
  TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --query TopicArn --output text --region "$REGION")
  echo "Created topic: $TOPIC_ARN"
else
  echo "Topic already exists: $TOPIC_ARN"
fi

if [ -n "$NOTIFY_EMAIL" ]; then
  EXISTING_SUB=$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query "Subscriptions[?Endpoint=='$NOTIFY_EMAIL'].SubscriptionArn | [0]" --output text --region "$REGION")
  if [ -z "$EXISTING_SUB" ] || [ "$EXISTING_SUB" = "None" ]; then
    aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$NOTIFY_EMAIL" --region "$REGION" >/dev/null
    echo "Subscribed $NOTIFY_EMAIL -- check that inbox and click the confirmation link!"
  else
    echo "$NOTIFY_EMAIL is already subscribed."
  fi
else
  echo "No NOTIFY_EMAIL set -- skipping email subscription."
fi

echo "== Packaging Lambda code =="
ZIP_PATH="$SCRIPT_DIR/function.zip"
rm -f "$ZIP_PATH"
if command -v zip >/dev/null 2>&1; then
  (cd "$LAMBDA_DIR" && zip -r "$ZIP_PATH" index.js matching.js >/dev/null)
else
  python3 - "$LAMBDA_DIR" "$ZIP_PATH" <<'PYEOF'
import sys, zipfile, os
lambda_dir, zip_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for fname in ('index.js', 'matching.js'):
        z.write(os.path.join(lambda_dir, fname), fname)
PYEOF
fi
echo "Packaged: $ZIP_PATH"

echo "== Deploying Lambda function ($FUNCTION_NAME) =="
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Function exists, updating code..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_PATH" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={TABLE_NAME=$TABLE_NAME,TOPIC_ARN=$TOPIC_ARN}" \
    --region "$REGION" >/dev/null
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://$ZIP_PATH" \
    --timeout 15 \
    --memory-size 256 \
    --environment "Variables={TABLE_NAME=$TABLE_NAME,TOPIC_ARN=$TOPIC_ARN}" \
    --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

LAMBDA_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text --region "$REGION")
echo "Lambda ARN: $LAMBDA_ARN"

echo "== Setting up API Gateway =="
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text --region "$REGION")
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --target "$LAMBDA_ARN" \
    --cors-configuration AllowOrigins="*",AllowMethods="GET,POST,PATCH,OPTIONS",AllowHeaders="Content-Type" \
    --query ApiId --output text --region "$REGION")
  echo "Created API: $API_ID"
else
  echo "API already exists: $API_ID"
fi

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*" \
  --region "$REGION" 2>/dev/null || echo "(permission already granted, skipping)"

API_ENDPOINT=$(aws apigatewayv2 get-api --api-id "$API_ID" --query ApiEndpoint --output text --region "$REGION")

echo ""
echo "=================================================================="
echo " Deployment complete."
echo " API base URL: $API_ENDPOINT"
echo " SNS Topic ARN: $TOPIC_ARN"
echo ""
echo "   VITE_API_BASE_URL=$API_ENDPOINT"
echo "=================================================================="
